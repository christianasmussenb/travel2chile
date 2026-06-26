# Travel2Chile v4

Travel2Chile es un asistente de viajes en español enfocado en Chile. La aplicación combina una landing pública, un chat con streaming controlado y guardas de salida, persistencia de conversaciones por sesión y despliegue sobre Next.js + OpenNext para Cloudflare.

## Documentación

- [`docs/status.md`](/Users/cab/VSCODE/travel2chile/docs/status.md): avances, estado actual y pendientes.
- [`docs/lessons-learned.md`](/Users/cab/VSCODE/travel2chile/docs/lessons-learned.md): aprendizajes técnicos y operativos.
- [`docs/sprints.md`](/Users/cab/VSCODE/travel2chile/docs/sprints.md): plan de sprints.
- [`docs/sprint-6-execution.md`](/Users/cab/VSCODE/travel2chile/docs/sprint-6-execution.md): plan ejecutable del siguiente sprint.
- [`docs/monitoring-new-relic.md`](/Users/cab/VSCODE/travel2chile/docs/monitoring-new-relic.md): implementación recomendada de monitoreo externo.
- [`docs/testing.md`](/Users/cab/VSCODE/travel2chile/docs/testing.md): estrategia de pruebas y verificación.

## Qué resuelve

- Ayuda a planificar viajes por Chile con respuestas prácticas sobre destinos, temporadas, transporte, alojamiento y costos.
- Mantiene historial de conversación cuando el entorno de Cloudflare tiene D1 disponible.
- Aplica rate limit por IP cuando KV está disponible.
- Bloquea consultas fuera de alcance y respuestas inválidas del modelo antes de mostrarlas al usuario.
- Funciona en local con `next dev` y en preview/despliegue con Cloudflare/OpenNext.

## Arquitectura

- Frontend: Next.js App Router.
- Chat: [`src/components/ChatInterface.tsx`](/Users/cab/VSCODE/travel2chile/src/components/ChatInterface.tsx).
- API de chat: [`src/app/api/chat/route.ts`](/Users/cab/VSCODE/travel2chile/src/app/api/chat/route.ts).
- API de historial: [`src/app/api/history/route.ts`](/Users/cab/VSCODE/travel2chile/src/app/api/history/route.ts).
- IA: [`src/lib/ai.ts`](/Users/cab/VSCODE/travel2chile/src/lib/ai.ts), con soporte para OpenRouter y NVIDIA.
- Guardas de dominio y salida: [`src/lib/domain-guard.ts`](/Users/cab/VSCODE/travel2chile/src/lib/domain-guard.ts), [`src/lib/output-guard.ts`](/Users/cab/VSCODE/travel2chile/src/lib/output-guard.ts).
- Persistencia: [`src/lib/db.ts`](/Users/cab/VSCODE/travel2chile/src/lib/db.ts) sobre D1.
- Observabilidad de app: [`src/lib/observability.ts`](/Users/cab/VSCODE/travel2chile/src/lib/observability.ts).
- Esquema SQL: [`db/schema.sql`](/Users/cab/VSCODE/travel2chile/db/schema.sql).

### Flujo de datos

1. El usuario escribe un mensaje en el chat.
2. El frontend envía `POST /api/chat` con `message` y `sessionId`.
3. La API intenta resolver bindings de Cloudflare.
4. Si hay D1, carga historial y guarda el mensaje del usuario.
5. Si hay KV, aplica rate limit por IP.
6. La respuesta de OpenRouter se transmite como SSE al cliente con guardas de dominio y calidad.
7. Si la salida detecta errores o contenido inválido, se transforma en un error controlado.
8. Si hay D1, la respuesta final válida del asistente también se persiste.
9. `GET /api/history` permite recuperar el historial de la sesión actual.
10. `DELETE /api/history` limpia la conversación de esa sesión.

## Requisitos

- Node.js 20 o superior.
- npm.
- Una API key válida del proveedor configurado.
- Cloudflare bindings para D1 y KV si se quiere persistencia/rate limit reales.

## Variables de entorno

- `AI_PROVIDER`: opcional. `openrouter` por defecto, o `nvidia`.
- `OPENROUTER_API_KEY`: obligatoria si `AI_PROVIDER=openrouter`.
- `OPENROUTER_MODEL`: opcional. Por defecto `openrouter/free`.
- `NVIDIA_API_KEY`: obligatoria si `AI_PROVIDER=nvidia`.
- `NVIDIA_MODEL`: opcional. Por defecto `nvidia/nemotron-3-ultra-550b-a55b`.
- `NVIDIA_BASE_URL`: opcional. Por defecto `https://integrate.api.nvidia.com/v1`.
- `NVIDIA_MAX_TOKENS`: opcional. Por defecto `4096`.
- `NVIDIA_TEMPERATURE`: opcional. Por defecto `0.7`.
- `NVIDIA_TOP_P`: opcional. Por defecto `0.95`.
- `NVIDIA_ENABLE_THINKING`: opcional. `1` para habilitar reasoning del endpoint de NVIDIA.
- `NVIDIA_REASONING_BUDGET`: opcional. Solo aplica si `NVIDIA_ENABLE_THINKING=1`.
- `NEXTJS_ENV`: opcional, usada por el runtime de OpenNext/Cloudflare.
- `CLOUDFLARE_WEB_ANALYTICS_TOKEN`: opcional, habilita Web Analytics de Cloudflare en el frontend.

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
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=tu_clave
```

Para probar NVIDIA:

```bash
AI_PROVIDER=nvidia
NVIDIA_API_KEY=tu_clave
NVIDIA_MODEL=nvidia/nemotron-3-ultra-550b-a55b
```

Luego ejecutar:

```bash
npm run dev
```

Abrir `http://localhost:3000`.

### Qué esperar en local

- La UI del chat funciona.
- La respuesta se muestra en streaming mientras llega, con detección de errores y salidas inválidas.
- Si no hay bindings reales de Cloudflare, el historial y el rate limit quedan desactivados o en modo no-op.
- La aplicación sigue respondiendo mientras exista la API key del proveedor configurado.

## Preview y despliegue

- `npm run preview` levanta el bundle de OpenNext para validación local del runtime Cloudflare.
- `npm run deploy` publica en Cloudflare cuando los bindings y secretos están configurados.
- `.github/workflows/deploy.yml` automatiza el deploy a Cloudflare cuando `CI` termina correctamente sobre `main`, y también permite `workflow_dispatch` con validación previa.

### Despliegue en Cloudflare

1. Inicia sesión en Cloudflare en tu máquina local:

```bash
npx wrangler login
```

2. Verifica que existan los bindings remotos definidos en [`wrangler.jsonc`](/Users/cab/VSCODE/travel2chile/wrangler.jsonc):
- D1 para `travel2chile_db`
- KV para `travel2chile_kv`
- R2 para `travel2chile_images`

3. Carga el secreto del proveedor en Cloudflare:

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

Si usas NVIDIA:

```bash
npx wrangler secret put NVIDIA_API_KEY
```

La configuración productiva del repositorio ya deja `AI_PROVIDER=nvidia` y el modelo `nvidia/nemotron-3-ultra-550b-a55b` en [`wrangler.jsonc`](/Users/cab/VSCODE/travel2chile/wrangler.jsonc). Para producción solo falta cargar `NVIDIA_API_KEY` como secreto en Cloudflare.

Para desarrollo local puedes partir desde:

- [\.env.example](/Users/cab/VSCODE/travel2chile/.env.example)
- [\.dev.vars.example](/Users/cab/VSCODE/travel2chile/.dev.vars.example)

4. Si quieres ver métricas de navegación en Cloudflare Web Analytics, agrega el token público como variable de entorno `CLOUDFLARE_WEB_ANALYTICS_TOKEN`.

5. Construye y despliega:

```bash
npm run deploy
```

6. Para validar antes del despliegue, usa:

```bash
npm run preview
```

### Deploy desde GitHub Actions

El repositorio espera estos secretos en GitHub:

- `CLOUDFLARE_API_TOKEN`: token con permisos para desplegar Workers y acceder a los recursos enlazados.
- `CLOUDFLARE_ACCOUNT_ID`: account ID de Cloudflare donde vive el Worker.

Comportamiento del pipeline:

- `CI` sigue ejecutando `lint`, `test` y `test:ui` en `push` a `main` y en `pull_request`.
- `Deploy` se dispara automáticamente solo cuando `CI` termina en verde para `main`.
- `Deploy` también puede ejecutarse manualmente por `workflow_dispatch`, pero en ese caso corre primero `lint`, `test` y `test:ui` antes de desplegar.

## Observabilidad en Cloudflare

- `observability.enabled` ya está activado en [`wrangler.jsonc`](/Users/cab/VSCODE/travel2chile/wrangler.jsonc), así que Cloudflare puede registrar trazas del Worker y sus invocaciones.
- Cuando `CLOUDFLARE_WEB_ANALYTICS_TOKEN` está definido, la app inyecta el beacon de Cloudflare Web Analytics y reporta tráfico de página desde el navegador.
- Para ver trazas de uso completas conviene usar ambas capas: observabilidad del Worker y Web Analytics del frontend.
- El camino recomendado para monitoreo externo del Sprint 7 quedó documentado en [`docs/monitoring-new-relic.md`](/Users/cab/VSCODE/travel2chile/docs/monitoring-new-relic.md).

## Esquema de datos

La base D1 usa dos tablas:

- `conversations`: agrupa mensajes por `session_id`.
- `messages`: guarda `role`, `content` y timestamps por conversación.

El esquema completo está en [`db/schema.sql`](/Users/cab/VSCODE/travel2chile/db/schema.sql).

## Limitaciones actuales

- Sin la API key del proveedor configurado no hay respuesta de IA.
- En `next dev`, si no están disponibles los bindings de Cloudflare, no hay persistencia de historial ni rate limit.
- La persistencia es por sesión y tiene una ventana de reutilización de 24 horas para conversaciones activas.
- El rate limit solo se aplica cuando KV está disponible.
- La calidad final sigue dependiendo del modelo upstream; el sistema ahora bloquea muchas respuestas malas, pero no convierte un modelo débil en uno excelente.
- Si activas `NVIDIA_ENABLE_THINKING=1`, aumentan el tamaño y el riesgo de salidas incompatibles con este chat; por eso producción queda con `0`.

## Pruebas y verificación

La guía de pruebas está en [`docs/testing.md`](/Users/cab/VSCODE/travel2chile/docs/testing.md).
El repositorio ejecuta `lint`, `test` y `test:ui` en GitHub Actions para `push` a `main` y `pull_request`.
