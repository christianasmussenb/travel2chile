import { createErrorPayload, type ChatStreamPayload } from './ai'

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

  return false
}

function looksBrokenEnding(text: string) {
  const trimmed = text.trimEnd()
  if (trimmed.length < 30) return false
  return /\*\*[A-Za-zÁÉÍÓÚáéíóúñÑ]{0,6}$/.test(trimmed) || /\b[CcRr]$/.test(trimmed)
}

function validateModelText(text: string): Extract<ChatStreamPayload, { type: 'error' }> | null {
  if (looksLikeReasoningLeak(text)) {
    return createErrorPayload(
      'invalid_model_output',
      'El modelo devolvió una respuesta inválida. Intenta nuevamente.',
      true
    )
  }

  if (looksCorrupted(text)) {
    return createErrorPayload(
      'invalid_model_output',
      'El modelo devolvió contenido inconsistente. Intenta nuevamente.',
      true
    )
  }

  if (looksRepeatedOrRestarted(text)) {
    return createErrorPayload(
      'invalid_model_output',
      'La respuesta del modelo se reinició o repitió de forma anómala. Intenta nuevamente.',
      true
    )
  }

  if (looksTruncated(text) || looksBrokenEnding(text)) {
    return createErrorPayload(
      'invalid_model_output',
      'La respuesta del modelo llegó incompleta. Intenta nuevamente.',
      true
    )
  }

  return null
}

export async function collectValidatedChatResult(stream: ReadableStream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let providerError: Extract<ChatStreamPayload, { type: 'error' }> | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    for (const line of chunk.split('\n')) {
      const payload = parseSseLine(line)
      if (!payload) continue

      if (payload.type === 'error') {
        providerError = payload
        continue
      }

      fullText += payload.text
    }
  }

  if (providerError) {
    return { text: '', error: providerError }
  }

  const validationError = validateModelText(fullText)
  if (validationError) {
    return { text: '', error: validationError }
  }

  return { text: fullText, error: null }
}

export function createBufferedSseStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const chunks = text.match(/.{1,220}(\s|$)/g) ?? [text]
      for (const chunk of chunks) {
        controller.enqueue(encodeSseChunk({ type: 'text', text: chunk }))
      }
      controller.enqueue(encodeSseChunk('[DONE]'))
      controller.close()
    },
  })
}
