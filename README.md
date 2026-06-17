# Travel2Chile v4

Travel2Chile es un asistente de viajes en español enfocado en Chile. La aplicación combina una landing pública, un chat con streaming, persistencia de conversaciones por sesión y despliegue sobre Next.js + OpenNext para Cloudflare.

## Qué resuelve

- Ayuda a planificar viajes por Chile con respuestas prácticas sobre destinos, temporadas, transporte, alojamiento y costos.
- Mantiene historial de conversación cuando el entorno de Cloudflare tiene D1 disponible.
- Aplica rate limit por IP cuando KV está disponible.
- Funciona en local con `next dev` y en preview/despliegue con Cloudflare/OpenNext.

## Arquitectura

- Frontend: Next.js App Router.
- Chat: [`src/components/ChatInterface.tsx`](/Users/cab/VSCODE/travel2chile/src/components/ChatInterface.tsx).
- API de chat: [`src/app/api/chat/route.ts`](/Users/cab/VSCODE/travel2chile/src/app/api/chat/route.ts).
- API de historial: [`src/app/api/history/route.ts`](/Users/cab/VSCODE/travel2chile/src/app/api/history/route.ts).
- IA: [`src/lib/ai.ts`](/Users/cab/VSCODE/travel2chile/src/lib/ai.ts), con streaming SSE usando OpenRouter.
- Persistencia: [`src/lib/db.ts`](/Users/cab/VSCODE/travel2chile/src/lib/db.ts) sobre D1.
- Esquema SQL: [`db/schema.sql`](/Users/cab/VSCODE/travel2chile/db/schema.sql).

### Flujo de datos

1. El usuario escribe un mensaje en el chat.
2. El frontend envía `POST /api/chat` con `message` y `sessionId`.
3. La API intenta resolver bindings de Cloudflare.
4. Si hay D1, carga historial y guarda el mensaje del usuario.
5. Si hay KV, aplica rate limit por IP.
6. La respuesta de OpenRouter se transmite como SSE al cliente.
7. Si hay D1, la respuesta final del asistente también se persiste.
8. `GET /api/history` permite recuperar el historial de la sesión actual.
9. `DELETE /api/history` limpia la conversación de esa sesión.

## Requisitos

- Node.js 20 o superior.
- npm.
- Una API key válida en `OPENROUTER_API_KEY`.
- Cloudflare bindings para D1 y KV si se quiere persistencia/rate limit reales.

## Variables de entorno

- `OPENROUTER_API_KEY`: obligatoria para responder mensajes.
- `NEXTJS_ENV`: opcional, usada por el runtime de OpenNext/Cloudflare.

## Scripts

- `npm run dev`: inicia Next.js en modo desarrollo.
- `npm run build`: compila la app y ejecuta typecheck.
- `npm run start`: inicia la build de producción de Next.js.
- `npm run lint`: ejecuta ESLint sobre el repositorio.
- `npm run test`: ejecuta la suite de pruebas.
- `npm run test:ui`: ejecuta el smoke test de Playwright.
- `npm run preview`: construye y ejecuta preview con OpenNext/Cloudflare.
- `npm run deploy`: construye y despliega a Cloudflare.
- `npm run upload`: construye y sube artefactos a Cloudflare.
- `npm run cf-typegen`: regenera tipos de Cloudflare.

## Desarrollo local

```bash
npm install
```

Crear un archivo `.env.local` con al menos:

```bash
OPENROUTER_API_KEY=tu_clave
```

Luego ejecutar:

```bash
npm run dev
```

Abrir `http://localhost:3000`.

### Qué esperar en local

- La UI del chat funciona.
- El streaming funciona.
- Si no hay bindings reales de Cloudflare, el historial y el rate limit quedan desactivados o en modo no-op.
- La aplicación sigue respondiendo mientras exista `OPENROUTER_API_KEY`.

## Preview y despliegue

- `npm run preview` levanta el bundle de OpenNext para validación local del runtime Cloudflare.
- `npm run deploy` publica en Cloudflare cuando los bindings y secretos están configurados.

## Esquema de datos

La base D1 usa dos tablas:

- `conversations`: agrupa mensajes por `session_id`.
- `messages`: guarda `role`, `content` y timestamps por conversación.

El esquema completo está en [`db/schema.sql`](/Users/cab/VSCODE/travel2chile/db/schema.sql).

## Limitaciones actuales

- Sin `OPENROUTER_API_KEY` no hay respuesta de IA.
- En `next dev`, si no están disponibles los bindings de Cloudflare, no hay persistencia de historial ni rate limit.
- La persistencia es por sesión y tiene una ventana de reutilización de 24 horas para conversaciones activas.
- El rate limit solo se aplica cuando KV está disponible.

## Pruebas y verificación

La guía de pruebas está en [`docs/testing.md`](/Users/cab/VSCODE/travel2chile/docs/testing.md).
