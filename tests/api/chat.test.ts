import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockD1Database, MockKVNamespace, createSseStream, readResponseChunks, waitFor } from '../helpers/mock-cloudflare'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  createChatStream: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('@/lib/ai', () => ({
  createChatStream: mocks.createChatStream,
}))

import { POST } from '@/app/api/chat/route'

describe('POST /api/chat', () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    mocks.getCloudflareContext.mockReset()
    mocks.createChatStream.mockReset()
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
      return
    }
    process.env.OPENROUTER_API_KEY = originalApiKey
  })

  it('rejects empty messages', async () => {
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '', sessionId: 'session-empty' }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toBe('Mensaje requerido')
  })

  it('returns a controlled error when the API key is missing', async () => {
    process.env.OPENROUTER_API_KEY = ''

    mocks.getCloudflareContext.mockRejectedValue(new Error('no bindings'))

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hola', sessionId: 'session-no-key' }),
      })
    )

    expect(response.status).toBe(500)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('API key no configurada.')
  })

  it('streams assistant text and persists the conversation when bindings exist', async () => {
    const db = new MockD1Database()
    const kv = new MockKVNamespace()

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        travel2chile_db: db,
        travel2chile_kv: kv,
      },
    })
    mocks.createChatStream.mockReturnValue(
      createSseStream([
        'data: {"text":"Hola "}\n\n',
        'data: {"text":"Chile"}\n\n',
        'data: [DONE]\n\n',
      ])
    )

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
        },
        body: JSON.stringify({ message: 'Dame ideas para 5 días', sessionId: 'session-stream' }),
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const { chunks, text } = await readResponseChunks(response)
    expect(chunks.length).toBeGreaterThan(1)
    expect(text).toContain('[DONE]')

    await waitFor(
      () => db.messages.some((message) => message.role === 'assistant' && message.content === 'Hola Chile')
    )

    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Dame ideas para 5 días',
        created_at: expect.any(String),
      },
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'assistant',
        content: 'Hola Chile',
        created_at: expect.any(String),
      },
    ])
  })

  it('applies rate limiting when KV is available', async () => {
    const db = new MockD1Database()
    const kv = new MockKVNamespace()
    const rateKey = `rate:127.0.0.1:${Math.floor(Date.now() / 3600000)}`
    kv.set(rateKey, '40')

    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        travel2chile_db: db,
        travel2chile_kv: kv,
      },
    })

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
        },
        body: JSON.stringify({ message: 'Hola', sessionId: 'session-rate' }),
      })
    )

    expect(response.status).toBe(429)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('Límite de 40 mensajes/hora alcanzado')
  })
})
