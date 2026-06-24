import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createChatStream, createErrorPayload, type ChatStreamPayload } from '@/lib/ai'
import { getOrCreateConversation, getHistory, saveMessage } from '@/lib/db'
import { toIpHashHint, trackAppEvent } from '@/lib/observability'

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
  const apiKey = process.env.OPENROUTER_API_KEY || ''
  const ip = request.headers.get('CF-Connecting-IP')
  const ipHashHint = toIpHashHint(ip)

  try {
    const { env } = await getCloudflareContext({ async: true })
    db = env.travel2chile_db
    kv = env.travel2chile_kv
  } catch {
    // Running in local dev — no CF bindings, API key comes from .env.local
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

  if (!apiKey) {
    trackAppEvent('chat_provider_error', {
      sessionId,
      conversationId,
      errorCode: 'config_error',
      retryable: false,
      provider: 'openrouter',
      hasBindings: Boolean(db || kv),
    })
    return createSseResponse(
      createErrorPayload(
        'config_error',
        'La API key de OpenRouter no está configurada.',
        false
      ),
      500
    )
  }

  // Tee the stream: one for the client, one for saving to D1
  const [streamForClient, streamForSaving] = createChatStream(messages, apiKey).tee()

  // Save assistant response in background (only if D1 available)
  if (db && conversationId) {
    const dbRef = db
    const convId = conversationId
    ;(async () => {
      let full = ''
      let hasError = false
      let lastErrorCode: string | null = null
      let lastRetryable: boolean | null = null
      const reader = streamForSaving.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const d = JSON.parse(line.slice(6))
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
      }
      if (!hasError && full) {
        await saveMessage(dbRef, convId, 'assistant', full)
        trackAppEvent('chat_response_completed', {
          sessionId,
          conversationId: convId,
          responseLength: full.length,
          hasBindings: true,
          provider: 'openrouter',
        })
      }
      if (hasError) {
        trackAppEvent('chat_provider_error', {
          sessionId,
          conversationId: convId,
          errorCode: lastErrorCode ?? 'provider_error',
          retryable: lastRetryable ?? true,
          provider: 'openrouter',
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
      const reader = streamForSaving.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const d = JSON.parse(line.slice(6))
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
      }
      if (!hasError && full) {
        trackAppEvent('chat_response_completed', {
          sessionId,
          conversationId,
          responseLength: full.length,
          hasBindings: false,
          provider: 'openrouter',
        })
      }
      if (hasError) {
        trackAppEvent('chat_provider_error', {
          sessionId,
          conversationId,
          errorCode: lastErrorCode ?? 'provider_error',
          retryable: lastRetryable ?? true,
          provider: 'openrouter',
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
    },
  })
}
