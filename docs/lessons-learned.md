# Aprendizajes del proyecto

_Estado al 18 de junio de 2026._

## Arquitectura

- OpenNext con Cloudflare funciona bien para este caso, pero requiere cuidar la compatibilidad de tipos y runtime.
- Separar la UI del chat de la lógica de API facilita testear y mantener el sistema.
- El patrón SSE simplifica el streaming al cliente y reduce la latencia percibida.

## Tipado y entorno

- Los tipos de Cloudflare deben estar disponibles de forma consistente para que el typecheck no falle.
- Incluir `*.d.ts` en `tsconfig.json` evita que las definiciones ambient se pierdan.
- La configuración de Next, ESLint y OpenNext debe revisarse en conjunto; las combinaciones de versiones pueden romper `next lint` o la carga de presets.

## Persistencia

- D1 encaja bien para historial liviano por sesión.
- Conviene desacoplar la lógica de persistencia del transporte HTTP para poder probarla con dobles in-memory.
- La ventana de 24 horas para reutilizar conversación es útil como regla operativa simple, pero debe documentarse para evitar confusión.

## Observabilidad

- `wrangler.jsonc` con `observability.enabled` da trazas del Worker, pero no reemplaza la analítica de navegación en el navegador.
- Para tener visibilidad completa, conviene combinar observabilidad del Worker con Cloudflare Web Analytics.

## Testing

- Vitest fue suficiente para cubrir API y persistencia sin introducir una arquitectura de tests pesada.
- Playwright es la mejor opción para un smoke test real del frontend, pero exige descargar Chromium y correr sobre un servidor local.
- Los tests de UI deben priorizar flujos críticos y selectores estables, no detalles visuales frágiles.

## Operación

- Sin `OPENROUTER_API_KEY` el sistema no puede responder, así que ese secreto debe tratarse como requisito de despliegue.
- En local sin bindings, la experiencia sigue siendo útil, pero no hay persistencia ni rate limit reales.
- Documentar explícitamente estas diferencias reduce tiempo perdido en debugging de entorno.

