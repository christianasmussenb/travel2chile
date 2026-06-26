export type StreamDebugContext = {
  enabled: boolean
  traceId: string
  stage: string
}

function summarizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140)
}

function fingerprint(text: string) {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

export function createStreamDebugContext(enabled: boolean, traceId: string, stage: string): StreamDebugContext {
  return { enabled, traceId, stage }
}

export function logStreamDebug(
  ctx: StreamDebugContext | undefined,
  event: string,
  data: Record<string, unknown> = {}
) {
  if (!ctx?.enabled) return

  console.log(
    JSON.stringify({
      source: 'travel2chile',
      type: 'stream_debug',
      traceId: ctx.traceId,
      stage: ctx.stage,
      event,
      timestamp: new Date().toISOString(),
      ...data,
    })
  )
}

export function describeTextChunk(text: string) {
  return {
    length: text.length,
    fingerprint: fingerprint(text),
    preview: summarizeText(text),
  }
}
