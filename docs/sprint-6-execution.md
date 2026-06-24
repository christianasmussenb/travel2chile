# Sprint 6: ejecución preparada

_Preparado el 24 de junio de 2026._

## Objetivo

Llevar Travel2Chile desde un estado funcional y probado a un estado operable con despliegue automatizado, errores más controlados y señales mínimas de uso real.

## Resultado esperado

- Cada cambio en `main` puede desplegarse a Cloudflare con un flujo repetible.
- Los errores de OpenRouter dejan de verse como fallas opacas en streaming.
- El equipo obtiene visibilidad básica de uso y fallos para tomar decisiones del siguiente ciclo.

## Alcance del sprint

### Línea 1: deploy automatizado

- Crear workflow separado para deploy a Cloudflare.
- Definir gatillos: `push` a `main` y `workflow_dispatch`.
- Configurar secretos necesarios y documentarlos:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `OPENROUTER_API_KEY` si el flujo de build lo requiere
- Evitar desplegar si falla `lint`, `test` o `test:ui`.

### Línea 2: robustez de errores del chat

- Clasificar errores de `OPENROUTER_API_KEY` ausente, timeout, rate limit upstream y error genérico.
- Emitir payload SSE consistente para errores.
- Mostrar estados distinguibles en la UI:
  - error de configuración;
  - error temporal del proveedor;
  - límite alcanzado;
  - problema de red del cliente.
- Confirmar que no se persiste una respuesta parcial corrupta en D1.

### Línea 3: métricas mínimas

- Definir eventos mínimos útiles:
  - inicio de sesión de chat;
  - mensaje enviado;
  - respuesta completada;
  - error de proveedor;
  - rate limit activado;
  - conversación limpiada.
- Decidir si la primera implementación vive en logs/observabilidad del Worker o en Web Analytics con eventos simples.
- Documentar cómo leer esas señales después del despliegue.

## Tareas ejecutables

1. Crear el workflow de deploy y encadenarlo a la validación existente.
2. Documentar variables y secretos del pipeline en `README.md`.
3. Refactorizar `src/lib/ai.ts` para devolver errores tipificados.
4. Ajustar `src/app/api/chat/route.ts` para traducir errores a SSE estable.
5. Ajustar `src/components/ChatInterface.tsx` para reflejar estados de error sin ambigüedad.
6. Agregar tests de API para errores upstream y de UI para mensajes de error visibles.
7. Registrar eventos mínimos de observabilidad y documentarlos.
8. Ejecutar `npm run lint`, `npm run test`, `npm run build` y `npm run test:ui`.

## Criterio de salida

- Existe un workflow de deploy listo para usarse en GitHub Actions.
- El chat diferencia errores internos, de proveedor y de red.
- La suite automática cubre el nuevo comportamiento.
- El equipo sabe qué mirar en Cloudflare para validar uso y fallos.

## Fuera de alcance

- Rediseño visual mayor del chat.
- Cambio de proveedor de IA.
- Persistencia avanzada por perfil de viajero.
- Analítica de negocio compleja o dashboards dedicados.

## Riesgos y dependencias

- El deploy depende de credenciales reales de Cloudflare aún no verificadas en este repositorio.
- La semántica exacta de errores de OpenRouter puede requerir inspección adicional en integración real.
- La observabilidad útil depende de decidir una convención mínima de eventos antes de instrumentar.

## Orden recomendado de ejecución

1. Pipeline de deploy.
2. Manejo de errores en backend.
3. Manejo de errores en frontend.
4. Cobertura de pruebas.
5. Instrumentación y documentación final.

## Implementación actual de observabilidad

- Los eventos mínimos viven en logs estructurados del Worker.
- Se emiten desde `src/app/api/chat/route.ts` y `src/app/api/history/route.ts`.
- El helper común está en `src/lib/observability.ts`.

### Eventos emitidos

- `chat_session_started`
- `chat_message_sent`
- `chat_response_completed`
- `chat_provider_error`
- `chat_rate_limited`
- `chat_history_cleared`

### Dónde mirarlos

1. Cloudflare Dashboard.
2. `Workers & Pages`.
3. Worker `travel2chile-v4`.
4. `Observability` o `Logs`.
5. Buscar entradas JSON con `"source":"travel2chile"` y `"type":"app_event"`.
