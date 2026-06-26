import { createErrorPayload, type ChatStreamPayload } from './ai'
import { extractSseFrames } from './sse'
import { describeTextChunk, logStreamDebug, type StreamDebugContext } from './stream-debug'

const REASONING_PATTERNS = [
  'okay, the user is asking',
  'let me check the conversation history',
  'i need to recall',
  'i should structure the answer',
  'let me outline',
  'based on standard responses',
]

const SUSPICIOUS_ENDINGS = [
  '\t$',
  '\n$',
  '\nC',
  'let me outline:',
  'desayuno: si tu alojamiento incluye desayuno',
]

const CORRUPTION_PATTERNS = [
  '€16/europa',
  'treasury de trastevere',
  'biciculto',
  'paraoctavo',
  '€25ida',
  'rki',
  'blood fireplace bbq',
  'puerto encodable',
  'widow maker',
]

const RESTART_MARKERS = [
  'qué encontrarás',
  'alternativas (si quieres cambiar de escenario):',
  'día 1:',
  'día 2:',
  'día 3:',
  'alojamiento:',
  'comida:',
  'recorrido:',
  'paisajes:',
  'gastronomía:',
]

function encodeSseChunk(payload: ChatStreamPayload | '[DONE]') {
  return new TextEncoder().encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
}

function emitTextChunk(controller: ReadableStreamDefaultController<Uint8Array>, text: string, seq: number) {
  controller.enqueue(encodeSseChunk({ type: 'text', text, seq }))
}

function parseSseLine(line: string): ChatStreamPayload | null {
  if (!line.startsWith('data: ') || line.includes('[DONE]')) return null

  try {
    const payload = JSON.parse(line.slice(6)) as ChatStreamPayload | { text?: string; error?: string }
    if ('type' in payload) return payload
    if (payload.text) return { type: 'text', text: payload.text }
    if (payload.error) return createErrorPayload('provider_error', payload.error, true)
  } catch {
    return null
  }

  return null
}

function looksLikeReasoningLeak(text: string) {
  const normalized = text.toLowerCase()
  return REASONING_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function looksTruncated(text: string) {
  const trimmed = text.trimEnd()
  if (trimmed.length < 40) return false
  return SUSPICIOUS_ENDINGS.some((ending) => trimmed.endsWith(ending))
}

function looksCorrupted(text: string) {
  const normalized = text.toLowerCase()
  if (CORRUPTION_PATTERNS.some((pattern) => normalized.includes(pattern))) return true
  if (/[Ѐ-ӿ]/u.test(text)) return true
  if (/€\d+[a-z]/i.test(text) || /€\d+\/[a-z]/i.test(text)) return true
  return false
}

function looksRepeatedOrRestarted(text: string) {
  const normalized = text.toLowerCase()

  if (
    RESTART_MARKERS.some(
      (marker) => normalized.includes(marker) && normalized.indexOf(marker) !== normalized.lastIndexOf(marker)
    )
  ) {
    return true
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 18)

  const seen = new Set<string>()
  for (const line of lines) {
    if (seen.has(line)) return true
    seen.add(line)
  }

  const firstParagraph = normalized
    .split('\n\n')
    .map((part) => part.trim())
    .find((part) => part.length >= 40)

  if (firstParagraph) {
    const repeatedPrefix = firstParagraph.slice(0, Math.min(firstParagraph.length, 80))
    const nextIndex = normalized.indexOf(repeatedPrefix, repeatedPrefix.length + 40)
    if (nextIndex !== -1) return true
  }

  const compact = normalized.replace(/\s+/g, ' ').trim()
  if (compact.length >= 240) {
    const recentWindow = compact.slice(-180)
    const windowStart = recentWindow.length >= 120 ? recentWindow.slice(0, 120) : recentWindow

    if (windowStart.length >= 80) {
      const previousIndex = compact.indexOf(windowStart)
      const latestIndex = compact.lastIndexOf(windowStart)
      if (previousIndex !== -1 && latestIndex !== -1 && latestIndex - previousIndex >= windowStart.length) {
        return true
      }
    }
  }

  return false
}

function looksBrokenEnding(text: string) {
  const trimmed = text.trimEnd()
  if (trimmed.length < 30) return false
  return /\*\*[A-Za-zÁÉÍÓÚáéíóúñÑ]{0,6}$/.test(trimmed) || /\b[CcRr]$/.test(trimmed)
}

export function guardChatStream(stream: ReadableStream, debug?: StreamDebugContext) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let bufferedText = ''
      let pendingFrame = ''
      let bufferReleased = false
      let blocked = false
      let textSeq = 0

      while (true) {
        const { done, value } = await reader.read()
        const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })
        const { frames, remainder } = extractSseFrames(chunk, pendingFrame)
        pendingFrame = remainder
        logStreamDebug(debug, 'guard_transport_chunk', {
          done,
          chunkLength: chunk.length,
          frameCount: frames.length,
          remainderLength: remainder.length,
        })

        for (const frame of frames) {
          const line = frame.trim()
          if (line === 'data: [DONE]') {
            if (!blocked && bufferedText && !looksTruncated(accumulated) && !looksBrokenEnding(accumulated)) {
              emitTextChunk(controller, bufferedText, textSeq++)
              bufferedText = ''
            }

            if (!blocked && (looksTruncated(accumulated) || looksBrokenEnding(accumulated))) {
              blocked = true
              controller.enqueue(
                encodeSseChunk(
                  createErrorPayload(
                    'invalid_model_output',
                    'La respuesta del modelo llegó incompleta. Intenta nuevamente.',
                    true
                  )
                )
              )
            }

            controller.enqueue(encodeSseChunk('[DONE]'))
            controller.close()
            return
          }

          const payload = parseSseLine(line)
          if (!payload) continue

          if (payload.type === 'error') {
            logStreamDebug(debug, 'guard_forward_error', payload)
            controller.enqueue(encodeSseChunk(payload))
            continue
          }

          logStreamDebug(debug, 'guard_text_received', {
            seq: textSeq,
            ...describeTextChunk(payload.text),
          })
          accumulated += payload.text

          if (looksLikeReasoningLeak(accumulated)) {
            blocked = true
            controller.enqueue(
              encodeSseChunk(
                createErrorPayload(
                  'invalid_model_output',
                  'El modelo devolvió una respuesta inválida. Intenta nuevamente.',
                  true
                )
              )
            )
            controller.enqueue(encodeSseChunk('[DONE]'))
            controller.close()
            return
          }

          if (looksCorrupted(accumulated)) {
            blocked = true
            controller.enqueue(
              encodeSseChunk(
                createErrorPayload(
                  'invalid_model_output',
                  'El modelo devolvió contenido inconsistente. Intenta nuevamente.',
                  true
                )
              )
            )
            controller.enqueue(encodeSseChunk('[DONE]'))
            controller.close()
            return
          }

          if (looksRepeatedOrRestarted(accumulated)) {
            blocked = true
            controller.enqueue(
              encodeSseChunk(
                createErrorPayload(
                  'invalid_model_output',
                  'La respuesta del modelo se reinició o repitió de forma anómala. Intenta nuevamente.',
                  true
                )
              )
            )
            controller.enqueue(encodeSseChunk('[DONE]'))
            controller.close()
            return
          }

          if (!bufferReleased) {
            bufferedText += payload.text
            const shouldRelease =
              bufferedText.length >= 120 ||
              /[.!?]\s$/.test(bufferedText) ||
              bufferedText.includes('\n')

            if (!shouldRelease) continue

            bufferReleased = true
            logStreamDebug(debug, 'guard_release_buffer', {
              seq: textSeq,
              ...describeTextChunk(bufferedText),
            })
            emitTextChunk(controller, bufferedText, textSeq++)
            bufferedText = ''
            continue
          }

          logStreamDebug(debug, 'guard_emit_text', {
            seq: textSeq,
            ...describeTextChunk(payload.text),
          })
          emitTextChunk(controller, payload.text, textSeq++)
        }

        if (done) break
      }

      if (!blocked) {
        if (bufferedText) {
          emitTextChunk(controller, bufferedText, textSeq++)
        }
        if (looksTruncated(accumulated) || looksBrokenEnding(accumulated)) {
          controller.enqueue(
            encodeSseChunk(
              createErrorPayload(
                'invalid_model_output',
                'La respuesta del modelo llegó incompleta. Intenta nuevamente.',
                true
              )
            )
          )
        }
        if (looksCorrupted(accumulated)) {
          controller.enqueue(
            encodeSseChunk(
              createErrorPayload(
                'invalid_model_output',
                'El modelo devolvió contenido inconsistente. Intenta nuevamente.',
                true
              )
            )
          )
        }
        if (looksRepeatedOrRestarted(accumulated)) {
          controller.enqueue(
            encodeSseChunk(
              createErrorPayload(
                'invalid_model_output',
                'La respuesta del modelo se reinició o repitió de forma anómala. Intenta nuevamente.',
                true
              )
            )
          )
        }
        controller.enqueue(encodeSseChunk('[DONE]'))
      }
      controller.close()
    },
  })
}
