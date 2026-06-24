type AppEventName =
  | 'chat_session_started'
  | 'chat_message_sent'
  | 'chat_response_completed'
  | 'chat_provider_error'
  | 'chat_rate_limited'
  | 'chat_history_cleared'

type AppEventData = {
  sessionId?: string
  conversationId?: string | null
  messageLength?: number
  historyCount?: number
  responseLength?: number
  errorCode?: string
  retryable?: boolean
  provider?: 'openrouter'
  hasBindings?: boolean
  ipHashHint?: string
}

export function trackAppEvent(event: AppEventName, data: AppEventData = {}) {
  console.log(
    JSON.stringify({
      source: 'travel2chile',
      type: 'app_event',
      event,
      timestamp: new Date().toISOString(),
      ...data,
    })
  )
}

export function toIpHashHint(ip: string | null) {
  if (!ip) return 'anon'
  return ip.slice(0, 6)
}
