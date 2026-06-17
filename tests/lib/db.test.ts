import { describe, expect, it } from 'vitest'
import { clearConversation, getHistory, getOrCreateConversation, saveMessage } from '@/lib/db'
import { MockD1Database } from '../helpers/mock-cloudflare'

describe('db helpers', () => {
  it('creates, reuses, expires and clears conversations', async () => {
    const db = new MockD1Database()

    const first = await getOrCreateConversation(db as unknown as D1Database, 'session-1')
    const reused = await getOrCreateConversation(db as unknown as D1Database, 'session-1')

    expect(reused).toBe(first)
    expect(db.conversations.size).toBe(1)

    db.setConversationUpdatedAt(first, new Date(Date.now() - 25 * 60 * 60 * 1000))

    const second = await getOrCreateConversation(db as unknown as D1Database, 'session-1')
    expect(second).not.toBe(first)
    expect(db.conversations.size).toBe(2)
  })

  it('saves and returns messages in order, then clears the session', async () => {
    const db = new MockD1Database()
    const conversationId = await getOrCreateConversation(db as unknown as D1Database, 'session-2')

    await saveMessage(db as unknown as D1Database, conversationId, 'user', 'Hola')
    await saveMessage(db as unknown as D1Database, conversationId, 'assistant', 'Hola, ¿en qué te ayudo?')

    const history = await getHistory(db as unknown as D1Database, conversationId, 20)
    expect(history).toEqual([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
    ])

    await clearConversation(db as unknown as D1Database, 'session-2')

    expect(db.conversations.size).toBe(0)
    expect(db.messages).toHaveLength(0)
  })
})
