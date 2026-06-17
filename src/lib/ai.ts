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
