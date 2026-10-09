# Olivo POS: estado y pendientes (revisión de octubre 2026)

Documento de traspaso para retomar en otra sesión. Última actualización: 09-10-2026.

## Cómo se trabajó

1. **Vendedora simulada:** usó la app una jornada completa en un teléfono emulado contra una copia local del esquema de producción (sin datos personales). Su informe está en `docs/revision-2026-10/01-vendedor.md`.
2. **QA:** verificó hallazgos y midió el daño en producción. **Se cortó por el límite de uso antes de escribir su informe** (ver pendiente P1).
3. **Ingeniero:** diseñó el plan (`03-ingeniero-plan.md`). La vendedora lo validó (`04-vendedor-validacion.md`) y quedó el plan acordado (`05-plan-acordado.md`).
4. **Implementación en tres frentes:** Venta (coordinador), Productos (ingeniero 1) y Caja (ingeniero 2). Se integró todo en la rama `ccr-8cc05d73-8l31jk`.

## Estado de ramas y PR

| Qué | Dónde | Estado |
|---|---|---|
| Compra propia pide el empleado que compra | PR #8 | **Mergeado y en producción** (01-10) |
| Todo lo demás (abajo) | rama `ccr-8cc05d73-8l31jk`, PR #9 | **Abierto, sin mergear.** El PR nació como hotfix de productos y ahora contiene toda la revisión |
| Migración M1 (un turno abierto por sucursal) | `docs/revision-2026-10/M1_un_turno_abierto_por_sucursal.sql` | **No aplicada.** Va en `OlivoWeb/supabase/migrations/` |

Verificación al cierre: `npm run typecheck`, `npm run lint` y `npm test` (108 tests) limpios, y `next build` compila. Cada flujo se probó con Playwright (Pixel 7) contra el sandbox.

## Qué se implementó (rama `ccr-8cc05d73-8l31jk`)

### Productos: datos que se perdían
- **Guardar un producto ya no borra el costo ni los mínimos y no revierte el stock** (`088bdcb`). Antes cada guardado ponía `purchase_price = 0` y `min_stock`/`optimum_stock` NULL, y aplicaba el stock que mostraba la pantalla como ajuste absoluto, lo que deshacía las ventas. **Mientras esto no esté en producción, el daño sigue ocurriendo.**
- "Nuevo" o una creación rápida con un código existente ya no lo sobrescribe: abre o reactiva ese producto.

### Venta (`bd734cd`, `4409c43`, `01f8c91`, `3709b65`)
- **Láser:** un solo dueño (`ScanProvider`).
  - Funciona en Venta sin abrir la cámara y nunca "presiona" el botón con foco (antes cobraba el producto anterior).
  - Si la lectura cae en un campo, no se escribe ahí (peso, precio).
  - Hay sonido en cada lectura y "No encontrado" visible.
- **Cobro:**
  - El total y el botón "Cobrar $X" quedan fijos abajo.
  - Efectivo, Tarjeta o Transferencia en un toque; los billetes se suman.
  - El vuelto solo sale del efectivo, y una banda "Venta #N · Vuelto $X" queda a la vista.
  - Pide confirmar si el efectivo recibido supera el total en más de $20.000.
- **Carrito:**
  - Sobrevive a cambiar de pestaña y a recargar ("Seguimos con la venta en curso").
  - Vaciarlo se puede deshacer.
- **Sin $0:**
  - Un producto sin precio pide el precio ahí mismo.
  - El servidor rechaza líneas a $0 en vivo y las acepta, anotadas, en los reintentos offline.
- **El servidor cobra el precio de la ficha** (`lib/pos/precios.ts`). Si no coincide responde 409 y el teléfono corrige el carrito.
- **Números:** "3.500", "30.000" y "0,35 kg" se entienden bien (`lib/num.ts`, `MoneyInput`).
- **"¿Quién atiende?" + Cerrar sesión:**
  - Cada venta queda con la persona elegida en el teléfono, no con la sesión de la mañana.
  - Cerrar sesión se bloquea si hay ventas sin enviar.
- **Ventas sin red:**
  - Guardan su hora real.
  - Una sesión vencida no pierde la venta: queda en la cola y se pide volver a entrar.
- **Interfaz:** botones de 44 a 64 px y avisos arriba, que no tapan el cobro.

### Caja (ingeniero 2)
- **Turnos:**
  - Nunca se abre sin sucursal ni dos veces.
  - El login recarga las sucursales.
  - La apertura propone "lo que se dejó para mañana" y vuelve sola a Venta.
- **Turno bien calculado:** el pago mixto ya no cuenta todo como efectivo, y lo "por cobrar" va aparte (`resumenTurno`).
- **Ventas del turno:**
  - Detalle y anulación con motivo, con el aviso "Devuelve $X".
  - "Anular y corregir" devuelve los productos al carrito.
  - Permisos: ADMIN siempre; SELLER solo en el turno abierto y dentro de los últimos 30 min.
- **Cierre:**
  - Compara por método con lo que registró el POS ("Faltan $2.000"), con "Volver a contar".
  - Pregunta "¿Cuánto dejas para mañana?" y pide confirmar.
  - Solo ADMIN puede re-registrar un turno cerrado.
- **Compras propias sin dueño:** se asignan desde Caja → Turno. Sirve para las ventas 257, 258, 260 y 261 de producción.
- **Movimientos de caja:** piden confirmar y el método se elige con botones.
- **Fiados:** la cuenta se elige de una lista, sin duplicados, y un abono a quien no debe pide confirmar.

### Productos: edición (ingeniero 1, `0b2272b`, `2e6cd1c`)
- **Ficha:**
  - Escanear en Productos abre la ficha con el precio seleccionado.
  - Enter guarda solo lo que cambió (`PATCH /api/products/[barcode]` con detección de conflicto).
- **Confirmaciones:** un precio bajo $50, sobre $100.000 o que cambia más del 50 % pide confirmar.
- **Ajustar stock** con motivo, idempotente y con 409 si el stock cambió entretanto.
- **Filtros:** Sin precio, Sin costo, Inactivos (con "Reactivar") y Con oferta.
- **Lista de precios:** escanear, tipear y Enter en serie. Se puede deshacer y reintentar lo que no se guardó.
- **Precios cambiados hoy:** muestra quién cambió cada precio, con auditoría en `audit_logs`.
- **Costo:** solo ADMIN lo ve; la API no se lo manda a SELLER.
- **Creaciones rápidas:** Recepción pide el precio; desde Venta, un texto se toma como nombre y no como código.

### Base técnica
- vitest con 108 tests y un workflow de CI (`.github/workflows/ci.yml`: typecheck, lint y test).

## Pendientes, en orden

### P0: hacer ya
1. **Revisar y mergear el PR #9.** Es grande: conviene probarlo en el preview de Vercel con un teléfono real y el lector láser antes de mergear. Después de mergear basta con cerrar y abrir la app; no hace falta un APK nuevo.
2. **Asignar dueño a las 4 compras propias de producción** (257, 258, 260, 261) desde Caja → Turno, después del merge. Las personas del local saben de quién es cada una.
3. **Medir y reparar el daño en producción** (solo lectura primero). Las consultas están en `03-ingeniero-plan.md` §10:
   - costos y mínimos borrados (huella: `min_stock IS NULL AND optimum_stock IS NULL`);
   - stock revertido por `MANUAL_ADJUSTMENT` sin `reference_id`;
   - productos sobrescritos;
   - ventas con líneas a $0;
   - turnos abiertos sin sucursal.

   La reparación sale de un respaldo o PITR de Supabase. La hace el dueño.

### P1
4. **Re-prueba de la vendedora simulada sobre la versión nueva:** se cortó por el límite de uso. Repetirla y escribir `06-vendedor-reprueba.md`.
5. **Informe de QA (`02-qa.md`):** no llegó a escribirse. Sus scripts están en el sandbox de esa sesión (`scratchpad/qa/`), que no persiste. Rehacer la verificación sobre la rama nueva.
6. **Aplicar la migración M1** en producción:
   - Antes, la consulta del encabezado tiene que devolver 0 filas; si hay turnos huérfanos, se cierran o se asignan primero.
   - Después hay que commitearla en OlivoWeb.
   - En OlivoWeb, mostrar "Ya hay una caja abierta" cuando la base responda 23505.
7. **Decisiones del dueño:**
   - ¿Las vendedoras pueden cambiar precios? Hoy sí, y queda auditado; OlivoWeb no se lo permite al cajero.
   - ¿Hace falta un "precio solo para esta venta" (descuento puntual)?
   - ¿Se confirman las reglas por defecto? Costo solo para ADMIN; anular según la regla de 30 min; sin PIN; sin stock negativo.
   - ¿Se sigue cerrando la caja "declarada"?

### P2: quedó fuera
- Recepción: costo por línea con precio sugerido por margen (plan 2.4).
- Anular un movimiento de caja (movimiento compensatorio).
- Rechazar un movimiento a un turno ya cerrado en vivo; aceptarlo en el reintento.
- "Anotar fiado" durante el día: cambia `registrar_cierre`, hay que coordinarlo con OlivoWeb.
- Conteo de una sola góndola ("solo aplica lo escaneado"). La vendedora lo pidió en la fase 2: hoy cerrar un conteo deja en 0 todo lo no contado.
- Pendientes offline visibles con su error y "Reintentar".
- Errores en español: un mapa de los códigos 23505, 23514 y PGRST.
- Foto con la cámara, cambiar el código de barras (`rename_product_barcode`) y oferta con fecha de término.
- Stock negativo (M3) y anulación exacta: hoy, anular la venta de un producto que estaba sin stock crea stock fantasma, y la app solo lo avisa.
- Consolidar las 3 sobrecargas de `apply_sale` y generar los tipos de Supabase.
- Detector del láser: si alguien tipea un número y escanea en menos de 50 ms, se unen. Es raro.

## Cómo levantar el sandbox (para probar sin tocar producción)

Esto se armó dentro de la sesión y **no está en el repo**. Para recrearlo:
1. **Esquema:** con Supabase (solo lectura) volcar el DDL de `public` con `pg_get_functiondef`, `pg_get_viewdef`, `pg_get_triggerdef`, columnas, constraints e índices, y cargarlo en un Postgres 16 local. Antes hay que crear los esquemas `extensions` (pgcrypto, uuid-ossp, pg_trgm, citext) y `auth` (con stubs de `uid`, `jwt` y `role`), y los roles `anon`, `authenticated`, `service_role` y `authenticator`.
2. **Datos:** una muestra del catálogo (productos y categorías), usuarios de prueba con hash bcrypt (roles ADMIN y SELLER) y `sellers` con los nombres reales.
3. **Servicios:** PostgREST 12 (binario estático) con un `jwt-secret`, más un proxy Node que mapea `/rest/v1` a PostgREST y simula `/storage/v1`.
4. **App:** `.env.local` con `NEXT_PUBLIC_SUPABASE_URL=http://localhost:<proxy>` y JWT `service_role` firmados con ese secreto. Después `npx next dev`.
5. **Pruebas:** Playwright con `devices['Pixel 7']`. El láser se simula con `page.keyboard.type(codigo, {delay: 8})` + Enter.

## Archivos clave nuevos

| Archivo | Para qué |
|---|---|
| `src/components/scanner/ScanProvider.tsx` + `src/lib/scan/detector.ts` | Láser |
| `src/lib/pos/cobro.ts` | Cobro |
| `src/lib/pos/cartStorage.ts` | Carrito persistente |
| `src/lib/pos/precios.ts` | Precio del servidor |
| `src/lib/num.ts` + `src/components/ui/MoneyInput.tsx` | Montos en pesos |
| `src/hooks/useAttendant.tsx` + `src/components/operaciones/AttendantChip.tsx` | Quién atiende |
| `src/components/operaciones/PriceSheet.tsx` | Precio en el momento |
| `src/server/anulacion.service.ts`, `src/server/comprasPropias.service.ts`, `src/components/operaciones/caja/*` | Caja |
| `src/server/productos.service.ts`, `src/app/api/products/[barcode]`, `src/lib/products/*` | Productos |
