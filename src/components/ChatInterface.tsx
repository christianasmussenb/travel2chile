'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  role: 'user' | 'assistant'
  content: string
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

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSuggested, setShowSuggested] = useState(true)
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null)
  const sessionId = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      if (textareaRef.current) textareaRef.current.style.height = '52px'
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

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = '52px'
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
  }

  const bg = '#070D1A'
  const surface = 'rgba(255,255,255,0.04)'
  const border = 'rgba(255,255,255,0.09)'
  const accent = '#D52B1E'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: bg,
      color: '#E2E8F0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'hidden',
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
        height: 60,
        background: 'rgba(7,13,26,0.85)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${border}`,
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
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 16px',
        position: 'relative', zIndex: 1,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Welcome / Suggested — franja compacta */}
          {messages.length === 0 && showSuggested && (
            <div style={{ padding: '10px 0 6px' }}>
              {/* Título inline */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              }}>
                <span style={{ fontSize: 18 }}>🌋</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#94A3B8' }}>
                  Sugerencias — ¿qué quieres saber?
                </span>
              </div>
              {/* Chips en 2 filas */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
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
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: 10,
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
                  ? { maxWidth: '72%' }
                  : { flex: 1, minWidth: 0 }
                ),
                padding: '12px 16px',
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
                fontSize: 14,
                lineHeight: 1.6,
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
                  <p style={{ margin: 0, fontSize: 14 }}>{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div style={{
        position: 'relative', zIndex: 10,
        padding: '12px 16px 16px',
        background: 'rgba(7,13,26,0.9)',
        backdropFilter: 'blur(20px)',
        borderTop: `1px solid ${border}`,
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 10,
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid rgba(255,255,255,0.12)`,
            borderRadius: 16,
            padding: '8px 8px 8px 16px',
            transition: 'border-color 0.15s',
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
                fontSize: 14,
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
          <p style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 8 }}>
            Presiona Enter para enviar · Shift+Enter para nueva línea · Respuestas de IA pueden variar
          </p>
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
