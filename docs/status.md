# Estado del proyecto

_Estado verificado localmente al 24 de junio de 2026. Documentación actualizada tras el cierre técnico del Sprint 6._

## Resumen ejecutivo

Travel2Chile v4 ya dejó de ser un starter y pasó a ser una aplicación funcional de planificación de viajes por Chile con:

- landing pública;
- chat con streaming;
- memoria de conversación por sesión;
- persistencia en D1 cuando existen bindings de Cloudflare;
- rate limit por IP cuando KV está disponible;
- despliegue listo para OpenNext + Cloudflare;
- pruebas automáticas de API, persistencia y UI;
- observabilidad activada en Cloudflare y soporte opcional para Web Analytics.
- guardas de dominio y calidad para evitar respuestas inválidas del modelo.

## Avances completados

### Producto

- Se construyó una landing que presenta el producto y dirige al chat.
- El chat permite preguntas libres sobre destinos, temporadas, rutas y presupuesto.
- La respuesta del modelo se entrega al cliente por SSE después de validación server-side.
- Hay sugerencias iniciales para orientar el primer uso.
- Existe limpieza de conversación y navegación de vuelta al inicio.
- La UI permite reintentar una respuesta fallida sin duplicar el mensaje del usuario.

### Backend

- La API `POST /api/chat` valida mensajes vacíos, aplica rate limit cuando hay KV y responde con SSE.
- La API `GET /api/history` recupera historial por sesión cuando hay D1.
- La API `DELETE /api/history` limpia conversación e historial asociado.
- La persistencia se concentra en `src/lib/db.ts` y el esquema SQL está documentado.
- El backend bloquea prompts fuera de dominio y respuestas inválidas antes de enviarlas o persistirlas.
- La capa de validación detecta reasoning leak, truncados, reinicios/repeticiones anómalas y salidas semánticamente corruptas.

### Infraestructura

- El proyecto compila con Next.js 16 + OpenNext.
- `wrangler.jsonc` ya tiene D1, KV, R2 y observabilidad habilitados.
- El despliegue y preview están documentados.
- Hay workflow de deploy automático a Cloudflare desde GitHub Actions.
- Se agregó soporte opcional para Cloudflare Web Analytics en el frontend.

### Calidad

- Hay suite real de pruebas con Vitest para API y persistencia.
- Hay smoke test UI con Playwright.
- Hay CI en GitHub Actions para `lint`, `test` y `test:ui`.
- La documentación de pruebas quedó separada y mantenible.
- La suite cubre errores tipados, prompts fuera de dominio, respuestas inválidas, retry de UI y persistencia segura.

## Estado funcional actual

- `npm run build` pasa.
- `npm run lint` pasa.
- `npm run test` pasa.
- `npm run test:ui` pasa.
- El flujo principal está operativo en local y en Cloudflare con deploy automatizado.

## Verificación realizada el 24 de junio de 2026

- Se validó que los sprints 1 a 5 tienen correlato directo en código, pruebas y CI.
- Sprint 6 quedó implementado a nivel de código: deploy automático, endurecimiento de errores, observabilidad mínima y validación de salidas del modelo.
- Existen workflows de GitHub Actions en `.github/workflows/ci.yml` y `.github/workflows/deploy.yml`.
- La suite actual cubre API de chat, historial, persistencia D1 mockeada, smoke UI y retry de respuestas fallidas.
- La deuda principal ya no es de base técnica sino de monitoreo operativo, calidad del contenido y evolución de producto.

## Pendientes relevantes

- Validar en producción, con tráfico real, que el flujo `buffer + validar + emitir` elimina las respuestas rotas más frecuentes.
- Exportar o integrar observabilidad a una plataforma externa si el equipo necesita retención, alertas o dashboards fuera de Cloudflare.
- Agregar métricas de producto más específicas si el negocio lo requiere.
- Revisar si conviene persistir más contexto de conversación o segmentar por tipo de viaje.
- Definir si se mantiene `openrouter/free` o se migra a un modelo más estable para respuestas largas.

## Observabilidad operativa actual

- El deploy a Cloudflare ya puede automatizarse desde GitHub Actions.
- El chat ya clasifica errores del proveedor y los muestra de forma distinguible.
- La app emite eventos estructurados del Worker para sesiones, mensajes, respuestas completas, rate limit, errores del proveedor y limpieza de historial.
- Los errores recuperables muestran `Reintentar respuesta` en UI y quedan visibles como eventos del Worker.

## Cierre del Sprint 6

- Deploy automatizado a Cloudflare implementado.
- Manejo de errores de OpenRouter endurecido.
- Validación server-side de la respuesta completa antes de emitirla al cliente.
- Guardas contra fuera de dominio, reasoning leak, truncados, repeticiones y salidas corruptas.
- Retry de UI para respuestas fallidas.
- Observabilidad mínima con logs estructurados del Worker.
