# Plan de sprints

_Estado al 18 de junio de 2026._

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
