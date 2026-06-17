#!/bin/bash
# ============================================================
# Travel2Chile v4 — Setup Script (Sesión 1+2)
# Ejecutar desde dentro de: ~/travel2chile-v4/
# ============================================================

set -e
echo "🚀 Creando archivos Travel2Chile v4..."

# ── cloudflare-env.d.ts ────────────────────────────────────
cat > cloudflare-env.d.ts << 'HEREDOC'
interface CloudflareEnv {
  travel2chile_db: D1Database;
  travel2chile_kv: KVNamespace;
  travel2chile_images: R2Bucket;
  OPENROUTER_API_KEY: string;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  WORKER_SELF_REFERENCE: Fetcher;
}
HEREDOC
echo "✅ cloudflare-env.d.ts"

# ── lib/ ───────────────────────────────────────────────────
mkdir -p lib

cat > lib/ai.ts << 'HEREDOC'
import OpenAI from 'openai'

const SYSTEM_PROMPT = `Eres un asistente virtual especializado en viajes por Chile.
Tu objetivo es ayudar a planificar viajes con información práctica sobre destinos,
transporte, alojamiento, costos, temporadas y actividades.

Principios:
- Respuestas concisas y específicas a la pregunta actual
- Incluye rangos de precio en USD y CLP cuando sea relevante
- Menciona la mejor época del año para cada destino
- Sugiere 1-2 alternativas cuando corresponda
- Tono cálido y entusiasta, como un amigo experto en Chile

Destinos que dominas: Torres del Paine, San Pedro de Atacama, Santiago,
Valparaíso, Puerto Natales, Chiloé, Valle del Elqui, Pucón, Puerto Varas,
Rapa Nui (Isla de Pascua), Carretera Austral, Arica, Viña del Mar.`

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function createChatStream(messages: Message[], apiKey: string): ReadableStream {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://travel2chile.com',
      'X-Title': 'Travel2Chile',
    },
  })

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model: 'openrouter/free',
          max_tokens: 1024,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        })

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) {
            const data = `data: ${JSON.stringify({ text })}\n\n`
            controller.enqueue(new TextEncoder().encode(data))
          }
          if (chunk.choices[0]?.finish_reason === 'stop') break
        }

        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido'
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        )
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
}
HEREDOC
echo "✅ lib/ai.ts"

cat > lib/db.ts << 'HEREDOC'
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
HEREDOC
echo "✅ lib/db.ts"

# ── app/api/ ───────────────────────────────────────────────
mkdir -p app/api/chat app/api/history

cat > app/api/chat/route.ts << 'HEREDOC'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createChatStream } from '@/lib/ai'
import {
  getOrCreateConversation,
  getHistory,
  saveMessage,
} from '@/lib/db'

export const runtime = 'edge'

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })

  // Rate limiting: 40 mensajes/hora por IP
  const ip = request.headers.get('CF-Connecting-IP') || 'anon'
  const rateKey = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`
  const count = Number((await env.travel2chile_kv.get(rateKey)) || 0)

  if (count >= 40) {
    return new Response(
      'data: {"error":"Límite de 40 mensajes/hora alcanzado. Intenta más tarde."}\n\ndata: [DONE]\n\n',
      {
        status: 429,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    )
  }

  await env.travel2chile_kv.put(rateKey, String(count + 1), {
    expirationTtl: 3600,
  })

  const { message, sessionId } = (await request.json()) as {
    message: string
    sessionId: string
  }

  if (!message?.trim()) {
    return new Response('Mensaje requerido', { status: 400 })
  }

  // Historial desde D1
  const conversationId = await getOrCreateConversation(
    env.travel2chile_db,
    sessionId
  )
  const history = await getHistory(env.travel2chile_db, conversationId)

  // Guardar mensaje del usuario
  await saveMessage(env.travel2chile_db, conversationId, 'user', message)

  const messages = [...history, { role: 'user' as const, content: message }]

  // Stream con OpenRouter (gratis)
  const [streamForClient, streamForSaving] = createChatStream(
    messages,
    env.OPENROUTER_API_KEY
  ).tee()

  // Guardar respuesta completa en D1 (background)
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
    if (full) {
      await saveMessage(
        env.travel2chile_db,
        conversationId,
        'assistant',
        full
      )
    }
  })()

  return new Response(streamForClient, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': conversationId,
    },
  })
}
HEREDOC
echo "✅ app/api/chat/route.ts"

cat > app/api/history/route.ts << 'HEREDOC'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getOrCreateConversation, getHistory, clearConversation } from '@/lib/db'

export const runtime = 'edge'

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId') || ''

  const conversationId = await getOrCreateConversation(
    env.travel2chile_db,
    sessionId
  )
  const history = await getHistory(env.travel2chile_db, conversationId, 20)

  return Response.json({ history, conversationId })
}

export async function DELETE(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const { sessionId } = (await request.json()) as { sessionId: string }

  await clearConversation(env.travel2chile_db, sessionId)
  return Response.json({ ok: true })
}
HEREDOC
echo "✅ app/api/history/route.ts"

# ── components/ ────────────────────────────────────────────
mkdir -p components

cat > components/ChatInterface.tsx << 'HEREDOC'
'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED = [
  '¿Cuándo ir a Torres del Paine?',
  'Presupuesto 7 días en Chile',
  '¿Qué hacer en Santiago en 2 días?',
  'Mejor época para Atacama',
  '¿Cómo llegar a Chiloé?',
  'Rapa Nui: costos y logística',
]

function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('t2c_session')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('t2c_session', id)
  }
  return id
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSuggested, setShowSuggested] = useState(true)
  const sessionId = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionId.current = getSessionId()
    fetch(`/api/history?sessionId=${sessionId.current}`)
      .then((r) => r.json())
      .then(({ history }) => {
        if (history?.length) {
          setMessages(history)
          setShowSuggested(false)
        }
      })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return
      setShowSuggested(false)
      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setInput('')
      setIsStreaming(true)
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId: sessionId.current }),
        })

        const reader = res.body!.getReader()
        const dec = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = dec.decode(value)
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const d = JSON.parse(line.slice(6))
                if (d.text) {
                  setMessages((prev) => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: updated[updated.length - 1].content + d.text,
                    }
                    return updated
                  })
                }
                if (d.error) {
                  setMessages((prev) => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: `⚠️ ${d.error}`,
                    }
                    return updated
                  })
                }
              } catch {}
            }
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '⚠️ Error de conexión. Intenta nuevamente.',
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
      }
    },
    [isStreaming]
  )

  const clearChat = async () => {
    await fetch('/api/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.current }),
    })
    setMessages([])
    setShowSuggested(true)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🇨🇱</span>
          <span className="font-bold text-gray-800 text-lg">Travel2Chile</span>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
            IA activa
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={clearChat}
            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded border hover:border-gray-400 transition"
          >
            Nueva conversación
          </button>
          <a
            href="/"
            className="text-xs text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400 transition"
          >
            Inicio
          </a>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
        {messages.length === 0 && showSuggested && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">🏔️</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              ¿A dónde quieres ir en Chile?
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              Pregúntame sobre destinos, costos, temporadas o logística
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="bg-white border border-blue-200 text-blue-700 text-sm px-4 py-2 rounded-full hover:bg-blue-50 hover:border-blue-400 transition shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <span className="text-lg mr-2 mt-1 flex-shrink-0">🤖</span>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-white text-gray-800 rounded-bl-sm border'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  {msg.content ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <span className="inline-flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
            {msg.role === 'user' && (
              <span className="text-lg ml-2 mt-1 flex-shrink-0">👤</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t px-4 py-3 shadow-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-2 max-w-3xl mx-auto"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder="¿Cuándo ir a Patagonia? ¿Cuánto cuesta Atacama?..."
            className="flex-1 border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-3 rounded-xl text-sm font-medium transition"
          >
            {isStreaming ? '...' : 'Enviar'}
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-1">
          ⌘+Enter para enviar · Respuestas de IA pueden variar
        </p>
      </div>
    </div>
  )
}
HEREDOC
echo "✅ components/ChatInterface.tsx"

# ── app/chat/ ──────────────────────────────────────────────
mkdir -p app/chat

cat > app/chat/page.tsx << 'HEREDOC'
import ChatInterface from '@/components/ChatInterface'

export const metadata = {
  title: 'Travel2Chile — Chat con IA',
  description: 'Planifica tu viaje a Chile con inteligencia artificial',
}

export default function ChatPage() {
  return <ChatInterface />
}
HEREDOC
echo "✅ app/chat/page.tsx"

# ── app/page.tsx (landing) ─────────────────────────────────
cat > app/page.tsx << 'HEREDOC'
import Link from 'next/link'

export const metadata = {
  title: 'Travel2Chile — Planifica tu viaje a Chile con IA',
  description:
    'Asistente virtual especializado en turismo en Chile. Torres del Paine, Atacama, Santiago y más.',
}

const DESTINOS = [
  { nombre: 'Torres del Paine', emoji: '🏔️', desc: 'Patagonia chilena' },
  { nombre: 'San Pedro de Atacama', emoji: '🌵', desc: 'Desierto del norte' },
  { nombre: 'Santiago', emoji: '🏙️', desc: 'Capital vibrante' },
  { nombre: 'Isla de Pascua', emoji: '🗿', desc: 'Moáis y cultura Rapa Nui' },
  { nombre: 'Chiloé', emoji: '🌧️', desc: 'Palafitos y mitología' },
  { nombre: 'Carretera Austral', emoji: '🛣️', desc: 'Aventura sin igual' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white">
      {/* Hero */}
      <div
        className="relative h-screen flex items-center justify-center"
        style={{
          backgroundImage: "url('/chile_bg.jpg')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <div className="text-6xl mb-4">🇨🇱</div>
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Planifica tu viaje a Chile
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Asistente con IA especializado en turismo chileno.
            Sin registro, sin costo.
          </p>
          <Link
            href="/chat"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold text-lg px-10 py-4 rounded-2xl transition transform hover:scale-105 shadow-xl"
          >
            Comenzar ahora →
          </Link>
          <p className="mt-4 text-gray-400 text-sm">
            Sin registro · Gratis · Respuestas instantáneas
          </p>
        </div>
      </div>

      {/* Destinos */}
      <div className="bg-gray-800 py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-2">
            Descubre Chile
          </h2>
          <p className="text-gray-400 text-center mb-10">
            Pregúntame sobre cualquiera de estos destinos
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {DESTINOS.map((d) => (
              <Link
                key={d.nombre}
                href={`/chat`}
                className="bg-gray-700 hover:bg-gray-600 rounded-xl p-5 flex flex-col items-center text-center transition group"
              >
                <span className="text-4xl mb-2 group-hover:scale-110 transition-transform">
                  {d.emoji}
                </span>
                <span className="font-semibold text-sm">{d.nombre}</span>
                <span className="text-gray-400 text-xs mt-1">{d.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* CTA final */}
      <div className="bg-blue-700 py-12 px-4 text-center">
        <h3 className="text-2xl font-bold mb-3">¿Listo para planificar?</h3>
        <p className="text-blue-200 mb-6">
          Pregunta sobre visas, costos, rutas, temporadas y más
        </p>
        <Link
          href="/chat"
          className="inline-block bg-white text-blue-700 font-bold px-8 py-3 rounded-xl hover:bg-blue-50 transition"
        >
          Hablar con la IA →
        </Link>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 py-6 text-center text-gray-500 text-sm border-t border-gray-800">
        <a
          href="https://www.casmuss.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-300 transition"
        >
          Health Technology Consulting © 2026
        </a>
      </footer>
    </main>
  )
}
HEREDOC
echo "✅ app/page.tsx"

echo ""
echo "🎉 Todos los archivos creados. Siguiente paso:"
echo "   npm install react-markdown"
echo "   npm run dev"
