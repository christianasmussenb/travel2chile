import { createErrorPayload, type ChatStreamPayload } from './ai'

const CHILE_KEYWORDS = [
  'chile',
  'chiloe',
  'chiloé',
  'pucon',
  'pucón',
  'puerto varas',
  'torres del paine',
  'atacama',
  'santiago',
  'valparaiso',
  'valparaíso',
  'villarrica',
  'rapa nui',
  'carretera austral',
  'puerto natales',
  'valle del elqui',
]

const FOREIGN_DESTINATIONS = [
  'roma',
  'rome',
  'paris',
  'parís',
  'madrid',
  'barcelona',
  'londres',
  'london',
  'tokio',
  'tokyo',
  'new york',
  'nueva york',
  'florencia',
  'florence',
  'venecia',
  'venice',
  'milan',
  'milán',
]

export function getDomainMismatchPayload(message: string): ChatStreamPayload | null {
  const normalized = message.toLowerCase()
  const mentionsChile = CHILE_KEYWORDS.some((keyword) => normalized.includes(keyword))
  const foreignMatch = FOREIGN_DESTINATIONS.find((place) => normalized.includes(place))

  if (!mentionsChile && foreignMatch) {
    return createErrorPayload(
      'domain_mismatch',
      'Travel2Chile está enfocado en viajes dentro de Chile. Puedo ayudarte con destinos como Pucón, Atacama, Puerto Varas, Chiloé o Torres del Paine.',
      false
    )
  }

  return null
}
