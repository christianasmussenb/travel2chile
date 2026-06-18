# Estado del proyecto

_Estado al 18 de junio de 2026._

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

## Avances completados

### Producto

- Se construyó una landing que presenta el producto y dirige al chat.
- El chat permite preguntas libres sobre destinos, temporadas, rutas y presupuesto.
- La respuesta del modelo llega en streaming SSE.
- Hay sugerencias iniciales para orientar el primer uso.
- Existe limpieza de conversación y navegación de vuelta al inicio.

### Backend

- La API `POST /api/chat` valida mensajes vacíos, aplica rate limit cuando hay KV y responde con SSE.
- La API `GET /api/history` recupera historial por sesión cuando hay D1.
- La API `DELETE /api/history` limpia conversación e historial asociado.
- La persistencia se concentra en `src/lib/db.ts` y el esquema SQL está documentado.

### Infraestructura

- El proyecto compila con Next.js 16 + OpenNext.
- `wrangler.jsonc` ya tiene D1, KV, R2 y observabilidad habilitados.
- El despliegue y preview están documentados.
- Se agregó soporte opcional para Cloudflare Web Analytics en el frontend.

### Calidad

- Hay suite real de pruebas con Vitest para API y persistencia.
- Hay smoke test UI con Playwright.
- Hay CI en GitHub Actions para `lint`, `test` y `test:ui`.
- La documentación de pruebas quedó separada y mantenible.

## Estado funcional actual

- `npm run build` pasa.
- `npm run lint` pasa.
- `npm run test` pasa.
- `npm run test:ui` pasa.
- El flujo principal está operativo en local y en preview Cloudflare.

## Pendientes relevantes

- Conectar un despliegue automático a Cloudflare desde CI.
- Agregar métricas de producto más específicas si el negocio lo requiere.
- Endurecer el manejo de errores de OpenRouter y mostrar estados más explícitos en la UI.
- Revisar si conviene persistir más contexto de conversación o segmentar por tipo de viaje.

