import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createChatStream, createErrorPayload, type ChatStreamPayload } from '@/lib/ai'
import { getOrCreateConversation, getHistory, saveMessage } from '@/lib/db'
import { toIpHashHint, trackAppEvent } from '@/lib/observability'
import { collectValidatedChatResult, createBufferedSseStream } from '@/lib/output-guard'
import { getDomainMismatchPayload } from '@/lib/domain-guard'

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
  const domainMismatchPayload = getDomainMismatchPayload(message)

  if (domainMismatchPayload) {
    trackAppEvent('chat_provider_error', {
      sessionId,
      conversationId,
      errorCode: 'domain_mismatch',
      retryable: false,
      provider: 'openrouter',
      hasBindings: Boolean(db || kv),
    })
    return createSseResponse(domainMismatchPayload, 400)
  }

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

  const result = await collectValidatedChatResult(createChatStream(messages, apiKey))

  if (result.error) {
    trackAppEvent('chat_provider_error', {
      sessionId,
      conversationId,
      errorCode: result.error.code,
      retryable: result.error.retryable,
      provider: 'openrouter',
      hasBindings: Boolean(db || kv),
    })
    return createSseResponse(result.error, 200)
  }

  if (db && conversationId && result.text) {
    await saveMessage(db, conversationId, 'assistant', result.text)
  }

  if (result.text) {
    trackAppEvent('chat_response_completed', {
      sessionId,
      conversationId,
      responseLength: result.text.length,
      hasBindings: Boolean(db || kv),
      provider: 'openrouter',
    })
  }

  return new Response(createBufferedSseStream(result.text), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
