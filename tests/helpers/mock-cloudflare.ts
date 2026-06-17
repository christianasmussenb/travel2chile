type ConversationRow = {
  id: string
  session_id: string
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export class MockD1Database {
  conversations = new Map<string, ConversationRow>()

  messages: MessageRow[] = []

  private seq = 0

  private now() {
    return new Date(Date.now() + this.seq++).toISOString()
  }

  setConversationUpdatedAt(id: string, when: Date) {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`)
    }
    conversation.updated_at = when.toISOString()
  }

  prepare = (query: string) => {
    const normalized = query.replace(/\s+/g, ' ').trim()

    return {
      bind: (...values: unknown[]) => {
        return {
          first: async <T>() => {
            if (normalized.startsWith('SELECT id FROM conversations WHERE session_id = ?')) {
              const sessionId = String(values[0] ?? '')
              const cutoff = Date.now() - DAY_MS
              const rows = [...this.conversations.values()]
                .filter((row) => row.session_id === sessionId)
                .filter((row) => new Date(row.updated_at).getTime() > cutoff)
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
              return (rows[0] ?? null) as T | null
            }

            throw new Error(`Unsupported first() query: ${normalized}`)
          },
          all: async <T>() => {
            if (normalized.startsWith('SELECT role, content FROM messages WHERE conversation_id = ?')) {
              const conversationId = String(values[0] ?? '')
              const limit = Number(values[1] ?? 10)
              const rows = this.messages
                .filter((row) => row.conversation_id === conversationId)
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .slice(0, limit)
                .map((row) => ({ role: row.role, content: row.content }))
              return { results: rows as T[] }
            }

            throw new Error(`Unsupported all() query: ${normalized}`)
          },
          run: async () => {
            if (normalized === 'INSERT INTO conversations (id, session_id) VALUES (?, ?)') {
              const [id, sessionId] = values.map(String)
              const timestamp = this.now()
              this.conversations.set(id, {
                id,
                session_id: sessionId,
                created_at: timestamp,
                updated_at: timestamp,
              })
              return { success: true }
            }

            if (normalized === 'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)') {
              const [id, conversationId, role, content] = values.map(String)
              this.messages.push({
                id,
                conversation_id: conversationId,
                role: role as 'user' | 'assistant',
                content,
                created_at: this.now(),
              })
              return { success: true }
            }

            if (normalized === 'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?') {
              const id = String(values[0] ?? '')
              const conversation = this.conversations.get(id)
              if (conversation) {
                conversation.updated_at = this.now()
              }
              return { success: true }
            }

            if (normalized.startsWith('DELETE FROM messages WHERE conversation_id IN')) {
              const sessionId = String(values[0] ?? '')
              const conversationIds = new Set(
                [...this.conversations.values()]
                  .filter((row) => row.session_id === sessionId)
                  .map((row) => row.id)
              )
              this.messages = this.messages.filter(
                (message) => !conversationIds.has(message.conversation_id)
              )
              return { success: true }
            }

            if (normalized === 'DELETE FROM conversations WHERE session_id = ?') {
              const sessionId = String(values[0] ?? '')
              for (const [id, conversation] of [...this.conversations.entries()]) {
                if (conversation.session_id === sessionId) {
                  this.conversations.delete(id)
                }
              }
              return { success: true }
            }

            throw new Error(`Unsupported run() query: ${normalized}`)
          },
        }
      },
    }
  }
}

export class MockKVNamespace {
  private store = new Map<string, string>()

  async get(key: string) {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string) {
    this.store.set(key, value)
  }

  set(key: string, value: string) {
    this.store.set(key, value)
  }
}

export function createSseStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

export async function readResponseChunks(response: Response) {
  if (!response.body) {
    return { chunks: [] as string[], text: '' }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
  }

  return { chunks, text: chunks.join('') }
}

export async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
