# Plan de sprints

_Actualizado al 26 de junio de 2026._

## Sprint 1: estabilización base

### Objetivo

Dejar la aplicación compilando, documentada y con pruebas básicas.

### Entregables

- README actualizado.
- Documentación de pruebas.
- Tipos de Cloudflare consistentes.
- Lint funcional.
- Build funcional.

### Criterio de salida

- `npm run build`, `npm run lint` y la documentación base quedan aprobados.

## Sprint 2: cobertura automática

### Objetivo

Probar comportamiento real de la API y la persistencia.

### Entregables

- Suite Vitest para `src/lib/db.ts`.
- Tests de `POST /api/chat` y `GET|DELETE /api/history`.
- Mocks de D1 y KV para evitar dependencia de infraestructura externa.

### Criterio de salida

- La lógica de persistencia y la API crítica quedan verificadas por tests.

## Sprint 3: validación de interfaz

### Objetivo

Confirmar el flujo principal desde el navegador.

### Entregables

- Smoke test de Playwright.
- Selectores estables en la UI.

### Criterio de salida

- La landing, el acceso al chat y el envío de mensajes quedan validados en un navegador real.

## Sprint 4: integración continua

### Objetivo

Automatizar la calidad en cada cambio.

### Entregables

- Workflow de GitHub Actions.
- Ejecución de `lint`, `test` y `test:ui` en `push` y `pull_request`.

### Criterio de salida

- No se puede introducir un cambio principal sin pasar la suite completa.

## Sprint 5: despliegue y observabilidad

### Objetivo

Operar el sistema en Cloudflare con visibilidad suficiente.

### Entregables

- Flujo de deploy documentado.
- Observabilidad del Worker habilitada.
- Cloudflare Web Analytics opcional en el frontend.

### Criterio de salida

- El equipo puede desplegar y revisar uso real sin adivinar el estado de la app.

## Siguiente sprint recomendado

Con el trabajo actual ya estable, el siguiente foco lógico es:

1. automatizar deploy a Cloudflare desde CI;
2. endurecer manejo de errores de OpenRouter;
3. mejorar métricas de producto y trazabilidad de uso;
4. revisar si hace falta segmentar mejor el historial por tipo de viaje.

## Sprint 6 recomendado: operación automatizada y robustez

### Objetivo

Convertir el estado actual en una operación repetible, observable y más resistente a fallos externos.

### Entregables

- Workflow de deploy a Cloudflare.
- Manejo de errores de OpenRouter endurecido en backend y UI.
- Instrumentación mínima de uso y fallos.
- Cobertura de tests para los nuevos caminos de error.

### Criterio de salida

- El equipo puede validar, desplegar y diagnosticar la app sin depender de pasos manuales implícitos.

### Preparación detallada

- Ver [`docs/sprint-6-execution.md`](/Users/cab/VSCODE/travel2chile/docs/sprint-6-execution.md).

## Sprint 6 ejecutado: operación automatizada y robustez

### Resultado

- Deploy automático a Cloudflare implementado.
- Errores del proveedor endurecidos en backend y UI.
- Observabilidad mínima de eventos implementada.
- Cobertura de tests ampliada.
- Respuestas del modelo validadas antes de ser mostradas o persistidas.

### Entregables reales

- `.github/workflows/deploy.yml`
- Errores SSE tipados en `src/lib/ai.ts` y `src/app/api/chat/route.ts`
- Retry de UI en `src/components/ChatInterface.tsx`
- Logs estructurados del Worker en `src/lib/observability.ts`
- Guardas de dominio y de calidad de respuesta en `src/lib/domain-guard.ts` y `src/lib/output-guard.ts`

### Criterio de salida cumplido

- El equipo puede desplegar, diagnosticar y contener respuestas inválidas sin depender de pasos manuales implícitos.

## Sprint 7 recomendado: validación productiva de NVIDIA y operación local limpia

### Objetivo

Consolidar el cambio de proveedor a NVIDIA, reducir la fricción del entorno de desarrollo y validar comportamiento real en producción.

### Entregables

- Producción desplegada con `AI_PROVIDER=nvidia`.
- `NVIDIA_MAX_TOKENS` ajustado y validado con tráfico real.
- Confirmación de que el stream no duplica texto en producción.
- Ruta de desarrollo local documentada con `DISABLE_CLOUDFLARE_BINDINGS_IN_DEV=1`.
- Checklist operativo de pruebas rápidas para diferenciar errores de proveedor vs errores del runtime local.

### Criterio de salida

- El equipo puede probar, validar y desplegar NVIDIA sin ambigüedad entre `next dev`, runtime Cloudflare local y producción.

## Sprint 8 recomendado: calidad de contenido, latencia y fallback de proveedor

### Objetivo

Reducir latencia y degradaciones del chat, con política explícita de proveedor principal y fallback.

### Entregables

- Evaluación comparativa entre el modelo NVIDIA activo y al menos una alternativa de fallback.
- Ajustes de prompt y de generación para respuestas largas.
- Decisión sobre fallback explícito a OpenRouter o segundo modelo NVIDIA.
- Lista de casos reales problemáticos convertidos en regresiones de prueba.
- Política clara para itinerarios largos, tablas y comparaciones.
- Revisión de `max_tokens`, estructura de respuesta y tiempos medios por tipo de consulta.

### Criterio de salida

- Bajan la latencia y la tasa de `invalid_model_output`, y existe un fallback documentado.

## Sprint 9 recomendado: observabilidad externa y métricas de producto

### Objetivo

Salir del puro dashboard operativo y empezar a medir uso real y salud de la app con más profundidad.

### Entregables

- Decisión final sobre si Cloudflare Observability alcanza o si conviene stack externo.
- Dashboard mínimo con:
  - volumen de mensajes;
  - tasa de errores por tipo;
  - retries de UI;
  - prompts fuera de dominio;
  - respuestas inválidas detectadas.
- Alertas básicas o equivalente operativo.
- Métricas de producto para evaluar utilidad real del chat.

### Criterio de salida

- El equipo puede observar la app de forma operativa y medir salud/uso sin inspección manual continua.

## Sprint 10 recomendado: memoria útil y producto

### Objetivo

Mejorar la continuidad real de la conversación sin sacrificar robustez.

### Entregables

- Revisión de cuánto historial enviar al modelo.
- Segmentación de sesiones por intención o tipo de viaje.
- Recuperación más rica de conversaciones anteriores.
- Métricas de producto para evaluar utilidad real del chat.

### Criterio de salida

- La app recuerda mejor el contexto útil y el equipo puede medir si eso mejora conversión o satisfacción.
