import type { Message } from './ai'

export async function getOrCreateConversation(
  db: D1Database,
  sessionId: string
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM conversations
       WHERE session_id = ?
       AND updated_at > datetime('now', '-24 hours')
       ORDER BY updated_at DESC LIMIT 1`
    )
    .bind(sessionId)
    .first<{ id: string }>()

  if (existing) return existing.id

  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO conversations (id, session_id) VALUES (?, ?)')
    .bind(id, sessionId)
    .run()

  return id
}

export async function getHistory(
  db: D1Database,
  conversationId: string,
  limit = 10
): Promise<Message[]> {
  const rows = await db
    .prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC LIMIT ?`
    )
    .bind(conversationId, limit)
    .all<Message>()

  return rows.results || []
}

export async function saveMessage(
  db: D1Database,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
    )
    .bind(id, conversationId, role, content)
    .run()

  await db
    .prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(conversationId)
    .run()
}

export async function clearConversation(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM messages WHERE conversation_id IN
       (SELECT id FROM conversations WHERE session_id = ?)`
    )
    .bind(sessionId)
    .run()

  await db
    .prepare('DELETE FROM conversations WHERE session_id = ?')
    .bind(sessionId)
    .run()
}
