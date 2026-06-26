# Monitoreo externo con New Relic

_Definido el 26 de junio de 2026 como camino recomendado para el Sprint 7._

## Decisión

Para sacar la observabilidad fuera de Cloudflare con el menor esfuerzo operativo, este proyecto adopta `New Relic` como primer stack externo.

La decisión se basa en tres puntos:

- Cloudflare soporta `Logpush -> New Relic` de forma nativa.
- El dataset `workers_trace_events` incluye `Logs`, es decir, los `console.log()` del Worker donde ya emitimos nuestros `app_event`.
- No hace falta cambiar la arquitectura del chat ni agregar un collector intermedio.

## Qué se exporta

La app ya emite eventos estructurados desde [`src/lib/observability.ts`](/Users/cab/VSCODE/travel2chile/src/lib/observability.ts):

- `chat_session_started`
- `chat_message_sent`
- `chat_response_completed`
- `chat_provider_error`
- `chat_rate_limited`
- `chat_history_cleared`

Cada uno sale por `console.log(JSON.stringify(...))` con este shape base:

- `source: "travel2chile"`
- `type: "app_event"`
- `event`
- `timestamp`
- campos de contexto como `sessionId`, `errorCode`, `responseLength`, `retryable`, etc.

Eso ya alcanza para dashboards y alertas de producto/operación.

## Dataset recomendado

Usar el dataset account-scoped `workers_trace_events`.

Motivo:

- trae invocaciones del Worker;
- trae excepciones;
- trae `Logs`, que es donde aparecen nuestros eventos estructurados.

No hace falta empezar por `http_requests` porque el foco del sprint es monitorear comportamiento del chat y errores de modelo, no analítica general del edge.

## Requisitos

### En New Relic

- Tener una cuenta activa.
- Obtener la `license key` de ingest.
- Confirmar la región de la cuenta:
  - `US`
  - `EU`

### En Cloudflare

- Tener acceso a `Logs / Logpush` a nivel de cuenta.
- Poder crear un job sobre el dataset `workers_trace_events`.

## Configuración recomendada

### Opción dashboard

En Cloudflare:

1. Ir a `Logs` -> `Logpush` a nivel `Account`.
2. Crear un job nuevo.
3. Elegir destino `New Relic`.
4. Usar el endpoint según región:
   - US: `https://log-api.newrelic.com/log/v1?Api-Key=<NR_LICENSE_KEY>&format=cloudflare`
   - EU: `https://log-api.eu.newrelic.com/log/v1?Api-Key=<NR_LICENSE_KEY>&format=cloudflare`
5. Elegir dataset `workers_trace_events`.
6. En output/timestamps, preferir `timestamp_format = unix`.
7. Guardar y habilitar el job.

### Opción API

Si se quiere automatizar fuera del dashboard, el job puede crearse por API de Cloudflare usando:

- `dataset: "workers_trace_events"`
- `destination_conf` apuntando al endpoint de New Relic
- `output_options.timestamp_format = "unix"`

## Qué mirar en New Relic

### Señal mínima

Filtrar primero por:

- `source = 'travel2chile'`
- `type = 'app_event'`

### Eventos clave

- volumen de mensajes: `chat_message_sent`
- completitud de respuestas: `chat_response_completed`
- errores del proveedor: `chat_provider_error`
- rate limit: `chat_rate_limited`
- limpieza de historial: `chat_history_cleared`

## Dashboard mínimo sugerido

1. Mensajes por minuto.
2. Respuestas completas por minuto.
3. Errores por `errorCode`.
4. Tasa de `chat_provider_error / chat_message_sent`.
5. Tasa de `chat_rate_limited`.
6. Longitud promedio de respuesta (`responseLength`) cuando existe.

## Alertas mínimas

Crear al menos estas alertas:

1. `chat_provider_error` sobre umbral absoluto en 5 minutos.
2. `chat_provider_error / chat_message_sent` sobre umbral porcentual.
3. aparición de `invalid_model_output`.
4. alza súbita de `chat_rate_limited`.

## NRQL de arranque

Estos ejemplos asumen que New Relic parsea el JSON exportado y expone los atributos tal como llegan.

### Mensajes enviados

```sql
SELECT count(*)
FROM Log
WHERE source = 'travel2chile'
  AND type = 'app_event'
  AND event = 'chat_message_sent'
TIMESERIES 1 minute
```

### Respuestas completadas

```sql
SELECT count(*)
FROM Log
WHERE source = 'travel2chile'
  AND type = 'app_event'
  AND event = 'chat_response_completed'
TIMESERIES 1 minute
```

### Errores por código

```sql
SELECT count(*)
FROM Log
WHERE source = 'travel2chile'
  AND type = 'app_event'
  AND event = 'chat_provider_error'
FACET errorCode
SINCE 1 hour ago
```

### Ratio simple de errores

```sql
SELECT
  filter(count(*), WHERE event = 'chat_provider_error') AS errors,
  filter(count(*), WHERE event = 'chat_message_sent') AS messages
FROM Log
WHERE source = 'travel2chile'
  AND type = 'app_event'
SINCE 1 hour ago
```

### Respuestas promedio

```sql
SELECT average(responseLength)
FROM Log
WHERE source = 'travel2chile'
  AND type = 'app_event'
  AND event = 'chat_response_completed'
SINCE 1 hour ago
TIMESERIES 5 minutes
```

## Verificación posterior a la activación

1. Abrir la app y mandar 3 a 5 prompts reales.
2. Confirmar en Cloudflare Observability que se ven eventos recientes.
3. Confirmar en New Relic que llegan registros del dataset.
4. Verificar que al menos aparezcan:
   - `chat_session_started`
   - `chat_message_sent`
   - `chat_response_completed` o `chat_provider_error`
5. Crear una alerta de prueba sobre `chat_provider_error`.

## Limitaciones

- Esto exporta observabilidad del Worker, no reemplaza métricas de navegación del frontend.
- Si más adelante se quiere trazabilidad más rica entre frontend, backend y proveedor, hará falta instrumentación adicional.
- Si el equipo ya estandariza dashboards, storage y alertas en Grafana/Loki, esa alternativa puede tener más sentido estratégico, pero requiere más piezas operativas.

## Siguiente paso exacto

Cerrar el Sprint 7 con:

1. job `Logpush` activo a `New Relic`;
2. dashboard mínimo creado;
3. una alerta de errores del proveedor operativa;
4. validación con tráfico real desde la URL productiva.
