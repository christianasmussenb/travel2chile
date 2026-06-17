# Plan de pruebas

Este documento define la verificación mínima para considerar estable a Travel2Chile v4.

## Objetivo

- Confirmar que la aplicación compila.
- Confirmar que el lint está limpio.
- Confirmar que el chat responde en streaming.
- Confirmar que el historial y la limpieza de sesión funcionan.
- Confirmar que el comportamiento cambia correctamente entre local y Cloudflare.

## Alcance

- UI pública de landing y chat.
- API de chat.
- API de historial.
- Helpers de persistencia.
- Integración con OpenRouter.
- Integración con D1 y KV cuando existan bindings reales.

## Criterios de aceptación

- `npm run build` termina sin errores.
- `npm run lint` termina sin errores.
- `npm run test` termina sin errores.
- `npm run test:ui` termina sin errores.
- `GET /chat` carga la interfaz sin errores visuales o de consola críticos.
- `POST /api/chat` devuelve una respuesta SSE válida.
- `GET /api/history` devuelve historial cuando hay D1.
- `DELETE /api/history` elimina la conversación actual.
- La aplicación sigue funcionando sin bindings en local, salvo persistencia/rate limit.

## Casos críticos

### 1. Mensaje vacío

- Entrada: `POST /api/chat` con `message` vacío.
- Resultado esperado: respuesta `400`.

### 2. Sin API key

- Entrada: `POST /api/chat` sin `OPENROUTER_API_KEY`.
- Resultado esperado: error controlado en SSE y código `500`.

### 3. Streaming de respuesta

- Entrada: mensaje válido.
- Resultado esperado: múltiples eventos `data:` con `text` incremental y cierre `data: [DONE]`.

### 4. Persistencia de historial

- Entrada: dos mensajes consecutivos con el mismo `sessionId`.
- Resultado esperado: `GET /api/history` devuelve la conversación previa cuando D1 está disponible.

### 5. Limpieza de sesión

- Entrada: `DELETE /api/history` con `sessionId`.
- Resultado esperado: la conversación desaparece de la sesión.

### 6. Rate limit

- Entrada: múltiples mensajes desde la misma IP con KV disponible.
- Resultado esperado: al superar el límite se devuelve `429` con mensaje controlado.

## Verificación local

Ejecutar:

```bash
npm run build
npm run lint
npm run test
npm run test:ui
```

Luego validar manualmente:

1. Abrir `/`.
2. Entrar a `/chat`.
3. Enviar una pregunta simple.
4. Confirmar que aparece la respuesta incremental.
5. Confirmar que el botón de nueva conversación limpia el estado visible.

## Verificación Cloudflare

En preview o despliegue real:

1. Confirmar que D1 está enlazado.
2. Confirmar que KV está enlazado.
3. Enviar dos o tres mensajes.
4. Recargar la página.
5. Confirmar que el historial reaparece.
6. Vaciar la conversación y confirmar que el historial se elimina.

## Automatización recomendada

- Unit/integration tests para `src/lib/db.ts`.
- Tests de API para `src/app/api/chat/route.ts` y `src/app/api/history/route.ts`.
- Smoke test de UI para landing + chat.
- Smoke test de UI con Playwright para landing + chat.
- Un caso end-to-end en preview Cloudflare.

## Riesgos conocidos

- La API externa puede responder lento o fallar.
- En local sin bindings, la experiencia es correcta pero sin persistencia real.
- El lint debe ejecutarse con ESLint directo, no con `next lint`.
