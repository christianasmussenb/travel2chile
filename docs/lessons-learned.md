# Aprendizajes del proyecto

_Actualizado al 24 de junio de 2026._

## Arquitectura

- OpenNext con Cloudflare funciona bien para este caso, pero requiere cuidar la compatibilidad de tipos y runtime.
- Separar la UI del chat de la lógica de API facilita testear y mantener el sistema.
- El patrón SSE sigue siendo útil, pero streamear ciegamente la salida del modelo degrada la calidad cuando el proveedor entrega respuestas corruptas o truncadas.
- El punto medio más usable para este producto es un streaming controlado con guardas de salida, no un buffering total que degrade demasiado la experiencia del chat.

## Tipado y entorno

- Los tipos de Cloudflare deben estar disponibles de forma consistente para que el typecheck no falle.
- Incluir `*.d.ts` en `tsconfig.json` evita que las definiciones ambient se pierdan.
- La configuración de Next, ESLint y OpenNext debe revisarse en conjunto; las combinaciones de versiones pueden romper `next lint` o la carga de presets.
- Los artefactos efímeros como `test-results/` deben quedar ignorados por ESLint para no introducir fallos falsos en CI o en validaciones locales.

## Persistencia

- D1 encaja bien para historial liviano por sesión.
- Conviene desacoplar la lógica de persistencia del transporte HTTP para poder probarla con dobles in-memory.
- La ventana de 24 horas para reutilizar conversación es útil como regla operativa simple, pero debe documentarse para evitar confusión.
- No conviene persistir respuestas parciales o fallidas del modelo; es mejor guardar solo salidas completas que hayan atravesado las guardas del stream.

## Observabilidad

- `wrangler.jsonc` con `observability.enabled` da trazas del Worker, pero no reemplaza la analítica de navegación en el navegador.
- Para tener visibilidad completa, conviene combinar observabilidad del Worker con Cloudflare Web Analytics.
- Los logs estructurados del Worker son suficientes para un primer nivel de eventos de producto, pero no reemplazan una plataforma externa para alertas, retención larga o dashboards compartidos.
- Diseñar nombres estables de eventos desde temprano (`chat_message_sent`, `chat_provider_error`, etc.) simplifica muchísimo la operación posterior.

## Calidad del modelo

- Un prompt fuerte no alcanza para contener respuestas inválidas del proveedor.
- Los fallos reales más comunes no son solo timeouts: también aparecen reasoning leaks, respuestas fuera de dominio, repeticiones parciales, secciones reiniciadas y entidades inventadas.
- El proveedor puede entregar texto “bien formado” sintácticamente pero semánticamente roto; por eso hacen falta guardas de salida, no solo manejo de errores HTTP.
- Los modelos baratos o gratuitos pueden ser suficientes para respuestas cortas, pero sufren más en respuestas largas con tablas, itinerarios y comparaciones.

## Testing

- Vitest fue suficiente para cubrir API y persistencia sin introducir una arquitectura de tests pesada.
- Playwright es la mejor opción para un smoke test real del frontend, pero exige descargar Chromium y correr sobre un servidor local.
- Los tests de UI deben priorizar flujos críticos y selectores estables, no detalles visuales frágiles.
- Cuando el producto depende de IA, los tests más valiosos no son “el modelo responde bien”, sino “el sistema se comporta bien cuando el modelo responde mal”.
- Cubrir retries, errores tipados y respuestas inválidas evita regresiones silenciosas muy costosas.

## Operación

- Sin `OPENROUTER_API_KEY` el sistema no puede responder, así que ese secreto debe tratarse como requisito de despliegue.
- En local sin bindings, la experiencia sigue siendo útil, pero no hay persistencia ni rate limit reales.
- Documentar explícitamente estas diferencias reduce tiempo perdido en debugging de entorno.
- Tener deploy automatizado reduce el costo operativo, pero no reemplaza la validación manual en el entorno real después de cambios de guardas o del flujo del modelo.
- Cuando hay errores recuperables del modelo, ofrecer un retry explícito en UI es mejor que dejar al usuario reescribir el prompt.
