import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createChatStream } from '@/lib/ai'
import { getOrCreateConversation, getHistory, saveMessage } from '@/lib/db'

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

  try {
    const { env } = await getCloudflareContext({ async: true })
    db = env.travel2chile_db
    kv = env.travel2chile_kv
  } catch {
    // Running in local dev — no CF bindings, API key comes from .env.local
  }

  // Rate limiting (only when KV is available)
  if (kv) {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon'
    const rateKey = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`
    const count = Number((await kv.get(rateKey)) || 0)
    if (count >= 40) {
      return new Response(
        'data: {"error":"Límite de 40 mensajes/hora alcanzado. Intenta más tarde."}\n\ndata: [DONE]\n\n',
        { status: 429, headers: { 'Content-Type': 'text/event-stream' } }
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
    await saveMessage(db, conversationId, 'user', message)
  }

  const messages = [...history, { role: 'user' as const, content: message }]

  if (!apiKey) {
    return new Response(
      'data: {"error":"API key no configurada."}\n\ndata: [DONE]\n\n',
      { status: 500, headers: { 'Content-Type': 'text/event-stream' } }
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
              if (d.text) full += d.text
            } catch {}
          }
        }
      }
      if (full) await saveMessage(dbRef, convId, 'assistant', full)
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
