import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createChatStream, createErrorPayload, resolveAIConfigFromEnv, type ChatStreamPayload } from '@/lib/ai'
import { getOrCreateConversation, getHistory, saveMessage } from '@/lib/db'
import { toIpHashHint, trackAppEvent } from '@/lib/observability'
import { guardChatStream } from '@/lib/output-guard'
import { getDomainMismatchPayload } from '@/lib/domain-guard'
import { extractSseFrames } from '@/lib/sse'
import { createStreamDebugContext, describeTextChunk, logStreamDebug } from '@/lib/stream-debug'

function createSseResponse(payload: ChatStreamPayload, status: number) {
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export async function POST(request: Request) {
  const { message, sessionId } = (await request.json()) as {
    message: string
    sessionId: string
  }

  if (!message?.trim()) {
    return new Response('Mensaje requerido', { status: 400 })
  }

  // Try to get CF bindings — available in production (Workers) but not in next dev
  let db: D1Database | null = null
  let kv: KVNamespace | null = null
  const aiConfig = resolveAIConfigFromEnv()
  const ip = request.headers.get('CF-Connecting-IP')
  const ipHashHint = toIpHashHint(ip)
  const streamDebugEnabled = request.headers.get('X-Travel2Chile-Stream-Debug') === '1'
  const disableBindingsInDev = process.env.DISABLE_CLOUDFLARE_BINDINGS_IN_DEV === '1'
  const streamTraceId = crypto.randomUUID().slice(0, 8)
  const providerDebug = createStreamDebugContext(streamDebugEnabled, streamTraceId, 'provider')
  const guardDebug = createStreamDebugContext(streamDebugEnabled, streamTraceId, 'guard')
  const routeDebug = createStreamDebugContext(streamDebugEnabled, streamTraceId, 'route')

  if (!disableBindingsInDev) {
    try {
      const { env } = await getCloudflareContext({ async: true })
      db = env.travel2chile_db
      kv = env.travel2chile_kv
    } catch {
      // Running in local dev — no CF bindings, API key comes from .env.local
    }
  }

  // Rate limiting (only when KV is available)
  if (kv) {
    const rateKey = `rate:${ip || 'anon'}:${Math.floor(Date.now() / 3600000)}`
    const count = Number((await kv.get(rateKey)) || 0)
    if (count >= 40) {
      trackAppEvent('chat_rate_limited', {
        sessionId,
        messageLength: message.length,
        hasBindings: Boolean(db || kv),
        ipHashHint,
      })
      return createSseResponse(
        createErrorPayload(
          'rate_limit',
          'Límite de 40 mensajes por hora alcanzado. Intenta más tarde.',
          true
        ),
        429
      )
    }
    await kv.put(rateKey, String(count + 1), { expirationTtl: 3600 })
  }

  // Build message history from D1 (if available)
  let conversationId: string | null = null
  let history: { role: 'user' | 'assistant'; content: string }[] = []

  if (db) {
    conversationId = await getOrCreateConversation(db, sessionId)
    history = await getHistory(db, conversationId, 20)
    trackAppEvent('chat_session_started', {
      sessionId,
      conversationId,
      historyCount: history.length,
      hasBindings: true,
    })
    await saveMessage(db, conversationId, 'user', message)
  }

  trackAppEvent('chat_message_sent', {
    sessionId,
    conversationId,
    messageLength: message.length,
    historyCount: history.length,
    hasBindings: Boolean(db || kv),
    ipHashHint,
  })

  const messages = [...history, { role: 'user' as const, content: message }]
  const domainMismatchPayload = getDomainMismatchPayload(message)

  if (domainMismatchPayload) {
    trackAppEvent('chat_provider_error', {
      sessionId,
      conversationId,
      errorCode: 'domain_mismatch',
      retryable: false,
      provider: aiConfig.provider,
      hasBindings: Boolean(db || kv),
    })
    return createSseResponse(domainMismatchPayload, 400)
  }

  if (!aiConfig.apiKey) {
    trackAppEvent('chat_provider_error', {
      sessionId,
      conversationId,
      errorCode: 'config_error',
      retryable: false,
      provider: aiConfig.provider,
      hasBindings: Boolean(db || kv),
    })
    return createSseResponse(
      createErrorPayload(
        'config_error',
        `La API key de ${aiConfig.provider === 'nvidia' ? 'NVIDIA' : 'OpenRouter'} no está configurada.`,
        false
      ),
      500
    )
  }

  logStreamDebug(routeDebug, 'request_started', {
    sessionId,
    historyCount: history.length,
    hasBindings: Boolean(db || kv),
  })

  const guardedStream = guardChatStream(createChatStream(messages, aiConfig, providerDebug), guardDebug)
  const [streamForClient, streamForSaving] = guardedStream.tee()

  if (db && conversationId) {
    const dbRef = db
    const convId = conversationId
    ;(async () => {
      let full = ''
      let hasError = false
      let lastErrorCode: string | null = null
      let lastRetryable: boolean | null = null
      let pendingFrame = ''
      const reader = streamForSaving.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        const chunk = done ? dec.decode() : dec.decode(value, { stream: true })
        const { frames, remainder } = extractSseFrames(chunk, pendingFrame)
        pendingFrame = remainder
        for (const frame of frames) {
          const line = frame.trim()
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const d = JSON.parse(line.slice(6))
              if (d.type === 'text' && d.text) {
                logStreamDebug(routeDebug, 'tee_text_received', {
                  seq: d.seq ?? null,
                  ...describeTextChunk(d.text),
                })
              }
              if (d.type === 'error') {
                logStreamDebug(routeDebug, 'tee_error_received', {
                  code: d.code ?? null,
                  retryable: d.retryable ?? null,
                })
              }
              if (d.type === 'text' && d.text) full += d.text
              if (d.type === 'error') {
                hasError = true
                lastErrorCode = d.code ?? 'provider_error'
                lastRetryable = Boolean(d.retryable)
              }
              if (!d.type && d.text) full += d.text
              if (!d.type && d.error) hasError = true
            } catch {}
          }
        }
        if (done) break
      }
      if (!hasError && full) {
        await saveMessage(dbRef, convId, 'assistant', full)
        trackAppEvent('chat_response_completed', {
          sessionId,
          conversationId: convId,
          responseLength: full.length,
          hasBindings: true,
          provider: aiConfig.provider,
        })
      }
      if (hasError) {
        trackAppEvent('chat_provider_error', {
          sessionId,
          conversationId: convId,
          errorCode: lastErrorCode ?? 'provider_error',
          retryable: lastRetryable ?? true,
          provider: aiConfig.provider,
          hasBindings: true,
        })
      }
    })()
  } else {
    ;(async () => {
      let full = ''
      let hasError = false
      let lastErrorCode: string | null = null
      let lastRetryable: boolean | null = null
      let pendingFrame = ''
      const reader = streamForSaving.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        const chunk = done ? dec.decode() : dec.decode(value, { stream: true })
        const { frames, remainder } = extractSseFrames(chunk, pendingFrame)
        pendingFrame = remainder
        for (const frame of frames) {
          const line = frame.trim()
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const d = JSON.parse(line.slice(6))
              if (d.type === 'text' && d.text) {
                logStreamDebug(routeDebug, 'tee_text_received', {
                  seq: d.seq ?? null,
                  ...describeTextChunk(d.text),
                })
              }
              if (d.type === 'error') {
                logStreamDebug(routeDebug, 'tee_error_received', {
                  code: d.code ?? null,
                  retryable: d.retryable ?? null,
                })
              }
              if (d.type === 'text' && d.text) full += d.text
              if (d.type === 'error') {
                hasError = true
                lastErrorCode = d.code ?? 'provider_error'
                lastRetryable = Boolean(d.retryable)
              }
              if (!d.type && d.text) full += d.text
              if (!d.type && d.error) hasError = true
            } catch {}
          }
        }
        if (done) break
      }
      if (!hasError && full) {
        trackAppEvent('chat_response_completed', {
          sessionId,
          conversationId,
          responseLength: full.length,
          hasBindings: false,
          provider: aiConfig.provider,
        })
      }
      if (hasError) {
        trackAppEvent('chat_provider_error', {
          sessionId,
          conversationId,
          errorCode: lastErrorCode ?? 'provider_error',
          retryable: lastRetryable ?? true,
          provider: aiConfig.provider,
          hasBindings: false,
        })
      }
    })()
  }

  return new Response(streamForClient, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Chat-Trace-Id': streamTraceId,
    },
  })
}
