import OpenAI from 'openai'
import { describeTextChunk, logStreamDebug, type StreamDebugContext } from './stream-debug'

const SYSTEM_PROMPT = `Eres un asistente virtual especializado en viajes por Chile.
Tu objetivo es ayudar a planificar viajes con información práctica sobre destinos,
transporte, alojamiento, costos, temporadas y actividades.

Principios:
- Respuestas concisas y específicas a la pregunta actual
- Incluye rangos de precio en USD y CLP cuando sea relevante
- Menciona la mejor época del año para cada destino
- Sugiere 1-2 alternativas cuando corresponda
- Tono cálido y entusiasta, como un amigo experto en Chile
- Responde solo para el usuario final, en español
- Nunca muestres razonamiento interno, análisis, borradores ni texto meta sobre cómo respondes

Destinos que dominas: Torres del Paine, San Pedro de Atacama, Santiago,
Valparaíso, Puerto Natales, Chiloé, Valle del Elqui, Pucón, Puerto Varas,
Rapa Nui (Isla de Pascua), Carretera Austral, Arica, Viña del Mar.`

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type AIProvider = 'openrouter' | 'nvidia'

export type AIConfig = {
  provider: AIProvider
  apiKey: string
  model: string
  baseURL: string
  referer?: string
  title?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  enableThinking?: boolean
  reasoningBudget?: number
}

export type ChatErrorCode =
  | 'config_error'
  | 'domain_mismatch'
  | 'rate_limit'
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_error'
  | 'invalid_model_output'
  | 'network_error'

export type ChatStreamPayload =
  | { type: 'text'; text: string; seq?: number }
  | {
      type: 'error'
      code: ChatErrorCode
      message: string
      retryable: boolean
      seq?: number
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

function classifyProviderErrorWithConfig(error: unknown, config: AIConfig) {
  const providerName = config.provider === 'nvidia' ? 'NVIDIA' : 'OpenRouter'
  const payload = classifyProviderError(error)

  if (payload.code === 'provider_rate_limit') {
    return {
      ...payload,
      message: `${providerName} alcanzó su límite temporal. Intenta nuevamente en unos minutos.`,
    } satisfies typeof payload
  }

  if (payload.code === 'provider_timeout') {
    return {
      ...payload,
      message: `${providerName} tardó demasiado en responder. Intenta nuevamente.`,
    } satisfies typeof payload
  }

  if (payload.code === 'provider_error') {
    return {
      ...payload,
      message: `${providerName} no pudo generar una respuesta en este momento.`,
    } satisfies typeof payload
  }

  return payload
}

export function resolveAIConfigFromEnv(env = process.env): AIConfig {
  const provider = (env.AI_PROVIDER || 'openrouter').toLowerCase() as AIProvider

  if (provider === 'nvidia') {
    return {
      provider: 'nvidia',
      apiKey: env.NVIDIA_API_KEY || '',
      model: env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
      baseURL: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      title: 'Travel2Chile',
      maxTokens: Number(env.NVIDIA_MAX_TOKENS || 4096),
      temperature: Number(env.NVIDIA_TEMPERATURE || 0.7),
      topP: Number(env.NVIDIA_TOP_P || 0.95),
      enableThinking: env.NVIDIA_ENABLE_THINKING === '1',
      reasoningBudget: Number(env.NVIDIA_REASONING_BUDGET || 0),
    }
  }

  return {
    provider: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY || '',
    model: env.OPENROUTER_MODEL || 'openrouter/free',
    baseURL: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    referer: 'https://travel2chile.com',
    title: 'Travel2Chile',
    maxTokens: Number(env.OPENROUTER_MAX_TOKENS || 1024),
  }
}

export function getPublicAIStatusLabel(env = process.env) {
  const config = resolveAIConfigFromEnv(env)
  const providerLabel = config.provider === 'nvidia' ? 'NVIDIA' : 'OpenRouter'
  const modelLabel = config.model.replace(/^nvidia\//, '').replace(/^openrouter\//, '')
  return `Servicio: ${providerLabel} · Modelo: ${modelLabel}`
}

export function createChatStream(messages: Message[], config: AIConfig, debug?: StreamDebugContext): ReadableStream {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: {
      ...(config.referer ? { 'HTTP-Referer': config.referer } : {}),
      ...(config.title ? { 'X-Title': config.title } : {}),
    },
  })

  return new ReadableStream({
    async start(controller) {
      try {
        logStreamDebug(debug, 'provider_request_started', {
          messageCount: messages.length,
          provider: config.provider,
          model: config.model,
        })

        const stream = await client.chat.completions.create({
          model: config.model,
          max_tokens: config.maxTokens,
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          ...(config.topP !== undefined ? { top_p: config.topP } : {}),
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          ...(config.provider === 'nvidia'
            ? {
                extra_body: {
                  ...(config.enableThinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
                  ...(config.enableThinking && config.reasoningBudget
                    ? { reasoning_budget: config.reasoningBudget }
                    : {}),
                },
              }
            : {}),
        })

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          logStreamDebug(debug, 'provider_chunk_received', {
            finishReason: chunk.choices[0]?.finish_reason ?? null,
            ...describeTextChunk(text),
          })
          if (text) {
            controller.enqueue(encodeSseChunk({ type: 'text', text }))
          }
          if (chunk.choices[0]?.finish_reason === 'stop') break
        }

        logStreamDebug(debug, 'provider_stream_done')
        controller.enqueue(encodeSseChunk('[DONE]'))
        controller.close()
      } catch (error) {
        logStreamDebug(debug, 'provider_stream_error', {
          error: error instanceof Error ? error.message : String(error),
        })
        controller.enqueue(encodeSseChunk(classifyProviderErrorWithConfig(error, config)))
        controller.enqueue(encodeSseChunk('[DONE]'))
        controller.close()
      }
    },
  })
}
