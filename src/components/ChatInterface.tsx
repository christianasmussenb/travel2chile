'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractSseFrames } from '@/lib/sse'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

type ChatEvent =
  | { type: 'text'; text: string; seq?: number }
  | { type: 'error'; code: string; message: string; retryable: boolean; seq?: number }

function isTypedChatEvent(value: unknown): value is ChatEvent {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      (value as { type?: unknown }).type &&
      typeof (value as { type?: unknown }).type === 'string'
  )
}

function toUiErrorMessage(event: Extract<ChatEvent, { type: 'error' }>) {
  if (event.code === 'config_error') {
    return `⚠️ ${event.message}`
  }

  if (event.code === 'rate_limit' || event.code === 'provider_rate_limit') {
    return `⚠️ ${event.message}`
  }

  if (event.code === 'provider_timeout') {
    return `⚠️ ${event.message}`
  }

  return `⚠️ ${event.message}`
}

const SUGGESTED = [
  { text: '¿Cuándo ir a Torres del Paine?', icon: '🏔️' },
  { text: 'Presupuesto 7 días en Chile', icon: '💰' },
  { text: '¿Qué hacer en Santiago en 2 días?', icon: '🌆' },
  { text: 'Mejor época para Atacama', icon: '🌵' },
  { text: '¿Cómo llegar a Chiloé?', icon: '🚢' },
  { text: 'Rapa Nui: costos y logística', icon: '🗿' },
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

function isStreamDebugEnabled() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('streamDebug') === '1' || localStorage.getItem('t2c_stream_debug') === '1'
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSuggested, setShowSuggested] = useState(true)
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null)
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null)
  const sessionId = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const seenSeqsRef = useRef<Set<number>>(new Set())

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
    async (text: string, options?: { retry?: boolean }) => {
      if (!text.trim() || isStreaming) return
      setShowSuggested(false)
      setRetryPrompt(null)
      seenSeqsRef.current = new Set()
      if (options?.retry) {
        setMessages((prev) => {
          const updated = [...prev]
          if (updated[updated.length - 1]?.role === 'assistant') {
            updated[updated.length - 1] = { role: 'assistant', content: '' }
            return updated
          }
          return [...updated, { role: 'assistant', content: '' }]
        })
      } else {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
        setInput('')
        if (textareaRef.current) textareaRef.current.style.height = '52px'
      }
      setIsStreaming(true)

      try {
        const streamDebugEnabled = isStreamDebugEnabled()
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(streamDebugEnabled ? { 'X-Travel2Chile-Stream-Debug': '1' } : {}),
          },
          body: JSON.stringify({ message: text, sessionId: sessionId.current }),
        })
        const traceId = res.headers.get('X-Chat-Trace-Id')
        if (streamDebugEnabled) {
          console.debug('[travel2chile][stream]', { traceId, event: 'response_started' })
        }

        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let pendingFrame = ''

        while (true) {
          const { done, value } = await reader.read()
          const chunk = done ? dec.decode() : dec.decode(value, { stream: true })
          const { frames, remainder } = extractSseFrames(chunk, pendingFrame)
          pendingFrame = remainder
          for (const frame of frames) {
            const line = frame.trim()
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const d = JSON.parse(line.slice(6)) as ChatEvent | { text?: string; error?: string }
                if (isTypedChatEvent(d) && d.type === 'text' && d.text) {
                  if (streamDebugEnabled) {
                    console.debug('[travel2chile][stream]', {
                      traceId,
                      event: 'ui_text_received',
                      seq: d.seq ?? null,
                      length: d.text.length,
                      preview: d.text.replace(/\s+/g, ' ').trim().slice(0, 140),
                    })
                  }
                  if (typeof d.seq === 'number') {
                    if (seenSeqsRef.current.has(d.seq)) continue
                    seenSeqsRef.current.add(d.seq)
                  }
                  setRetryPrompt(null)
                  setMessages((prev) => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: updated[updated.length - 1].content + d.text,
                    }
                    return updated
                  })
                }
                if (isTypedChatEvent(d) && d.type === 'error') {
                  if (streamDebugEnabled) {
                    console.debug('[travel2chile][stream]', {
                      traceId,
                      event: 'ui_error_received',
                      code: d.code,
                      retryable: d.retryable,
                    })
                  }
                  setRetryPrompt(d.retryable ? text : null)
                  setMessages((prev) => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: toUiErrorMessage(d),
                    }
                    return updated
                  })
                }
                if (!isTypedChatEvent(d) && 'text' in d && d.text) {
                  setRetryPrompt(null)
                  setMessages((prev) => {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: updated[updated.length - 1].content + d.text,
                    }
                    return updated
                  })
                }
                if (!isTypedChatEvent(d) && 'error' in d && d.error) {
                  setRetryPrompt(text)
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
          if (done) break
        }
      } catch {
        setRetryPrompt(text)
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
    setRetryPrompt(null)
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = '52px'
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
  }

  const bg = '#070D1A'
  const surface = 'rgba(255,255,255,0.04)'
  const border = 'rgba(255,255,255,0.09)'
  const accent = '#D52B1E'
  const canRetryLastAnswer =
    Boolean(retryPrompt) &&
    !isStreaming &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content.startsWith('⚠️')

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      background: bg,
      color: '#E2E8F0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'clip',
    }}>

      {/* Ambient glow top-left */}
      <div style={{
        position: 'absolute', top: -200, left: -200,
        width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(213,43,30,0.12) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      {/* Ambient glow bottom-right */}
      <div style={{
        position: 'absolute', bottom: -200, right: -200,
        width: 500, height: 500,
        background: 'radial-gradient(circle, rgba(0,48,135,0.15) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Header */}
      <div style={{
        position: 'relative', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        minHeight: 64,
        background: 'rgba(7,13,26,0.85)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${border}`,
        gap: 12,
        flexWrap: 'wrap',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            background: `linear-gradient(135deg, ${accent} 0%, #003087 100%)`,
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, boxShadow: `0 0 12px rgba(213,43,30,0.4)`,
          }}>
            🌋
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#F1F5F9', letterSpacing: '-0.3px' }}>
              Travel2Chile
            </span>
            <span style={{
              display: 'inline-block', marginLeft: 8,
              fontSize: 10, fontWeight: 600,
              color: '#22C55E',
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.25)',
              padding: '2px 7px', borderRadius: 20,
              letterSpacing: '0.3px',
            }}>
              IA ACTIVA
            </span>
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={clearChat}
            aria-label="Nueva conversación"
            style={{
              fontSize: 12, fontWeight: 500,
              color: '#94A3B8',
              background: surface,
              border: `1px solid ${border}`,
              padding: '6px 14px', borderRadius: 8,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseOver={(e) => { (e.currentTarget.style.color = '#E2E8F0'); (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)') }}
            onMouseOut={(e) => { (e.currentTarget.style.color = '#94A3B8'); (e.currentTarget.style.borderColor = border) }}
          >
            + Nueva conversación
          </button>
          <Link
            href="/"
            style={{
              fontSize: 12, fontWeight: 500,
              color: '#94A3B8',
              background: surface,
              border: `1px solid ${border}`,
              padding: '6px 14px', borderRadius: 8,
              cursor: 'pointer', textDecoration: 'none',
              transition: 'all 0.15s',
              display: 'inline-flex', alignItems: 'center',
            }}
            onMouseOver={(e) => { (e.currentTarget.style.color = '#E2E8F0'); (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)') }}
            onMouseOut={(e) => { (e.currentTarget.style.color = '#94A3B8'); (e.currentTarget.style.borderColor = border) }}
          >
            ← Inicio
          </Link>
        </div>
      </div>

      {/* Messages */}
      <main style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: messages.length === 0 && showSuggested ? '32px 20px 24px' : '24px 20px',
        position: 'relative', zIndex: 1,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        <div style={{
          maxWidth: 960,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          minHeight: '100%',
          justifyContent: messages.length === 0 && showSuggested ? 'center' : 'flex-start',
        }}>

          {/* Welcome / Suggested — franja compacta */}
          {messages.length === 0 && showSuggested && (
            <section style={{
              padding: '24px 0 12px',
              maxWidth: 760,
              width: '100%',
              margin: '0 auto',
            }}>
              {/* Título inline */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              }}>
                <span style={{ fontSize: 18 }}>🌋</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#94A3B8' }}>
                  Sugerencias — ¿qué quieres saber?
                </span>
              </div>
              {/* Chips en 2 filas */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {SUGGESTED.map((s, i) => (
                  <button
                    key={s.text}
                    onClick={() => sendMessage(s.text)}
                    onMouseOver={() => setHoveredSuggestion(i)}
                    onMouseOut={() => setHoveredSuggestion(null)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px',
                      background: hoveredSuggestion === i
                        ? 'rgba(213,43,30,0.15)'
                        : 'rgba(255,255,255,0.04)',
                      border: hoveredSuggestion === i
                        ? `1px solid rgba(213,43,30,0.5)`
                        : `1px solid rgba(255,255,255,0.1)`,
                      borderRadius: 20,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{s.icon}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 500,
                      color: hoveredSuggestion === i ? '#F87171' : '#94A3B8',
                      transition: 'color 0.15s',
                    }}>
                      {s.text}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: 12,
                width: '100%',
                maxWidth: 860,
                margin: '0 auto',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15,
                ...(msg.role === 'assistant'
                  ? {
                    background: `linear-gradient(135deg, ${accent} 0%, #003087 100%)`,
                    boxShadow: `0 2px 8px rgba(213,43,30,0.3)`,
                  }
                  : {
                    background: 'rgba(255,255,255,0.1)',
                    border: `1px solid rgba(255,255,255,0.15)`,
                    color: '#E2E8F0', fontSize: 13, fontWeight: 700,
                  }
                ),
              }}>
                {msg.role === 'assistant' ? '🤖' : 'C'}
              </div>

              {/* Bubble */}
              <div style={{
                ...(msg.role === 'user'
                  ? { maxWidth: 'min(78%, 640px)' }
                  : { flex: 1, minWidth: 0, maxWidth: 720 }
                ),
                padding: '14px 18px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                ...(msg.role === 'user'
                  ? {
                    background: `linear-gradient(135deg, ${accent} 0%, #A01E17 100%)`,
                    color: '#fff',
                    boxShadow: `0 4px 16px rgba(213,43,30,0.25)`,
                  }
                  : {
                    background: 'rgba(255,255,255,0.05)',
                    border: `1px solid rgba(255,255,255,0.1)`,
                    backdropFilter: 'blur(10px)',
                    color: '#CBD5E1',
                    overflowX: 'auto',
                  }
                ),
                fontSize: 15,
                lineHeight: 1.65,
              }}>
                {msg.role === 'assistant' ? (
                  <div style={{ color: '#CBD5E1' }}>
                    {msg.content ? (
                      <div className="ai-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '4px 0' }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: accent,
                          display: 'inline-block',
                          animation: 'bounce 1.2s infinite',
                          animationDelay: '0ms',
                        }} />
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: accent,
                          display: 'inline-block',
                          animation: 'bounce 1.2s infinite',
                          animationDelay: '200ms',
                        }} />
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: accent,
                          display: 'inline-block',
                          animation: 'bounce 1.2s infinite',
                          animationDelay: '400ms',
                        }} />
                      </span>
                    )}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 15, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <div style={{
        position: 'relative', zIndex: 10,
        padding: '14px 20px 18px',
        background: 'rgba(7,13,26,0.9)',
        backdropFilter: 'blur(20px)',
        borderTop: `1px solid ${border}`,
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 10,
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid rgba(255,255,255,0.12)`,
            borderRadius: 16,
            padding: '8px 8px 8px 16px',
            transition: 'border-color 0.15s',
            boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
          }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  sendMessage(input)
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="¿Cuándo ir a Patagonia? ¿Cuánto cuesta Atacama?..."
              disabled={isStreaming}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#E2E8F0',
                fontSize: 15,
                lineHeight: '22px',
                minHeight: 36,
                maxHeight: 140,
                resize: 'none',
                padding: '7px 0',
                fontFamily: 'inherit',
              }}
            />
          <button
            onClick={() => sendMessage(input)}
            disabled={isStreaming || !input.trim()}
            aria-label="Enviar mensaje"
            style={{
              width: 40, height: 40, borderRadius: 10, border: 'none',
              background: isStreaming || !input.trim()
                  ? 'rgba(255,255,255,0.07)'
                  : `linear-gradient(135deg, ${accent} 0%, #A01E17 100%)`,
                color: isStreaming || !input.trim() ? '#475569' : '#fff',
                cursor: isStreaming || !input.trim() ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16,
                transition: 'all 0.15s',
                boxShadow: isStreaming || !input.trim() ? 'none' : `0 2px 8px rgba(213,43,30,0.35)`,
              }}
            >
              {isStreaming ? (
                <span style={{ fontSize: 14 }}>⏳</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 10, lineHeight: 1.5 }}>
            Presiona Enter para enviar · Shift+Enter para nueva línea · Respuestas de IA pueden variar
          </p>
          {canRetryLastAnswer ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
              <button
                onClick={() => retryPrompt && sendMessage(retryPrompt, { retry: true })}
                style={{
                  border: `1px solid rgba(213,43,30,0.45)`,
                  background: 'rgba(213,43,30,0.12)',
                  color: '#FCA5A5',
                  borderRadius: 999,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reintentar respuesta
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        .ai-markdown p { margin: 0 0 8px; }
        .ai-markdown p:last-child { margin-bottom: 0; }
        .ai-markdown ul, .ai-markdown ol { margin: 6px 0 6px 20px; padding: 0; }
        .ai-markdown li { margin: 3px 0; }
        .ai-markdown strong { color: #E2E8F0; font-weight: 600; }
        .ai-markdown h1, .ai-markdown h2, .ai-markdown h3 {
          color: #F1F5F9; margin: 12px 0 6px; font-weight: 700;
        }
        .ai-markdown h2 { font-size: 1.1em; }
        .ai-markdown h3 { font-size: 1em; }
        .ai-markdown code {
          background: rgba(255,255,255,0.1);
          border-radius: 4px; padding: 1px 5px;
          font-size: 13px; color: #93C5FD;
        }
        .ai-markdown blockquote {
          border-left: 3px solid rgba(213,43,30,0.5);
          margin: 8px 0; padding-left: 12px; color: #94A3B8;
        }
        .ai-markdown table {
          border-collapse: collapse; width: 100%; margin: 10px 0;
          font-size: 13px; border-radius: 8px; overflow: hidden;
        }
        .ai-markdown th {
          background: rgba(213,43,30,0.2); color: #F1F5F9;
          padding: 8px 12px; text-align: left; font-weight: 600;
          border-bottom: 1px solid rgba(255,255,255,0.12);
          white-space: nowrap;
        }
        .ai-markdown td {
          padding: 7px 12px; color: #CBD5E1;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          vertical-align: top;
        }
        .ai-markdown tr:last-child td { border-bottom: none; }
        .ai-markdown tr:nth-child(even) td { background: rgba(255,255,255,0.03); }
        div[style*="overflow-y: auto"]::-webkit-scrollbar { width: 4px; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-track { background: transparent; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  )
}
