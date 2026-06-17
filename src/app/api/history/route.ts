import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getOrCreateConversation, getHistory, clearConversation } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId') || ''

  try {
    const { env } = await getCloudflareContext({ async: true })
    const conversationId = await getOrCreateConversation(env.travel2chile_db, sessionId)
    const history = await getHistory(env.travel2chile_db, conversationId, 20)
    return Response.json({ history, conversationId })
  } catch {
    // CF bindings not available in local dev — return empty history
    return Response.json({ history: [], conversationId: null })
  }
}

export async function DELETE(request: Request) {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const { sessionId } = (await request.json()) as { sessionId: string }
    await clearConversation(env.travel2chile_db, sessionId)
  } catch {
    // CF bindings not available — no-op in dev
  }
  return Response.json({ ok: true })
}
