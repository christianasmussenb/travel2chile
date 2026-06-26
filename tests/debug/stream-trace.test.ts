import { describe, expect, it } from 'vitest'
import { extractSseFrames } from '@/lib/sse'
import { guardChatStream } from '@/lib/output-guard'

function createSseStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function consumeSse(stream: ReadableStream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let remainder = ''
  const trace: Array<Record<string, unknown>> = []
  let finalText = ''

  while (true) {
    const { done, value } = await reader.read()
    const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })
    const parsed = extractSseFrames(chunk, remainder)
    remainder = parsed.remainder

    for (const frame of parsed.frames) {
      const line = frame.trim()
      if (line === 'data: [DONE]') {
        trace.push({ stage: 'ui', event: 'done' })
        continue
      }
      if (!line.startsWith('data: ')) continue
      const payload = JSON.parse(line.slice(6)) as { type?: string; text?: string; seq?: number }
      trace.push({
        stage: 'ui',
        event: payload.type ?? 'legacy',
        seq: payload.seq ?? null,
        length: payload.text?.length ?? 0,
        preview: payload.text?.replace(/\s+/g, ' ').trim().slice(0, 100) ?? '',
      })
      if (payload.type === 'text' && payload.text) finalText += payload.text
    }

    if (done) break
  }

  return { trace, finalText }
}

describe('stream trace diagnostics', () => {
  it('does not duplicate text when upstream content is unique', async () => {
    const upstreamChunks = [
      'data: {"type":"text","text":"¡Hola! Aquí tienes una guía de presupuesto de 7 días en Chile con dos rutas populares (y económicas) que puedes elegir según tu destino soñado. Todo está calculado en dólares estadounidenses (USD) y pesos chilenos (CLP) para que tengas una visión clara.\\n\\nRUTA 1 – Capital, Costas y el Desierto\\nDía\\tUbicación\\tAlojamiento típico\\tComidas\\tTransporte\\tActividades\\tCosto aproximado en USD/CLP*\\n1\\tSantiago\\tHostal o hotel económico"}\n\n',
      'data: {"type":"text","text":" (doble compartido) ≈ $35 USD ≈ $30.000 CLP\\t$15 USD ≈ $13.000 CLP\\t–\\tRecorre la Plaza de Armas\\t$115 USD ≈ $100.000 CLP\\n2\\tSantiago\\tIgual\\t$15 USD ≈ $13.000 CLP\\t–\\tMuseo de la Memoria\\t$115 USD ≈ $100.000 CLP\\n3\\tValparaíso\\tTraslado en bus ≈ $8 USD ≈ $7.000 CLP"}\n\n',
      'data: {"type":"text","text":"\\t$12 USD ≈ $10.500 CLP\\t–\\tEscalera de colores\\t$130 USD ≈ $113.500 CLP\\n4\\tLa Serena / Coquimbo\\tAlojamiento similar ≈ $30 USD ≈ $26.000 CLP"}\n\n',
      'data: [DONE]\n\n',
    ]

    const { trace, finalText } = await consumeSse(guardChatStream(createSseStream(upstreamChunks)))

    console.log('\n[trace unique upstream]\n' + JSON.stringify(trace, null, 2))
    console.log('\n[final unique text]\n' + finalText)

    expect(finalText.match(/RUTA 1 – Capital, Costas y el Desierto/g)?.length ?? 0).toBe(1)
    expect(finalText.match(/La Serena \/ Coquimbo/g)?.length ?? 0).toBe(1)
  })

  it('blocks the stream when upstream already contains duplication', async () => {
    const duplicatedTail =
      'según tu destino soñado. Todo está calculado en dólares estadounidenses (USD) y pesos chilenos (CLP) para que tengas una visión clara.\\n\\nRUTA 1 – Capital, Costas y el Desierto\\nDía\\tUbicación\\tAlojamiento típico\\tComidas\\tTransporte\\tActividades\\tCosto aproximado en USD/CLP*\\n1\\tSantiago\\tHostal o hotel económico (doble compartido)\\n2\\tSantiago\\tIgual\\n3\\tValparaíso\\tTraslado en bus\\n4\\tLa Serena / Coquimbo\\tAlojamiento similar'

    const upstreamChunks = [
      'data: {"type":"text","text":"¡Hola! Aquí tienes una guía de presupuesto de 7 días en Chile con dos rutas populares (y económicas) que puedes elegir según tu destino soñado. Todo está calculado en dólares estadounidenses (USD) y pesos chilenos (CLP) para que tengas una visión clara.\\n\\nRUTA 1 – Capital, Costas y el Desierto\\nDía\\tUbicación\\tAlojamiento típico\\tComidas\\tTransporte\\tActividades\\tCosto aproximado en USD/CLP*\\n1\\tSantiago\\tHostal o hotel económico (doble compartido)\\n2\\tSantiago\\tIgual\\n3\\tValparaíso\\tTraslado en bus\\n4\\tLa Serena / Coquimbo\\tAlojamiento similar "}\n\n',
      `data: {"type":"text","text":"${duplicatedTail}"}\n\n`,
      'data: [DONE]\n\n',
    ]

    const { trace, finalText } = await consumeSse(guardChatStream(createSseStream(upstreamChunks)))

    console.log('\n[trace duplicated upstream]\n' + JSON.stringify(trace, null, 2))
    console.log('\n[final duplicated text]\n' + finalText)

    expect(finalText.match(/RUTA 1 – Capital, Costas y el Desierto/g)?.length ?? 0).toBe(1)
    expect(trace.some((entry) => entry.event === 'error')).toBe(true)
  })
})
