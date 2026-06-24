# Plan de sprints

_Actualizado al 24 de junio de 2026._

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

## Sprint 7 recomendado: monitoreo externo y calidad operativa

### Objetivo

Sacar la observabilidad fuera del dashboard de Cloudflare y convertirla en monitoreo accionable con retención, alertas y dashboards.

### Entregables

- Decisión de stack externo de observabilidad:
  - New Relic;
  - Grafana/Loki;
  - u otra opción equivalente.
- Exportación de logs/eventos desde Cloudflare.
- Dashboard mínimo con:
  - volumen de mensajes;
  - tasa de errores por tipo;
  - prompts fuera de dominio;
  - respuestas inválidas detectadas;
  - retries iniciados por usuarios.
- Alertas básicas para alzas anómalas de `chat_provider_error` o `invalid_model_output`.

### Criterio de salida

- El equipo puede observar la app fuera de Cloudflare y recibir alertas sin inspección manual continua.

## Sprint 8 recomendado: calidad de contenido y routing de modelos

### Objetivo

Reducir la frecuencia de respuestas pobres o rechazadas mejorando la capa de generación.

### Entregables

- Evaluación comparativa entre el modelo actual y una opción más estable.
- Ajustes de prompt y de routing por tipo de consulta.
- Lista de casos reales problemáticos convertidos en regresiones de prueba.
- Política clara para itinerarios largos, tablas y comparaciones.

### Criterio de salida

- Baja la tasa de `invalid_model_output` y mejoran las respuestas largas en producción.

## Sprint 9 recomendado: memoria útil y producto

### Objetivo

Mejorar la continuidad real de la conversación sin sacrificar robustez.

### Entregables

- Revisión de cuánto historial enviar al modelo.
- Segmentación de sesiones por intención o tipo de viaje.
- Recuperación más rica de conversaciones anteriores.
- Métricas de producto para evaluar utilidad real del chat.

### Criterio de salida

- La app recuerda mejor el contexto útil y el equipo puede medir si eso mejora conversión o satisfacción.
