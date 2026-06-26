# Aprendizajes del proyecto

_Actualizado al 26 de junio de 2026._

## Arquitectura

- OpenNext con Cloudflare funciona bien para este caso, pero requiere cuidar la compatibilidad de tipos y runtime.
- Separar la UI del chat de la lógica de API facilita testear y mantener el sistema.
- El patrón SSE sigue siendo útil, pero streamear ciegamente la salida del modelo degrada la calidad cuando el proveedor entrega respuestas corruptas o truncadas.
- El punto medio más usable para este producto es un streaming controlado con guardas de salida, no un buffering total que degrade demasiado la experiencia del chat.
- Cuando el stream pasa por varias capas, no basta con culpar al modelo: primero hay que verificar si el propio pipeline SSE está reemitiendo texto.

## Tipado y entorno

- Los tipos de Cloudflare deben estar disponibles de forma consistente para que el typecheck no falle.
- Incluir `*.d.ts` en `tsconfig.json` evita que las definiciones ambient se pierdan.
- La configuración de Next, ESLint y OpenNext debe revisarse en conjunto; las combinaciones de versiones pueden romper `next lint` o la carga de presets.
- Los artefactos efímeros como `test-results/` deben quedar ignorados por ESLint para no introducir fallos falsos en CI o en validaciones locales.
- En este stack, `next dev` y el runtime Cloudflare no leen exactamente las mismas fuentes de configuración; hay que alinear `.env.local`, `.dev.vars` y `wrangler.jsonc`.

## Persistencia

- D1 encaja bien para historial liviano por sesión.
- Conviene desacoplar la lógica de persistencia del transporte HTTP para poder probarla con dobles in-memory.
- La ventana de 24 horas para reutilizar conversación es útil como regla operativa simple, pero debe documentarse para evitar confusión.
- No conviene persistir respuestas parciales o fallidas del modelo; es mejor guardar solo salidas completas que hayan atravesado las guardas del stream.
- Para depurar proveedor/modelo en local, conviene poder desactivar bindings remotos de Cloudflare y dejar historial/rate-limit como no-op.

## Observabilidad

- `wrangler.jsonc` con `observability.enabled` da trazas del Worker, pero no reemplaza la analítica de navegación en el navegador.
- Para tener visibilidad completa, conviene combinar observabilidad del Worker con Cloudflare Web Analytics.
- Los logs estructurados del Worker son suficientes para un primer nivel de eventos de producto, pero no reemplazan una plataforma externa para alertas, retención larga o dashboards compartidos.
- Diseñar nombres estables de eventos desde temprano (`chat_message_sent`, `chat_provider_error`, etc.) simplifica muchísimo la operación posterior.
- Agregar logs explícitos con `status`, `code`, `name` y `message` del proveedor acelera muchísimo el diagnóstico real; evita semanas de “prueba y error”.

## Calidad del modelo

- Un prompt fuerte no alcanza para contener respuestas inválidas del proveedor.
- Los fallos reales más comunes no son solo timeouts: también aparecen reasoning leaks, respuestas fuera de dominio, repeticiones parciales, secciones reiniciadas y entidades inventadas.
- El proveedor puede entregar texto “bien formado” sintácticamente pero semánticamente roto; por eso hacen falta guardas de salida, no solo manejo de errores HTTP.
- Los modelos baratos o gratuitos pueden ser suficientes para respuestas cortas, pero sufren más en respuestas largas con tablas, itinerarios y comparaciones.
- Los modelos reasoning-capable pueden funcionar bien, pero no conviene habilitar `thinking` por defecto en un chat de usuario final si la UX depende de respuestas limpias por streaming.
- En NVIDIA, parámetros como `extra_body` no deben enviarse si el modo correspondiente está apagado; el endpoint puede rechazarlos aunque el resto del request sea válido.

## Testing

- Vitest fue suficiente para cubrir API y persistencia sin introducir una arquitectura de tests pesada.
- Playwright es la mejor opción para un smoke test real del frontend, pero exige descargar Chromium y correr sobre un servidor local.
- Los tests de UI deben priorizar flujos críticos y selectores estables, no detalles visuales frágiles.
- Cuando el producto depende de IA, los tests más valiosos no son “el modelo responde bien”, sino “el sistema se comporta bien cuando el modelo responde mal”.
- Cubrir retries, errores tipados y respuestas inválidas evita regresiones silenciosas muy costosas.
- Para bugs de streaming, un harness de diagnóstico controlado vale más que veinte pruebas manuales en UI.

## Operación

- Sin la API key del proveedor activo el sistema no puede responder, así que ese secreto debe tratarse como requisito de despliegue.
- En local sin bindings, la experiencia sigue siendo útil, pero no hay persistencia ni rate limit reales.
- Documentar explícitamente estas diferencias reduce tiempo perdido en debugging de entorno.
- Tener deploy automatizado reduce el costo operativo, pero no reemplaza la validación manual en el entorno real después de cambios de guardas o del flujo del modelo.
- Cuando hay errores recuperables del modelo, ofrecer un retry explícito en UI es mejor que dejar al usuario reescribir el prompt.
- Para este producto, conviene dejar el “thinking” de proveedores reasoning-capable apagado por defecto en producción si la UX depende de respuestas limpias y cortas por streaming.
- Los límites del runtime local de Cloudflare pueden producir errores que parecen del proveedor, pero no lo son; el entorno de dev necesita una ruta de escape clara.
