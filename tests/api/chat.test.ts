import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockD1Database, MockKVNamespace, createSseStream, readResponseChunks, waitFor } from '../helpers/mock-cloudflare'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  createChatStream: vi.fn(),
  trackAppEvent: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return {
    ...actual,
    createChatStream: mocks.createChatStream,
  }
})

vi.mock('@/lib/observability', () => ({
  trackAppEvent: mocks.trackAppEvent,
  toIpHashHint: (ip: string | null) => (ip ? ip.slice(0, 6) : 'anon'),
}))

import { POST } from '@/app/api/chat/route'

describe('POST /api/chat', () => {
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
    expect(text).toContain('"type":"error"')
    expect(text).toContain('OpenRouter no está configurada')
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
    expect(chunks.length).toBeGreaterThan(0)
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

  it('handles SSE frames split across transport chunks without losing or duplicating text', async () => {
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
        'data: {"type":"text","text":"Hola',
        ' Chile"}\n\n',
        'data: {"type":"text","text":" y Patagonia"}\n\n',
        'data: [DO',
        'NE]\n\n',
      ])
    )

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
        },
        body: JSON.stringify({ message: 'Resume el viaje', sessionId: 'session-split-sse' }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('Hola Chile')
    expect(text).toContain('y Patagonia')

    await waitFor(
      () => db.messages.some((message) => message.role === 'assistant' && message.content === 'Hola Chile y Patagonia')
    )
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
    expect(text).toContain('"code":"rate_limit"')
    expect(text).toContain('Límite de 40 mensajes por hora alcanzado')
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_rate_limited',
      expect.objectContaining({ sessionId: 'session-rate', ipHashHint: '127.0.' })
    )
  })

  it('does not persist a partial assistant response if the stream ends with an error', async () => {
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
        'data: {"type":"text","text":"Respuesta parcial"}\n\n',
        'data: {"type":"error","code":"provider_timeout","message":"OpenRouter tardó demasiado en responder. Intenta nuevamente.","retryable":true}\n\n',
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
        body: JSON.stringify({ message: 'Arma un itinerario', sessionId: 'session-partial-error' }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"provider_timeout"')

    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Arma un itinerario',
        created_at: expect.any(String),
      },
    ])
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_provider_error',
      expect.objectContaining({ sessionId: 'session-partial-error', errorCode: 'provider_timeout' })
    )
  })

  it('blocks reasoning-like model output and avoids persisting it', async () => {
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
        'data: {"type":"text","text":"Okay, the user is asking to expand point 3."}\n\n',
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
        body: JSON.stringify({ message: 'Expande el punto 3', sessionId: 'session-reasoning' }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"invalid_model_output"')

    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Expande el punto 3',
        created_at: expect.any(String),
      },
    ])
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_provider_error',
      expect.objectContaining({ sessionId: 'session-reasoning', errorCode: 'invalid_model_output' })
    )
  })

  it('rejects foreign-destination prompts outside Chile scope', async () => {
    const db = new MockD1Database()
    const kv = new MockKVNamespace()

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
        body: JSON.stringify({ message: '¿Qué paseos puedo hacer por Roma?', sessionId: 'session-rome' }),
      })
    )

    expect(response.status).toBe(400)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"domain_mismatch"')
    expect(mocks.createChatStream).not.toHaveBeenCalled()
    expect(mocks.trackAppEvent).toHaveBeenCalledWith(
      'chat_provider_error',
      expect.objectContaining({ sessionId: 'session-rome', errorCode: 'domain_mismatch' })
    )
  })

  it('blocks obviously corrupted model output and avoids persisting it', async () => {
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
        'data: {"type":"text","text":"Roma tiene el Colosseo (€16/Europa) y un biciculto por Trastevere."}\n\n',
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
        body: JSON.stringify({ message: 'Dame ideas para el sur de Chile', sessionId: 'session-corrupt' }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"invalid_model_output"')
    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Dame ideas para el sur de Chile',
        created_at: expect.any(String),
      },
    ])
  })

  it('blocks repeated restarted output and avoids persisting it', async () => {
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
        'data: {"type":"text","text":"Qué encontrarás\\n\\nRecorrido: Lago Llanquihue.\\nAlojamiento: hotel frente al lago.\\n"}\n\n',
        'data: {"type":"text","text":"Qué encontrarás\\n\\nRecorrido: Lago Llanquihue.\\nAlojamiento: hotel frente al lago.\\n"}\n\n',
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
        body: JSON.stringify({ message: 'Dame un plan en bici por Puerto Varas', sessionId: 'session-repeat' }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('se reinició o repitió de forma anómala')
    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Dame un plan en bici por Puerto Varas',
        created_at: expect.any(String),
      },
    ])
  })

  it('blocks a long response that restarts from the beginning mid-stream', async () => {
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
        'data: {"type":"text","text":"¡Claro! Un viaje de 7 días en Chile puede adaptarse a tu presupuesto con opciones variadas.\\n\\nPresupuesto bajo (económico)\\nAlojamiento: Hostales o departamentos compartidos.\\n"}\n\n',
        'data: {"type":"text","text":"Comidas: Mercados y restaurantes locales.\\n\\nPresupuesto medio (cómodo)\\nAlojamiento: Hoteles 3 estrellas.\\n"}\n\n',
        'data: {"type":"text","text":"¡Claro! Un viaje de 7 días en Chile puede adaptarse a tu presupuesto con opciones variadas.\\n\\nPresupuesto bajo (económico)\\nAlojamiento: Hostales o departamentos compartidos.\\n"}\n\n',
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
        body: JSON.stringify({
          message: 'Presupuesto 7 días en Chile',
          sessionId: 'session-restarted-answer',
        }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"invalid_model_output"')

    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Presupuesto 7 días en Chile',
        created_at: expect.any(String),
      },
    ])
  })

  it('blocks a partial table restart inside a long budget answer', async () => {
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
        'data: {"type":"text","text":"¡Claro! Con 7 días y un presupuesto ajustado, lo ideal es concentrarse en la zona central de Chile.\\n\\nItinerario sugerido\\n\\nDía 1 Llegada a Santiago.\\nDía 2 Valle de Casablanca.\\nDía 3 Viaje a Valparaíso.\\nDía 4 Explora Viña del Mar. "}\n\n',
        'data: {"type":"text","text":"Bus local $4 USD y la ruta del vino). Aquí tienes una propuesta práctica y económica:\\nItinerario sugerido\\n\\nDía 1 Llegada a Santiago.\\nDía 2 Valle de Casablanca.\\nDía 3 Viaje a Valparaíso.\\nDía 4 Explora Viña del Mar. "}\n\n',
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
        body: JSON.stringify({
          message: 'Presupuesto 7 días en Chile',
          sessionId: 'session-budget-table-restart',
        }),
      })
    )

    expect(response.status).toBe(200)
    const { text } = await readResponseChunks(response)
    expect(text).toContain('"code":"invalid_model_output"')

    await waitFor(() => db.messages.length >= 1)
    expect(db.messages).toEqual([
      {
        id: expect.any(String),
        conversation_id: expect.any(String),
        role: 'user',
        content: 'Presupuesto 7 días en Chile',
        created_at: expect.any(String),
      },
    ])
  })
})
