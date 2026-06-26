import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getOrCreateConversation, getHistory, clearConversation } from '@/lib/db'
import { trackAppEvent } from '@/lib/observability'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId') || ''
  const disableBindingsInDev = process.env.DISABLE_CLOUDFLARE_BINDINGS_IN_DEV === '1'

  if (disableBindingsInDev) {
    return Response.json({ history: [], conversationId: null })
  }

  try {
    const { env } = await getCloudflareContext({ async: true })
    const conversationId = await getOrCreateConversation(env.travel2chile_db, sessionId)
    const history = await getHistory(env.travel2chile_db, conversationId, 20)
    trackAppEvent('chat_session_started', {
      sessionId,
      conversationId,
      historyCount: history.length,
      hasBindings: true,
    })
    return Response.json({ history, conversationId })
  } catch {
    // CF bindings not available in local dev — return empty history
    return Response.json({ history: [], conversationId: null })
  }
}

export async function DELETE(request: Request) {
  const { sessionId } = (await request.json()) as { sessionId: string }
  const disableBindingsInDev = process.env.DISABLE_CLOUDFLARE_BINDINGS_IN_DEV === '1'

  if (disableBindingsInDev) {
    trackAppEvent('chat_history_cleared', { sessionId, hasBindings: false })
    return Response.json({ ok: true })
  }

  try {
    const { env } = await getCloudflareContext({ async: true })
    await clearConversation(env.travel2chile_db, sessionId)
    trackAppEvent('chat_history_cleared', { sessionId, hasBindings: true })
  } catch {
    // CF bindings not available — no-op in dev
    trackAppEvent('chat_history_cleared', { sessionId, hasBindings: false })
  }
  return Response.json({ ok: true })
}
