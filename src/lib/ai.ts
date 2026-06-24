import OpenAI from 'openai'

const SYSTEM_PROMPT = `Eres un asistente virtual especializado en viajes por Chile.
Tu objetivo es ayudar a planificar viajes con información práctica sobre destinos,
transporte, alojamiento, costos, temporadas y actividades.

Principios:
- Respuestas concisas y específicas a la pregunta actual
- Incluye rangos de precio en USD y CLP cuando sea relevante
- Menciona la mejor época del año para cada destino
- Sugiere 1-2 alternativas cuando corresponda
- Tono cálido y entusiasta, como un amigo experto en Chile

Destinos que dominas: Torres del Paine, San Pedro de Atacama, Santiago,
Valparaíso, Puerto Natales, Chiloé, Valle del Elqui, Pucón, Puerto Varas,
Rapa Nui (Isla de Pascua), Carretera Austral, Arica, Viña del Mar.`

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type ChatErrorCode =
  | 'config_error'
  | 'rate_limit'
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_error'
  | 'network_error'

export type ChatStreamPayload =
  | { type: 'text'; text: string }
  | {
      type: 'error'
      code: ChatErrorCode
      message: string
      retryable: boolean
    }

function encodeSseChunk(payload: ChatStreamPayload | '[DONE]') {
  return new TextEncoder().encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
}

export function createErrorPayload(
  code: ChatErrorCode,
  message: string,
  retryable: boolean
): Extract<ChatStreamPayload, { type: 'error' }> {
  return { type: 'error', code, message, retryable }
}

function classifyProviderError(error: unknown) {
  const apiError = error as {
    status?: number
    code?: string
    name?: string
    message?: string
  }

  const status = apiError?.status
  const code = String(apiError?.code ?? '').toLowerCase()
  const name = String(apiError?.name ?? '').toLowerCase()
  const message = String(apiError?.message ?? 'Error desconocido').toLowerCase()

  if (status === 429 || code.includes('rate') || message.includes('rate limit')) {
    return createErrorPayload(
      'provider_rate_limit',
      'OpenRouter alcanzó su límite temporal. Intenta nuevamente en unos minutos.',
      true
    )
  }

  if (
    name.includes('abort') ||
    code.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return createErrorPayload(
      'provider_timeout',
      'OpenRouter tardó demasiado en responder. Intenta nuevamente.',
      true
    )
  }

  if (status === 401 || status === 403) {
    return createErrorPayload(
      'config_error',
      'La configuración del proveedor de IA no es válida en este entorno.',
      false
    )
  }

  return createErrorPayload(
    'provider_error',
    'OpenRouter no pudo generar una respuesta en este momento.',
    true
  )
}

export function createChatStream(messages: Message[], apiKey: string): ReadableStream {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://travel2chile.com',
      'X-Title': 'Travel2Chile',
    },
  })

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model: 'openrouter/free',
          max_tokens: 1024,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        })

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) {
            controller.enqueue(encodeSseChunk({ type: 'text', text }))
          }
          if (chunk.choices[0]?.finish_reason === 'stop') break
        }

        controller.enqueue(encodeSseChunk('[DONE]'))
        controller.close()
      } catch (error) {
        controller.enqueue(encodeSseChunk(classifyProviderError(error)))
        controller.enqueue(encodeSseChunk('[DONE]'))
        controller.close()
      }
    },
  })
}
