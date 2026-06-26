# Estado del proyecto

_Estado verificado localmente al 26 de junio de 2026. Documentación actualizada tras el cierre técnico del Sprint 6, la incorporación de NVIDIA como proveedor activo y la estabilización del entorno local._

## Resumen ejecutivo

Travel2Chile v4 ya dejó de ser un starter y pasó a ser una aplicación funcional de planificación de viajes por Chile con:

- landing pública;
- chat con streaming;
- proveedor de IA configurable, hoy preparado para NVIDIA en producción;
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
- La respuesta del modelo se entrega al cliente por SSE con guardas de dominio y calidad durante el stream.
- Hay sugerencias iniciales para orientar el primer uso.
- Existe limpieza de conversación y navegación de vuelta al inicio.
- La UI permite reintentar una respuesta fallida sin duplicar el mensaje del usuario.
- La UI muestra debajo del input qué servicio y modelo están activos en ese entorno.

### Backend

- La API `POST /api/chat` valida mensajes vacíos, aplica rate limit cuando hay KV y responde con SSE.
- La API `GET /api/history` recupera historial por sesión cuando hay D1.
- La API `DELETE /api/history` limpia conversación e historial asociado.
- La persistencia se concentra en `src/lib/db.ts` y el esquema SQL está documentado.
- El backend bloquea prompts fuera de dominio y respuestas inválidas antes de enviarlas o persistirlas.
- La capa de validación detecta reasoning leak, truncados, reinicios/repeticiones anómalas y salidas semánticamente corruptas.
- El stream SSE quedó corregido para no reemitir texto ya enviado al cliente.
- La capa de IA resuelve proveedor por entorno y soporta `openrouter` o `nvidia`.

### Infraestructura

- El proyecto compila con Next.js 16 + OpenNext.
- `wrangler.jsonc` ya tiene D1, KV, R2 y observabilidad habilitados.
- El despliegue y preview están documentados.
- Hay workflow de deploy automático a Cloudflare desde GitHub Actions.
- Se agregó soporte opcional para Cloudflare Web Analytics en el frontend.
- Producción quedó preparada para `AI_PROVIDER=nvidia` con `nvidia/nemotron-3-ultra-550b-a55b`.
- En `next dev`, `DISABLE_CLOUDFLARE_BINDINGS_IN_DEV=1` permite probar el proveedor sin depender del runtime remoto de Cloudflare.

### Calidad

- Hay suite real de pruebas con Vitest para API y persistencia.
- Hay smoke test UI con Playwright.
- Hay CI en GitHub Actions para `lint`, `test` y `test:ui`.
- La documentación de pruebas quedó separada y mantenible.
- La suite cubre errores tipados, prompts fuera de dominio, respuestas inválidas, retry de UI y persistencia segura.
- Se agregó un harness de diagnóstico para reproducir y validar problemas reales del stream.

## Estado funcional actual

- `npm run build` pasa.
- `npm run lint` pasa.
- `npm run test` pasa.
- `npm run test:ui` pasa.
- El flujo principal está operativo en local y en Cloudflare con deploy automatizado.

## Verificación realizada el 26 de junio de 2026

- Se validó que los sprints 1 a 5 tienen correlato directo en código, pruebas y CI.
- Sprint 6 quedó implementado a nivel de código: deploy automático, endurecimiento de errores, observabilidad mínima y validación de salidas del modelo.
- Existen workflows de GitHub Actions en `.github/workflows/ci.yml` y `.github/workflows/deploy.yml`.
- La suite actual cubre API de chat, historial, persistencia D1 mockeada, smoke UI y retry de respuestas fallidas.
- Se validó la integración real con NVIDIA y se corrigieron errores de request y de streaming en el backend.
- La deuda principal ya no es de base técnica mínima sino de validación productiva, calidad de contenido y operación observada.

## Pendientes relevantes

- Validar en producción, con tráfico real, la latencia y estabilidad de NVIDIA con `NVIDIA_MAX_TOKENS=1536`.
- Confirmar si Cloudflare Observability alcanza para la operación diaria o si más adelante hace falta monitoreo externo.
- Agregar métricas de producto más específicas si el negocio lo requiere.
- Revisar si conviene persistir más contexto de conversación o segmentar por tipo de viaje.
- Evaluar si conviene mantener NVIDIA como único proveedor o agregar fallback explícito a OpenRouter.

## Observabilidad operativa actual

- El deploy a Cloudflare ya puede automatizarse desde GitHub Actions.
- El chat ya clasifica errores del proveedor y los muestra de forma distinguible.
- La app emite eventos estructurados del Worker para sesiones, mensajes, respuestas completas, rate limit, errores del proveedor y limpieza de historial.
- Los errores recuperables muestran `Reintentar respuesta` en UI y quedan visibles como eventos del Worker.
- Para el estado actual del proyecto, el monitoreo operativo base se hace con Cloudflare Observability en free tier.
- Se agregaron logs de detalle del proveedor para depurar diferencias entre entornos y requests upstream.

## Cierre del Sprint 6 ampliado

- Deploy automatizado a Cloudflare implementado.
- Manejo de errores de proveedor endurecido.
- Streaming controlado con guardas de salida durante la generación.
- Guardas contra fuera de dominio, reasoning leak, truncados, repeticiones y salidas corruptas.
- Retry de UI para respuestas fallidas.
- Observabilidad mínima con logs estructurados del Worker.
- Integración NVIDIA funcionando en local y lista para producción.
- Corrección del bug real de duplicación de texto en el stream SSE.
