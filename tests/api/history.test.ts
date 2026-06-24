import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockD1Database, createSseStream, readResponseChunks, waitFor } from '../helpers/mock-cloudflare'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  createChatStream: vi.fn(),
  trackAppEvent: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('@/lib/ai', () => ({
  createChatStream: mocks.createChatStream,
}))

vi.mock('@/lib/observability', () => ({
  trackAppEvent: mocks.trackAppEvent,
  toIpHashHint: (ip: string | null) => (ip ? ip.slice(0, 6) : 'anon'),
}))

import { GET, DELETE } from '@/app/api/history/route'
import { POST } from '@/app/api/chat/route'

describe('GET and DELETE /api/history', () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    mocks.getCloudflareContext.mockReset()
    mocks.createChatStream.mockReset()
    mocks.trackAppEvent.mockReset()
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
      return
    }
    process.env.OPENROUTER_API_KEY = originalApiKey
  })

  it('returns the persisted conversation history for a session', async () => {
    const db = new MockD1Database()

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        travel2chile_db: db,
      },
    })
    mocks.createChatStream.mockReturnValue(
      createSseStream([
        'data: {"type":"text","text":"Hola "}\n\n',
        'data: {"type":"text","text":"viajero"}\n\n',
        'data: [DONE]\n\n',
      ])
    )

    await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
        },
        body: JSON.stringify({ message: 'Recomiéndame rutas', sessionId: 'session-history' }),
      })
    ).then(readResponseChunks)

    await waitFor(
      () => db.messages.some((message) => message.role === 'assistant' && message.content === 'Hola viajero')
    )

    const response = await GET(new Request('http://localhost/api/history?sessionId=session-history'))
    expect(response.ok).toBe(true)

    const payload = (await response.json()) as {
      history: Array<{ role: 'user' | 'assistant'; content: string }>
      conversationId: string
    }

    expect(payload.conversationId).toBeTruthy()
    expect(payload.history).toEqual([
      { role: 'user', content: 'Recomiéndame rutas' },
      { role: 'assistant', content: 'Hola viajero' },
    ])
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_session_started',
      expect.objectContaining({ sessionId: 'session-history' })
    )
  })

  it('deletes the active session history', async () => {
    const db = new MockD1Database()

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        travel2chile_db: db,
      },
    })
    mocks.createChatStream.mockReturnValue(
      createSseStream([
        'data: {"type":"text","text":"Una respuesta"}\n\n',
        'data: [DONE]\n\n',
      ])
    )

    await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
        },
        body: JSON.stringify({ message: 'Hola', sessionId: 'session-delete' }),
      })
    ).then(readResponseChunks)

    await waitFor(() => db.conversations.size > 0 && db.messages.length > 0)

    const deleteResponse = await DELETE(
      new Request('http://localhost/api/history', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-delete' }),
      })
    )

    expect(deleteResponse.ok).toBe(true)
    expect(db.conversations.size).toBe(0)
    expect(db.messages).toHaveLength(0)

    const response = await GET(new Request('http://localhost/api/history?sessionId=session-delete'))
    const payload = (await response.json()) as {
      history: Array<{ role: 'user' | 'assistant'; content: string }>
      conversationId: string | null
    }

    expect(payload.history).toEqual([])
    expect(payload.conversationId).toBeTruthy()
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_history_cleared',
      expect.objectContaining({ sessionId: 'session-delete' })
    )
  })
})
