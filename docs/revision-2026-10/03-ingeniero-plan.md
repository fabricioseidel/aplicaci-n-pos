# Plan de implementación: Olivo POS (agente ingeniero)

**Fecha:** 01-10-2026 · **Repo:** `/home/user/aplicaci-n-pos` (main = `17ca6b7`, PR #8 incluido) · **Esquema:** OlivoWeb `a7c952d` (#110).
**Insumos:** `01-vendedor.md` (completo) y lectura del código de los dos repos. También probé hipótesis en una base aparte del sandbox (`olivo_ing`, restaurada del mismo volcado; la base `olivo` de QA no la toqué). Cuando cerré este plan, `02-qa.md` **todavía no existía**. Los puntos marcados **[QA]** dependen de que QA los confirme, sobre todo lo que tiene que ver con daño en producción.

Tamaños: **S** = medio día o menos · **M** = 1 a 2 días · **L** = 3 a 5 días. No implementé nada ni hice commits.

---

## 0. Resumen

| Fase | Qué resuelve | Ítems | Tamaño total |
|---|---|---|---|
| **1 (P0)** | Lo que hoy pierde plata o datos, o impide vender | 1.0 hotfix de productos · 1.1 edición sin pisar · 1.2 láser en Venta · 1.3 caja sin sucursal / doble turno · 1.4 montos "3.500" · 1.5 venta a $0 · 1.6 monto a pagar · 1.7 carrito y recepción persistentes · 1.8 Caja→Turno mal calculado · 1.9 dueño de compras propias · 1.10 hora real de la venta offline · 1.11 vitest + tests + CI | ~2 semanas de una persona |
| **2 (P1)** | Fricción diaria y **edición de productos** (prioridad del dueño) | ¿Quién atiende? + cerrar sesión · ficha nueva · lista de precios · editar desde venta y recepción · precios validados en el servidor · venta con botones grandes · cierre que compara · anular venta · fiados sin duplicados · pendientes visibles · errores en español | ~3 semanas |
| **3** | Mejoras y decisiones de negocio | conteo de góndola · stock negativo · PIN · foto con cámara · cambiar código · oferta con fecha · referencia de transferencia · redondeo Ley 20.956 · fiado en la venta · consolidar `apply_sale` | a demanda |

**Lo primero, hoy mismo:** el ítem **1.0** (unas 20 líneas en el servidor) frena el daño que sigue ocurriendo en producción. Cada vez que alguien guarda un producto desde el POS, se borran el costo y los mínimos, y el stock puede volver a un valor viejo.

---

## 1. Hechos verificados que condicionan el diseño

Todos los verifiqué en el código o en `olivo_ing`, no los supuse.

1. **`products.stock` es derivado.** Lo recalcula el trigger `products_stock_derivado` (`BEFORE INSERT OR UPDATE OF stock`). Un `UPDATE` que no menciona `stock` no lo toca. *Prueba:* `update products set sale_price=1100` deja intactos stock, costo y mínimos.
2. **`products.purchase_price` es derivado solo si el producto tiene proveedor con costo** (trigger `products_purchase_price_derivado`, migración `20260828000400`). Si lo tiene, cualquier valor que escriba el POS se reemplaza en silencio por el costo del proveedor. Si no lo tiene, lo que se escribe queda. Consecuencias:
   - El borrado del costo (#1) solo afectó a productos **sin** proveedor, que según esa misma migración son "buena parte del catálogo".
   - El POS solo debe ofrecer editar el costo en productos sin proveedor.
   - `purchase_price` es **neto** (571,43 × 1,19 = $680).
3. **Un `INSERT` sin `is_active` crea el producto INACTIVO** (el default de la columna es `false`). Lo probé: `insert (barcode,name,sale_price)` → `is_active = f`. Por eso cualquier alta parcial tiene que mandar `is_active: true`.
4. **Un upsert de PostgREST con columnas parciales** (`ON CONFLICT DO UPDATE SET` solo con las columnas enviadas) **conserva el resto.** El daño viene de que el POS manda **todas** las columnas con 0 o `null` por defecto (`src/services/products.ts:60-79`).
5. **`apply_sale` recorta el stock en 0** (`GREATEST(0, stock - v_qty)`, es decir, nunca negativo) y además registra `OUT` por la cantidad completa. **`anular_venta` devuelve la cantidad completa.** *Prueba:* producto con stock 0, se venden 1,2 kg, se anula la venta → el stock queda en **1,2** (stock fantasma). Esto condiciona "Anular venta" (2.8) y el #29.
6. **`sale_payments.amount > 0`** (CHECK). Una venta con total $0 no se puede registrar con el `apply_sale` actual: falla siempre, también en reintentos.
7. **`apply_sale` acepta cualquier `unit_price`.** *Prueba:* 10 Cocas a $1 → venta registrada. **No hay validación de precios en el servidor del POS.** OlivoWeb sí la tiene (`src/lib/pos/precios-venta.ts`, #110).
8. **Una cantidad negativa la rechaza el CHECK de `inventory_movements`** (no se pierde stock), pero el error llega crudo.
9. **`apply_sale` respeta `p_timestamp`.** El POS no lo manda, así que una venta hecha sin red queda con la **hora en que se sincronizó**.
10. **`sales.client_sale_id` tiene índice UNIQUE**, de modo que la idempotencia aguanta la concurrencia. **No hay** restricción que impida dos turnos `OPEN` en la misma sucursal. *Prueba:* un índice parcial único lo impide, aunque no cubre `branch_id NULL` si no se usa una expresión.
11. **`registrar_cierre` es un cierre "declarado"** (`difference = 0` a propósito, `CloseMode.tsx` lo documenta). `pos_totals` se guarda para conciliar. Mostrar la comparación con el POS es solo informativo y no cambia el RPC.
12. **El APK carga el sitio en vivo**, así que todos los teléfonos toman el código nuevo al recargar. Pero **una pestaña ya abierta sigue con el JS viejo** hasta que se recargue. Las guardas tienen que estar **en el servidor**, no solo en la UI.
13. **El outbox se reenvía con el código ACTUAL** de `SyncContext` y con la **sesión actual**. Si se agrega una cabecera de reintento, la reciben también las ventas encoladas por versiones anteriores. Y si cambia la sesión, una venta encolada se atribuye a la nueva sesión, salvo que el payload diga quién atendió.
14. **`sellers`:** `name` es UNIQUE, `user_id` es opcional y existe `active`. `cash_shifts.seller_id` ya existe (FK a `sellers`). `stock_count`, `apply_stock_absolute` y `close_stock_count` ya reciben `p_counted_by` / `p_closed_by` como texto.
15. **Chromium:** un `preventDefault()` del Enter, incluso en un listener de `window`, evita que el botón con foco se "presione". Sin él, el lector produce un segundo clic. *Prueba:* 2 clics sin `preventDefault`, 1 con. `type=number` con "30.000" da `valueAsNumber = 30`.
16. **OlivoWeb trata el stock ≤ 0 como agotado** en todas las vistas, y `decrement_stock_atomic` (venta web) se niega a vender si no alcanza. Un stock negativo en el local no rompe la web.

---

## 2. Principios de diseño (para la vendedora)

- **Escanear siempre funciona sin tocar nada**: en Venta agrega, en Productos abre la ficha, en Recepción suma. El Enter del lector nunca "presiona" otra cosa.
- **Nada se pierde**: el carrito y la lista de recepción se guardan en el teléfono. Una venta sin red se encola con su hora real y con quién atendió. Una sesión vencida no hace perder una venta.
- **Un toque para lo común**: Tarjeta y Transferencia cobran el total exacto con un toque, y el efectivo trae billetes grandes. Al cambiar el carrito, el monto propuesto sigue al total mientras no se haya escrito a mano.
- **A prueba de errores**: "3.500" o "3500" significan lo mismo; si un precio cambia más del 50 %, se pide confirmar; no se puede vender a $0 (se pide el precio ahí mismo); vaciar el carrito se puede deshacer.
- **Guardar solo lo que se tocó** (PATCH parcial). El stock nunca se reenvía desde una ficha.
- **Botones de 48 px o más** y letra de 12 px o más en los controles del mostrador.

---

## 3. Fase 1: P0 (pierde plata o datos, o bloquea vender)

### 1.0 Hotfix en el servidor: que guardar un producto no borre nada (S) ⚑ hoy

- **Causa raíz:** `src/services/products.ts:60-79` (`buildProductPayload`) rellena `purchase_price: 0` (l.65), `stock: 0` (l.67), `description: null` (l.70), `min_stock: null` (l.76) y `optimum_stock: null` (l.77). `ProductosMode.tsx:116-127` envía además `stock` con el valor viejo de la pantalla (l.122). `src/app/api/products/route.ts:131-165` aplica ese stock como **ajuste absoluto** (`applyCount`, `MANUAL_ADJUSTMENT`, sin `opId`). Con eso revierte las ventas o recepciones que pasaron mientras la ficha estaba abierta. Después hace un upsert `onConflict: "barcode"` (l.59) que también pisa productos existentes.
- **Solución** (solo servidor, `POST /api/products`): antes del upsert, normalizar cada ítem:
  - Quitar `stock` del payload siempre. La UI nueva usa "Ajustar stock" (2.2). La ruta deja de llamar a `applyCount`.
  - Quitar `purchase_price` si no es > 0. Quitar `min_stock`, `optimum_stock`, `description`, `measurement_value`, `image_url`, `category` y `offer_price` cuando vengan `null` o vacíos. Mientras quede el formulario viejo no se podrá "borrar" una oferta o una categoría, pero eso es mucho mejor que el borrado masivo de hoy.
  - Si el producto no existe y no viene `is_active`, forzar `is_active: true` (ver hecho 3).
- **Riesgos:** ninguno para OlivoWeb (no usa esta ruta). Si una pestaña vieja intenta poner el stock a mano, ya no lo logra. Es el comportamiento deseado.
- **Verificación:**
  - Test de ruta (vitest, `supabaseServer` simulado): el payload del formulario viejo produce un upsert sin `stock`, sin `purchase_price` ni mínimos, y sin llamar a `apply_stock_absolute`.
  - En el sandbox: repetir el #1 de la vendedora (Coca, 1000 → 1100) y comprobar con `select purchase_price,min_stock,optimum_stock from products where barcode='7801610001196'` que quedan 571,43 / 5 / 20, y que no aparece ningún movimiento `MANUAL_ADJUSTMENT`.

### 1.1 Edición de productos con PATCH parcial y altas que no pisan (M)

- **Causa raíz:**
  - `ProductosMode.tsx:17-28` no tiene costo ni mínimos en el formulario, pero `saveProduct` los manda (ver 1.0).
  - `ProductosMode.tsx:79-82` usa "Nuevo" con el texto buscado como código y hace upsert. Sobre un código existente e inactivo, **lo sobrescribe** (#14: Pepsi Zero perdió categoría, foto y costo).
  - `QuickCreateReceptionModal.tsx:89-94` crea con `sale_price: 0` y `stock: 0`. Si el código ya existía inactivo, **pone su stock en 0** y lo renombra. Esto no estaba en el informe de la vendedora; QA lo está probando en `t08`.
  - `QuickCreateProductModal.tsx:52-60` hace lo mismo con `stock: 1`.
- **Solución:**
  - **Rutas nuevas:**
    - `PATCH /api/products/[barcode]`, cuerpo `{ changes, expected }`.
      - `changes` se valida con zod `.strict()` sobre una lista blanca: `name`, `category`, `sale_price` (entero ≥ 1), `offer_price` (`null` o entero ≥ 1), `purchase_price` (≥ 0, solo ADMIN, ver 2.2), `min_stock`, `optimum_stock`, `by_weight`, `measurement_unit`, `image_url`, `is_active` y `description`. **`stock` está prohibido** (si llega, 400).
      - `expected` lleva los valores originales de los campos que cambian: `.update(changes).eq('barcode', b)` más `.eq(campo, valorOriginal)` por cada campo. Si no se actualiza ninguna fila y el producto existe, responde **409** con la fila actual ("Alguien cambió el precio a $1.200 mientras editabas. ¿Aplicar igual?"). No se usa `updated_at` porque cada venta lo cambia por el trigger de stock y daría conflictos falsos todo el tiempo.
      - Devuelve la fila con `.select(PRODUCT_COLUMNS)`, es decir, los valores reales después de los triggers.
    - `POST /api/products` con `{ crear: true }` hace un **`insert`** (no upsert) con `is_active: true`. Si el código ya existe (`23505`), responde 409 `{ existente }` y la UI ofrece "Ese código ya es **Pepsi Zero 3L** (desactivado): Abrir ficha · Reactivar".
    - La rama de upsert anterior queda una versión (con la guarda de 1.0) para pestañas viejas y después se borra.
  - **Cliente:**
    - `src/lib/products/patch.ts`: función pura `diffProduct(original, form)` que devuelve `{changes, expected}` y nunca incluye `stock`.
    - `saveProduct` se divide en `createProduct()` y `patchProduct()`.
    - Al abrir una ficha se pide la fila fresca y sin redondear a `GET /api/inventario/buscar?barcode=` (que también trae los inactivos). `mapSupaToUI` redondea `price` (por eso "3,5" se veía como "$4") y eso rompería el `expected`.
    - Sin red, la ficha se muestra en modo lectura.
    - Después de guardar: `upsertLocal()` y además actualizar esa fila del `productsCache` de IndexedDB (función nueva `cacheProduct()`). Hoy solo se actualiza la memoria.
    - Las dos creaciones rápidas, antes de crear, consultan `/api/inventario/buscar?barcode=`. Si el producto existe inactivo, ofrecen "Reactivar" (PATCH `is_active: true`) en vez de crearlo. Creación desde Venta: sin campo de stock (el stock se maneja en Recepción y Conteo). Creación desde Recepción: pide **precio** (ver 1.5) y no manda stock al crear; el stock entra por la recepción misma.
- **Riesgos:**
  - Conflictos por igualdad en `double precision`: el valor de `expected` viene de la misma base, así que la comparación es exacta.
  - Otras apps: OlivoWeb no se ve afectado.
  - Cola offline: la edición de productos sigue fuera del outbox, como ya está decidido en `ProductosMode.tsx:113-115`.
- **Verificación:**
  - Unit: `diffProduct` (solo cambia `sale_price` → `{sale_price}`; nunca `stock`; poner la oferta en `null` cuando había oferta → `{offer_price:null}`).
  - Ruta: PATCH con `stock` → 400; dos PATCH en carrera sobre el mismo campo → el segundo recibe 409.
  - Sandbox:
    - El caso de la vendedora con la Pepsi lata: abrir la ficha con stock 17, vender 2 desde otro equipo, guardar el precio → stock 15 y sin `MANUAL_ADJUSTMENT`.
    - "Nuevo" con 805026003505 → 409 con la oferta de reactivar.
    - Creación rápida en Recepción sobre un código inactivo con stock → no se toca el stock.

### 1.2 Láser en Venta: sin tocar nada, y que nunca cobre el producto anterior (M)

- **Causa raíz:**
  - `SaleMode.tsx` no usa `useLaserScanner`. El láser solo funciona dentro del modal de cámara (`SaleMode.tsx:632-656`), que se cierra después de cada lectura (l.645).
  - Las tarjetas de producto (`SaleMode.tsx:309-312`) quedan con el foco después del toque. El Enter del lector las "presiona" (#2c, confirmado en Chromium).
  - El buscador (`SaleMode.tsx:255-263`) tiene `data-laser-passthrough`, pero en Venta no hay un listener que lo aproveche, así que Enter no hace nada (#2b).
  - `useLaserScanner.ts:69` escucha en la fase de burbuja y con un intervalo de 35 ms (l.30), que es justo para algunos lectores Bluetooth en Android.
- **Solución:**
  - `src/lib/scan/detector.ts`: detector puro `createScanDetector({minLength:4, maxGapMs:50})`, para poder testearlo. `useLaserScanner` pasa a usarlo con `capture: true`.
  - Si termina una ráfaga con Enter: **`preventDefault()` + `stopPropagation()` del Enter siempre**, y `onDetected(code, { target })`.
  - Si el foco estaba en un input con `data-laser-passthrough`, la pantalla recibe `target` y borra del texto el código escaneado. En Venta: `setSearchQuery("")`.
  - **SaleMode** monta `useLaserScanner` con `enabled = !showScanner && !weighing && quickCreateBarcode===null && !priceSheet`, para que no haya doble listener con el modal de cámara, que ya trae el suyo. Al detectar un código:
    1. Si está en el catálogo, `pickProduct` (también desde la vista de carrito, sin salir de ella).
    2. Si no está, consulta `/api/inventario/buscar?barcode=` (inactivos): "Está desactivado: ¿Reactivar y vender?".
    3. Si tampoco aparece ahí, abre la creación rápida.
  - **Enter en el buscador** con un texto que es todo dígitos (6 o más): búsqueda exacta por código. Esto cubre lectores lentos y el tipeo manual de un código.
  - Las tarjetas hacen `blur()` después del toque (`onPointerUp`), como segunda línea de defensa.
  - Cámara en **modo continuo** (opcional en el modal): no se cierra con cada lectura. Tiene anti-rebote de 1,5 s por código y un botón grande "Listo". Esto puede quedar en 2.6.
- **Riesgos:**
  - Dos listeners a la vez (Venta + `UnifiedScanner`): se evitan con la condición `enabled`.
  - Que alguien tipee muy rápido en el buscador y se tome como escaneo: se mitiga con `minLength` y con exigir el Enter.
  - Ninguno para el outbox.
- **Verificación:**
  - Unit: el detector (ráfaga + Enter → código; tipeo lento → nada; Enter sin ráfaga → no se cancela).
  - jsdom: el hook cancela el Enter sobre un `<button>` con foco.
  - Sandbox (Playwright): reproducir exactamente el #2:
    - (a) Sin foco, escanear la Coca → 1 Coca en el carrito.
    - (b) Con foco en el buscador → se agrega y el buscador queda vacío.
    - (c) Tocar la tarjeta de la Coca y escanear la Pepsi → el carrito queda con Coca 1 y Pepsi 1, y `sale_items` lo confirma.

### 1.3 La caja no se abre sin sucursal ni dos veces, y no "desaparece" (M)

- **Causa raíz:**
  - `Providers.tsx:21` monta `BranchProvider` en el layout raíz. `BranchContext.tsx:59` pide `/api/branches` **una sola vez** al montar (efecto en l.84). En `/login` esa petición da 401 y no queda nada en caché.
  - `LoginForm.tsx:42-43` navega con `router.refresh()` + `router.replace()`, lo que **no remonta** el provider, así que `currentBranch` queda en `null`.
  - Después, `useOpenShift.ts:38` consulta `/api/caja/estado` sin sucursal (`estado/route.ts:31` devuelve cualquier turno abierto). `CajaMode` abre con `branchId: null`, y `caja/shifts/route.ts:43,54` busca cualquier turno e inserta `branch_id NULL`.
  - Al recargar, la sucursal "Principal" ya está y no tiene turno, así que se abre un segundo turno. Las ventas del primero no salen en el cierre de Principal.
  - Además no hay restricción en la base contra dos turnos abiertos (hecho 10). QA prueba la carrera de tres aperturas simultáneas en `t02`.
- **Solución:**
  - `LoginForm`: después de `signIn` correcto, `window.location.replace(callbackUrl)` (navegación completa que remonta todos los providers).
  - `BranchContext`: depender de `useSession().status`. Cuando pasa a `authenticated` y no hay lista, reintentar. Exponer `isLoading` real.
  - `CajaMode`: "Abrir turno" queda deshabilitado mientras `!currentBranch`, con el texto "Cargando sucursal…" y un botón Reintentar.
  - **Servidor:** `resolveBranchId(bodyBranchId)` en `branches.service.ts` devuelve el id si es una sucursal activa y, si no, la sucursal `is_default`. Si no hay ninguna, 409 legible. Se usa en `POST/GET /api/caja/shifts`, `GET /api/caja/estado` y `POST /api/sales` (cuando no viene `shiftId`). **Nunca más se inserta un turno con `branch_id NULL`** desde el POS.
  - **Migración M1** (sección 8): índice único parcial "un turno abierto por sucursal", con una expresión `COALESCE` para que los `NULL` también choquen. `POST /api/caja/shifts` captura el `23505` y devuelve el turno existente (`alreadyOpen`).
  - **Reparación de datos [QA]:** listar `select id, started_at, starting_cash, (select count(*) from sales s where s.shift_id=c.id) ventas from cash_shifts c where status='OPEN' and branch_id is null`. Para cada uno, si sus ventas son del local (`sales.branch_id` = Principal), `update cash_shifts set branch_id=<Principal>`. Si ya hay otro turno abierto en Principal, primero hay que cerrar o declarar uno de los dos. Decide el dueño.
- **Riesgos:**
  - M1 afecta a OlivoWeb: `openShiftAction` no revisa si ya hay un turno abierto, así que con el índice un doble apertura allá recibe un `23505` crudo. Es correcto que falle, pero hay que pedir en OlivoWeb que muestre "Ya hay una caja abierta en esta sucursal".
  - El cron `auto-close-shifts` no se ve afectado.
  - Ventas encoladas con `shiftId` del turno huérfano: siguen entrando a ese turno, porque el `shiftId` se respeta.
- **Verificación:**
  - Ruta: `POST /api/caja/shifts` sin `branchId` → el turno queda con la sucursal por defecto; dos POST en paralelo → un solo turno (con M1 aplicada en el sandbox).
  - Sandbox (Playwright, contexto limpio sin localStorage): login → abrir caja con $30.000 → recargar → la caja sigue abierta; `select count(*) from cash_shifts where status='OPEN'` = 1 y `branch_id` no nulo.

### 1.4 Montos: "3.500" y "30.000" significan lo que dicen (M)

- **Causa raíz:** 15 inputs `type="number"`. En es-CL el punto se toma como decimal: "3.500" → 3,5 y "30.000" → 30 (verificado en Chromium). Están en `ProductosMode` (4), `CajaMode.tsx:179-187` y el de movimientos, `SaleMode.tsx:542-551`, las creaciones rápidas, `WeightPrompt.tsx:42` y `cierre/campos.tsx:31-45` (`Monto`, usado en todo el cierre), entre otros. `mapSupaToUI` redondea, y por eso $3,5 se veía como "$ 4" sin ningún aviso.
- **Solución:**
  - `src/lib/num.ts`:
    - `parseCLP(texto)`: quita `$`, espacios y puntos; acepta coma decimal y redondea a entero; si no hay número, `null`.
    - `formatCLP(n)`.
    - `parseGramos(texto)`: si trae separador decimal y es < 50, se interpreta como **kg** (0,35 → 350 g) y se muestra "= 350 g" (#20).
  - Componentes:
    - `MoneyInput`: `type="text"` `inputMode="numeric"`, formatea en vivo ("30.000"), selecciona todo al enfocar (#25: "1003000000") y entrega `number|null`.
    - `QtyInput`.
    - Los 15 inputs pasan a usarlos.
  - **Guarda de cordura en precios:** un precio nuevo menor que el 50 % o mayor que el doble del anterior, o menor que $50, pide confirmar mostrando los dos valores en grande ("Antes $3.500 → Ahora $4. ¿Seguro?").
  - **Abrir caja:** ya no viene 10000 escrito (`CajaMode.tsx:43`). Se propone el efectivo que quedó en el cierre anterior (`actual_cash` del último cierre de la sucursal), hay atajos $10k/$20k/$30k/$50k y, al abrir, se vuelve sola a Venta.
- **Riesgos:** el teclado numérico de Android con `inputMode="numeric"` no tiene coma, lo cual sirve para pesos enteros. El costo se escribe con IVA y como entero (ver 2.2). Ninguno para el outbox.
- **Verificación:**
  - Unit: `parseCLP` ("3.500"→3500, "$ 1.990"→1990, "30.000"→30000, "1990,6"→1991, ""→null, "abc"→null) y `parseGramos` ("0.35"→350, "0,35"→350, "350"→350, "1200"→1200).
  - Sandbox: precio "3.500" → `sale_price=3500`; abrir caja con "30.000" → `starting_cash=30000`.

### 1.5 No se puede vender a $0 (y Recepción no crea productos a $0) (S)

- **Causa raíz:**
  - `SaleMode.tsx:128-135` (`pickProduct`) agrega cualquier precio.
  - `sales/route.ts:60-65` solo valida `total >= 0`.
  - Con otro producto en el carrito, la venta pasa con la línea a $0 (#8, venta #12). Sola, falla con el CHECK crudo (hecho 6).
  - Origen del $0: `QuickCreateReceptionModal.tsx:92`.
- **Solución:**
  - **Cliente:** si `unitPriceOf(p) <= 0`, se abre `PriceSheet` ("Este producto no tiene precio") con `MoneyInput`, se hace PATCH `sale_price` (1.1) y recién ahí se agrega al carrito.
  - **Servidor:** en una venta **en vivo**, cualquier ítem con `unit_price <= 0`, `subtotal <= 0` o `qty <= 0` responde 400 "El producto X no tiene precio…". Eso cubre también la cantidad negativa (hecho 8).
  - **Reintentos del outbox** (cabecera `X-Olivo-Replay: 1` que agrega `SyncContext`): se aceptan líneas a $0 si el total es > 0 (la venta ocurrió y el producto salió de la tienda) y se agrega a `notes` "línea sin precio". Una venta encolada con total $0 no puede entrar (hecho 6): responde 422 con un mensaje claro y queda visible en "Pendientes" (2.10) para resolverla a mano.
  - **Recepción:** la creación rápida pide precio. Si se deja vacío, el producto queda marcado y la venta lo pide con `PriceSheet`.
- **Riesgos:** una venta encolada por una versión anterior con línea a $0 no se rechaza. La cabecera de reintento la agrega el código nuevo, y las pestañas viejas se actualizan al recargar.
- **Verificación:**
  - Ruta: venta en vivo con una línea a $0 → 400 legible; la misma con `X-Olivo-Replay` → 200 y la nota.
  - Sandbox: escanear la Oreo a $0 → se pide el precio → venta con `unit_price` correcto.

### 1.6 El monto a pagar sigue al total; Tarjeta y Transferencia en un toque; sin vuelto fantasma (S)

- **Causa raíz:**
  - `SaleMode.tsx:118-122` rellena el monto solo si es `=== 0`, así que se queda en el precio del primer producto (#5).
  - Con compra propia, el monto queda sin el descuento, lo que produce el "VUELTO $275" fantasma (riesgo real de dar un vuelto que no corresponde).
  - "Exacto" y los billetes solo existen con efectivo (`SaleMode.tsx:573-591`); no hay $20k.
- **Solución:**
  - `src/lib/pos/cobro.ts`: reductor puro. Cada fila es `{method, amount, auto}`.
    - Mientras `auto=true`, `amount` sigue el saldo pendiente de esa fila. Escribir a mano o tocar un billete pone `auto=false`; "Exacto" vuelve a `auto=true`.
    - Una fila de tarjeta o transferencia no puede superar el saldo (aviso "La tarjeta no puede ser mayor que el total").
    - El vuelto sale solo del efectivo.
    - `computeCobro(total, filas)` devuelve `{pagado, falta, vuelto, ok, motivo}`.
  - UI:
    - Tres botones grandes: **Efectivo / Tarjeta / Transf.** Tarjeta y Transf. dejan el monto exacto, así que basta un toque y Confirmar.
    - Billetes **Exacto, $1k, $2k, $5k, $10k, $20k** de 48 px.
    - "Pago mixto" abre las filas.
    - Confirmar dice el motivo cuando está deshabilitado ("Falta $2.000").
    - Efectivo mayor que el total + $20.000 pide confirmar ("¿Recibiste $200.000?", #19).
- **Riesgos:** ninguno para el servidor ni el outbox; el payload no cambia.
- **Verificación:**
  - Unit `cobro.ts`: agregar productos actualiza el monto automático; compra propia sin vuelto fantasma; tarjeta tope; mixto $5.000 efectivo + resto tarjeta.
  - Sandbox: venta de 3 Cocas → Confirmar habilitado sin tocar el monto.

### 1.7 El carrito y la recepción no se pierden (S/M)

- **Causa raíz:**
  - `OperacionesApp.tsx:144-146` monta `<POSProvider>` **dentro** de `mode==="VENTA"`. Cambiar de pestaña lo desmonta y el estado (`POSContext.tsx:41`) muere (#6).
  - La lista de recepción (`useQuickInventory`) vive solo en memoria.
  - El Conteo ya resolvió esto con `localStorage`.
- **Solución:**
  - `POSProvider` sube a envolver todo `OperacionesApp`, siempre montado.
  - El estado del carrito, incluidos `compraPropia` y `comprador`, se persiste en `localStorage` `pos.cart.v1` = `{branchId, items, compraPropia, compradorId, savedAt}`.
  - Al montar, se restaura con el aviso "Seguimos con la venta en curso (3 productos)" y un botón "Empezar de cero". Si tiene más de 12 h, se pregunta antes.
  - Cuando llega el catálogo fresco, se refrescan los precios de las líneas por código y se avisa si alguno cambió.
  - `useQuickInventory` persiste `pos.reception.v1` de la misma forma.
  - El carrito se borra al confirmar, al cerrar sesión (2.1) y con "Empezar de cero".
  - Las otras pestañas **no** se dejan montadas: la cámara de Recepción seguiría encendida.
- **Riesgos:**
  - `localStorage` lleno o bloqueado: try/catch, y se sigue en memoria.
  - Dos personas en el mismo teléfono comparten el carrito en curso. Es lo esperado: es el mostrador.
- **Verificación:**
  - Unit: serializar y restaurar, con refresco de precio.
  - Sandbox: 2 productos → pestaña Productos → volver (siguen); recargar (siguen); en Recepción, 12 Cocas → Caja → volver (siguen).

### 1.8 Caja → Turno: efectivo y esperado bien calculados (S)

- **Causa raíz:**
  - `CajaMode.tsx:85-87` suma `sales.total` cuando `payment_method` es efectivo. Una venta mixta cuenta entera como efectivo (+$3.070 de más, #7).
  - `CajaMode.tsx:95` suma el STAFF_CREDIT (por cobrar) en "Total ventas".
  - `api/caja/route.ts:31` no trae `voided`, así que las anuladas desde OlivoWeb (#110) también suman.
- **Solución:**
  - `/api/caja` agrega `voided` y `seller_name`.
  - Función pura `resumenTurno({inicio, ventas, movimientos})`:
    - efectivo = suma de `sale_payments` CASH de las ventas no anuladas;
    - tarjeta y transferencia por separado;
    - "Por cobrar (personal)" aparte, fuera de "Total ventas";
    - esperado = inicio + efectivo + ingresos CASH − egresos CASH.
  - Es la misma regla de `close_shift` y `registrar_cierre`.
- **Verificación:** unit `resumenTurno` con el caso de la vendedora: venta #6 mixta 5000 + 3070 → efectivo 13.525 y esperado 43.525 antes de movimientos.

### 1.9 Asignar dueño a las compras propias sin empleado (S)

- **Contexto:** PR #8 ya obliga a elegir el dueño (no se toca). Quedan **4 pendientes en producción (257, 258, 260, 261) [QA: confirmar que tienen `seller_id IS NULL` y `staff_settled_at IS NULL`]**. La liquidación de OlivoWeb (`/api/admin/compras-personal`) agrupa por `seller_id || seller_name`, así que hoy esas cuatro salen como "Sin vendedor".
- **Solución sin cambio de esquema:**
  - `GET /api/compras-propias/sin-dueno`: devuelve las ventas con `is_staff_purchase AND NOT voided AND staff_settled_at IS NULL AND seller_id IS NULL`, con sus ítems (más las cuyo `seller_id` sea una "cuenta" filtrada por `useStaff`, como `ADMIN…` **[QA]**).
  - `POST /api/compras-propias/asignar {saleId, sellerId}`:
    - Hace un update condicional: `.eq('id').eq('is_staff_purchase',true).eq('voided',false).is('staff_settled_at',null).is('seller_id',null)` → `seller_id` y `seller_name` del empleado, y agrega a `notes` "Dueño asignado 01-10 (atendía: X)".
    - Si no actualiza ninguna fila, 409 "Ya tiene dueño o ya se liquidó". Si se asigna dos veces el mismo dueño, responde ok (idempotente).
  - **UI:** en Caja → Turno, una tarjeta ámbar "4 compras propias sin dueño". Tocar una muestra fecha, total y productos, luego nombres grandes (`useStaff`) y "Asignar $1.125 a Mariana" → listo.
- **Decisión del dueño:** propongo que cualquier persona del personal pueda asignar una compra **sin dueño** (queda anotado quién atendía) y que solo un ADMIN pueda **cambiar** un dueño ya asignado (fase 3, si hace falta).
- **Riesgos:** ninguno para OlivoWeb. La asignación pasa a verse en su liquidación.
- **Verificación:**
  - Ruta: asignar → 200; repetir con otro dueño → 409; venta liquidada → 409.
  - Sandbox: crear una compra propia con `seller_id NULL` (insert directo) → asignarla desde la UI → `select seller_id, seller_name from sales where id=…`.

### 1.10 Una venta hecha sin red guarda su hora real y no se pierde si la sesión venció (S)

- **Causa raíz:**
  - `sales.service.ts` no manda `p_timestamp`, así que `sales.ts` queda con la hora de sincronización (hecho 9; QA lo prueba en `t07`). Una venta de las 23:50 sincronizada al día siguiente sale en los reportes del día siguiente.
  - `apiWrite.ts:83-91`: un 401 en vivo devuelve error **sin encolar**, y la venta se pierde.
  - `SyncContext.tsx:89`: un 401 al drenar cuenta como intento fallido; después de 10 queda trabada.
- **Solución:**
  - El payload de la venta lleva `soldAt` (ISO del cliente). El servidor lo pasa como `p_timestamp` si no está en el futuro (+5 min) ni es más viejo que 7 días; si no, usa `now()` y lo anota. Las ventas encoladas antes no lo traen y quedan como hoy.
  - `apiWrite`: con 401 y `kind==="sale"`, **encolar** y avisar "Tu sesión venció: vuelve a entrar. La venta quedó guardada".
  - `SyncContext`: con 401 o 403, cortar el drenaje sin sumar intentos y exponer `needsLogin` para mostrar un aviso con botón "Entrar".
- **Verificación:**
  - Unit (fetch simulado + `fake-indexeddb`): 401 → encola; drenaje con 401 → `attempts` no sube.
  - Sandbox: venta offline, esperar y volver la red → `sales.ts` = hora de la venta.

### 1.11 vitest, tests mínimos y CI (M)

Ver la sección 9. En la fase 1 entran la infraestructura, los tests de los ítems 1.0 a 1.10 y los cuatro de `docs/PLAN.md §3`. Agrego un workflow `ci.yml` con `typecheck`, `lint` y `vitest run` (los tests unitarios) en cada PR.

---

## 4. Fase 2: P1 (fricción diaria y edición de productos)

### 2.1 "¿Quién atiende?" y cerrar sesión (M; L si se suma la migración M2)

**Problema** (#4): un solo teléfono, cinco personas y la sesión de quien abrió. No hay `signOut` en el código. Todas las ventas quedan a nombre de la sesión o con `seller_id NULL`: según PR #8, las cuentas de usuario de producción no están vinculadas a `sellers`.

**Diseño (sin PIN en esta fase):**
- **Chip arriba** en `OperacionesApp`, junto a la sucursal: "👤 Mariana ▾". Al tocarlo se abre una hoja con **botones grandes con los nombres** (`useStaff`: activos, sin cuentas tipo "ADMIN", recordados en el equipo para usar sin red) y, abajo, "Cerrar sesión".
- **Cuándo se pregunta:**
  - Al abrir la app si no hay nadie elegido.
  - Al **abrir caja** ("¿Quién abre?", con la persona actual preseleccionada: 1 toque).
  - Al **registrar el cierre** ("¿Quién cierra?").
  - Lo demás persiste hasta que alguien cambie el chip. Un aviso por inactividad ("¿Sigues tú, Mariana?" después de 30 min) es opcional y queda para la fase 3.
- **Dónde se guarda en el teléfono:** `localStorage` `pos.attendant.v1 = {sellerId, name, setAt}`.
- **Qué se guarda en la base:**

| Registro | Sin cambio de esquema | Con migración M2 (opcional, aditiva) |
|---|---|---|
| Venta normal | `sales.seller_id` y `seller_name` = quien atiende. Se pasa también `p_seller_name` a `apply_sale`, que ya resuelve `seller_id` por nombre. | n/a |
| Compra propia | `seller_id` = **quien compra** (PR #8, sin cambios); `notes` += "Atendió: X". No es la sesión, así que respeta e98f603. | n/a |
| Apertura de turno | `cash_shifts.seller_id` (la columna ya existe) | n/a |
| Cierre | `notes` += "Cerró: X" | `cash_shifts.closed_by_seller_id` |
| Movimiento de caja | sufijo en `reason`, " · X" | `cash_movements.seller_id` |
| Recepción y traspaso | `inventory_movements.created_by` es FK a `users`, no sirve | `stock_ops.seller_id` (update después del RPC por `op_id`) |
| Conteo | `p_counted_by` / `p_closed_by` = nombre de quien atiende (ya son texto) | n/a |

- **Payload:** toda escritura lleva `attendantSellerId` y `attendantName` **desde el momento en que se hace**. Así una venta encolada queda atribuida bien aunque se sincronice con otra sesión (hecho 13). En el servidor: se valida que el `seller` exista y esté activo; si no, se ignora y se usa la sesión. Las ventas encoladas antes no lo traen y se usa `resolveSellerId(sesión)` como hoy.
- **Cerrar sesión:**
  - **Bloqueado si el outbox tiene pendientes** ("Hay 2 ventas sin sincronizar. Conéctate antes de salir", con el botón "Sincronizar ahora").
  - Si hay un carrito en curso, pide confirmar.
  - Después: `signOut({callbackUrl:'/login'})` y se borran el carrito, el borrador de recepción y quien atiende. Se conservan el catálogo y la sucursal.
- **Datos que tiene que ordenar el dueño:** "Fabricio" y "Fabricio (admin)" son dos filas de `sellers`. Hay que desactivar la que sea una cuenta (`active=false`) en OlivoWeb.
- **Riesgos:**
  - Si la persona elegida quedó vieja, la atribución es mala. Se mitiga preguntando en apertura y cierre y con el chip siempre visible.
  - M2 es opcional. El código escribe esas columnas solo si existen: un `PGRST204` se ignora con log.
- **Verificación:**
  - Ruta: venta con `attendantSellerId` → `seller_id` correcto; `sellerId` inexistente → se ignora; venta encolada sin el campo → igual que hoy.
  - Sandbox: elegir "Camila", vender, cambiar a "Fabricio", vender → dos `seller_id` distintos. Cerrar sesión con 1 pendiente → bloqueado.

**PIN (fase 3, opcional):** `sellers.pin_hash` (bcrypt), verificado en el servidor. Sin red solo se podría verificar con el hash guardado en el teléfono, y un PIN de 4 dígitos se fuerza en segundos. **Sirve para evitar confusiones, no como seguridad.** Recomiendo no hacerlo salvo que el dueño lo pida.

### 2.2 Ficha de producto nueva (L): la prioridad del dueño

**Flujo:**
1. **En Productos, escanear sin tocar nada** abre directo la ficha (`useLaserScanner` en la lista).
   - Si el código no existe: "Nuevo" con el código puesto.
   - Si está inactivo: "Desactivado: **Reactivar**".
   - "Crear" desde una búsqueda por nombre pone el texto en **Nombre**, no en el código (#21), y genera un código interno `INT-…` como ya hace Recepción.
2. **La ficha** cabe en una pantalla:
   - **Arriba:** nombre, **precio** (`MoneyInput` grande, ya seleccionado), **costo con IVA** (solo ADMIN, ver la decisión) con el **margen %** al lado, "se vende por peso" y activo.
   - **Oferta visible:** si tiene oferta, banda ámbar "En oferta a $1.800: manda sobre el precio" con el botón "Quitar oferta" (#22).
   - **Stock solo para mirar** (pedido fresco al abrir), con el botón **"Ajustar stock"**. Abre una hoja: "¿Cuántas hay ahora?", motivo obligatorio (Merma, Rotura, Vencido, Corrección), `apply_stock_absolute` con `op_id` (idempotente) y `p_counted_by` = quien atiende. Así deja de existir el stock editable que pisaba el real.
   - **Abajo, plegable:** categoría elegida de una **lista** (`GET /api/categories`, las 31 de `categories`), mínimo y óptimo, descripción, URL de imagen (la foto con cámara es la 3.4) y código (cambiarlo es la 3.5).
   - "Guardar" usa el PATCH parcial (1.1). Con Enter en el precio, se guarda.
3. **Filtros con contador** (chips): Sin precio · Sin costo · Sin categoría · Sin foto · Sin stock · Bajo mínimo · **Inactivos** · Con oferta. Los inactivos salen de `GET /api/products?estado=inactivos` (ADMIN y SELLER) y cada fila trae "Reactivar" en un toque.
4. **Costo y proveedor** (hecho 2): `GET /api/products` agrega `costoDelProveedor: boolean` (una consulta a `product_suppliers` con `unit_cost not null`).
   - Si es `true`, el costo se muestra **solo para mirar**: "Lo fija el proveedor X; se cambia en OlivoWeb → Precios".
   - Si es `false`, se edita con IVA y se guarda neto (÷ 1,19, dos decimales), la misma convención que OlivoWeb #107.
   - Si el PATCH devuelve un costo distinto del enviado, se avisa.
- **Decisión del dueño:** OlivoWeb #110 dejó costos y márgenes **solo para ADMIN**, pero el POS hoy manda `purchase_price` a todos en `GET /api/products`. Propongo lo mismo que OlivoWeb: el costo se ve y se edita solo con rol ADMIN, y para SELLER se quita del GET. Si el dueño quiere que las vendedoras carguen el costo de la factura, se habilita solo en Recepción (2.4).
- **No se toca** `price_reviewed_at`: la revisión de precios es un proceso de OlivoWeb (decisión del dueño).
- **Riesgos:** con la caché del SW (NetworkFirst por URL) no hay problema, porque `?estado=inactivos` es otra clave. No afecta al outbox.
- **Verificación:**
  - Unit: margen y la conversión de IVA.
  - Ruta: SELLER no recibe `purchase_price`; PATCH de `purchase_price` por un SELLER → 403.
  - Sandbox: reactivar la "Correa anti-tirones" desde el filtro Inactivos; escanear la Monster (inactiva) en Productos → aparece la oferta de reactivar.

### 2.3 Modo "Lista de precios": edición en serie (M)

- En Productos, el botón "Lista de precios" abre un modo dedicado:
  - Escanear abre una tarjeta grande con nombre, precio actual y precio nuevo **ya seleccionado** (y el costo si es ADMIN).
  - Se tipea, **Enter guarda** (PATCH) y la pantalla vuelve a esperar el siguiente escaneo.
  - Debajo se va armando la lista de lo cambiado: "Coca lata 1.000 → 1.100 ✓".
  - Si el código no existe, se crea en línea (nombre + precio).
- **Si no se pudo guardar** (sin red o 409), la línea queda "⚠ no se guardó · Reintentar". La lista vive en `localStorage` (`pos.priceList.v1`) para que no se pierda. No entra al outbox (se mantiene la decisión de que la edición de productos necesita red).
- Medido sobre la tarea de la vendedora: con 5 precios se pasa de 25 toques a **5 escaneos + 5 tipeos y Enter**, sin toques.
- **Verificación:** sandbox (Playwright): escanear 5 códigos y escribir los precios → 5 PATCH, costos intactos; cortar la red en el 3.º → queda "Reintentar" y, al volver la red, se guarda.

### 2.4 Editar precio desde la venta y desde la recepción (M)

- **Carrito:** lápiz en cada línea → `PriceSheet` → PATCH `sale_price` → la línea se actualiza **sin perder la venta** (depende de 1.7). Cambia la ficha, **no es un descuento**: el POS no tiene descuentos aparte de la compra propia, y con 2.5 el servidor rechazaría un precio distinto del de la ficha.
- **Recepción:**
  - Cada línea muestra precio y costo actuales, con "Editar" en línea.
  - En una línea **nueva o con costo cambiado**: "¿Actualizar precio de venta? Sugerido $X (margen 35 %)". El margen sale de `category_margins` o `margin_override`, y si no hay, 35 %, con la regla de OlivoWeb `pricing.ts` de redondear siempre hacia arriba. Conviene copiar las funciones puras `aNeto`, `aBruto` y `precioSugerido` con sus tests.
  - El PATCH se hace aparte de la operación de stock, que sigue siendo atómica e idempotente por `opId`.
  - **Cantidad tipeable** (`QtyInput`): 24 unidades = 1 toque + "24" (#17).
- **Verificación:** sandbox: en Recepción subir el costo de la Coca → se sugiere el precio → aceptar → `sale_price` nuevo, stock sumado una sola vez (`stock_ops` 1 fila).

### 2.5 Precios validados en el servidor (M)

- **Causa:** hecho 7. El POS cobra lo que diga el navegador: un catálogo cacheado de hace horas o un payload armado a mano.
- **Solución:** copiar `calcularPreciosVenta` de OlivoWeb a `src/lib/pos/precios-venta.ts` **con el redondeo por línea del POS** (`lineSubtotal` = `round(precio × qty)`). OlivoWeb no redondea por línea y tolera $1: con 3 líneas por peso, eso fallaría. En `POST /api/sales`:
  - **En vivo:** si el total no coincide con el de la ficha (tolerancia $1), responde 409 `{code:'PRICE_CHANGED', items:[{barcode, precio}]}`. El cliente actualiza las líneas, muestra "El precio de Coca cambió de $1.000 a $1.100. Total nuevo $X" y pide volver a confirmar (1 toque).
  - **Reintento** (`X-Olivo-Replay`): **se acepta** con los precios del cliente, porque la venta ya ocurrió y se cobró; rechazarla perdería el registro. Se anota la diferencia en `notes` para auditar.
  - El descuento de personal usa la tasa del servidor.
- **Riesgos:**
  - La cabecera de reintento se puede falsificar, pero solo con una sesión de personal: la misma confianza que hoy. Queda documentado.
  - Compatibilidad: no hay cambios de RPC.
  - El precio por peso tiene que usar la misma función en el cliente y en el servidor (tests compartidos).
- **Verificación:**
  - Unit: los tests de OlivoWeb más uno de 3 líneas por peso.
  - Ruta: venta a $1 → 409; la misma con `X-Olivo-Replay` → 200 con nota.

### 2.6 Venta cómoda para el mostrador (M/L)

- Controles de 48 px o más:
  - "+/−" (hoy 24×36);
  - quitar línea (16×24);
  - **vaciar** con hoja de confirmación o toast **"Deshacer"** durante 5 s (#16);
  - "← Productos" como botón;
  - pestañas a 11 px.
- Grilla de 2 columnas en teléfono, con nombre en 2 líneas (#15).
- **Después de confirmar**, una banda grande "Venta #N · **Vuelto $4.000**" (o "Guardada sin conexión · Vuelto $X") que queda visible hasta el siguiente escaneo o toque, y el buscador se limpia (#18).
- Toasts: "+ producto" **reemplaza** al anterior en vez de apilarse, y los avisos suben para no tapar el área de pago (`ToastContext.tsx:42`, #23).
- Badge **OFERTA** en la grilla y en la lista de Productos, con el precio normal tachado (#22).
- Cámara en modo continuo (1.2).
- **Verificación:** medir con Playwright los tamaños (`boundingBox ≥ 48`) en 360×740 y 412×839; y que el vuelto siga visible 10 s después de confirmar.

### 2.7 Cierre: comparar con el POS antes de registrar (M)

- **Causa:** `PasoResumen.tsx` solo repite lo declarado. La comparación aparece recién en Historial, con los códigos en inglés (`HistorialMode.tsx:395`) (#10).
- **Solución sin cambiar el RPC:**
  - En Resumen, una tarjeta **"Lo que registró el POS"** por método: efectivo, tarjeta y transferencia (de `/api/caja`, no anuladas, igual que `v_pos` de `registrar_cierre`) contra lo declarado, con la diferencia en verde o rojo.
  - Se mantiene el texto de que puede no cuadrar mientras no todas las ventas pasen por el POS (decisión del dueño: ¿se sigue cerrando "declarado"?).
  - **"Registrar cierre"** abre una hoja de confirmación con los totales y "¿Quién cierra?" (2.1).
  - El paso Transferencias ofrece "**Traer las 2 del POS**" (las `sale_payments` TRANSFER con `reference`).
  - Las etiquetas pasan por `paymentLabel()` (ya existe en `lib/pos/payments.ts`).
  - Hora del PDF en formato `HH:mm` (#28).
- **También:** `POST /api/caja/cierre` sobre un turno **ya cerrado** solo con rol ADMIN (hoy un SELLER podría reescribir el cierre de ayer; QA lo prueba en `t02`).
- **Verificación:**
  - Unit: la función de comparación.
  - Ruta: SELLER re-registra un turno cerrado → 403.
  - Sandbox: cierre de la vendedora → se ve "POS $13.525 · Contaste $X".

### 2.8 Anular una venta (M)

- **Causa:** no hay UI (#11). `anular_venta` ya existe (OlivoWeb #110) y `close_shift` y `registrar_cierre` ya excluyen las anuladas.
- **Solución:**
  - "Ventas del turno" (Caja → Turno) se vuelve una lista tocable: detalle con productos, pagos y quién atendió.
  - **"Anular venta"** pide motivo (chips: "Error de cobro", "Cliente devolvió", "Duplicada", más texto libre).
  - `POST /api/sales/[id]/anular` → `anular_venta(id, motivo, actor = "quién atiende / sesión")`. Si la venta ya estaba anulada, responde ok ("ya estaba anulada").
- **Decisión del dueño, quién puede anular:** propongo ADMIN siempre, y SELLER solo ventas del **turno abierto** y de los últimos 30 minutos.
- **Riesgo conocido (hecho 5):** anular la venta de un producto que estaba sin stock crea stock fantasma. La solución está en la 3.2. Mientras tanto, la hoja de anulación avisa: "X estaba sin stock: revisa su stock después de anular".
- **Verificación:**
  - Ruta: anular dos veces → la segunda responde ok y el stock se repone una sola vez (bloqueo `FOR UPDATE` del RPC).
  - Sandbox: anular la #6 → Caja → Turno ya no la cuenta.

### 2.9 Fiados sin duplicados (S)

- **Causa:** `PasoFiados.tsx:48-49` busca por nombre exacto, así que "don pedro" no coincide con "Don Pedro (vecino)" y `find_or_create_account` crea otra cuenta. Un abono a quien no debe se acepta sin aviso (#12).
- **Solución:**
  - El nombre se elige de una **lista con búsqueda difusa** (`searchProducts`-like sobre `customer_accounts`).
  - Crear una cuenta nueva exige "**+ Nueva cuenta: 'don pedro'**" con confirmación, y si hay parecidas: "¿Es Don Pedro (vecino)?".
  - Un abono a una cuenta con saldo ≤ 0, o mayor que la deuda, pide confirmar.
  - En la pestaña Fiados, botón **"Registrar abono"** que agrega al borrador del cierre del turno abierto (mismo RPC, sin cambiar el esquema).
- **Verificación:** sandbox: escribir "don pedro" → se sugiere la cuenta existente.

### 2.10 Pendientes visibles (S)

- **Causa:** `SyncContext` deja las operaciones fallidas con `lastError`, pero la UI solo dice "N pendientes".
- **Solución:** tocar el badge abre la lista: tipo, hora, total, error en español y "Reintentar". Para "Descartar" hace falta ADMIN y una confirmación con el detalle de la venta. Nunca se descarta solo.
- **Verificación:** unit (`fake-indexeddb`): una venta con 422 aparece en la lista con su error.

### 2.11 Errores en español (S)

- **Causa:** `api-response.ts:26-33` devuelve `error.message` crudo (#28; `PLAN.md §4`).
- **Solución:** mapear `23505`, `23503`, `23514` (CHECK), `P0001` (RAISE de los RPC, que ya vienen en español), `PGRST*` y los errores de cámara (`useBarcodeStream.ts:455`, por ejemplo "Requested device not found" → "No se encontró la cámara") a frases en español. El detalle técnico va solo al log.
- **Verificación:** unit del mapa.

### 2.12 Movimientos de caja (S)

- Confirmar antes de registrar ("Egreso $15.000 en efectivo: pago a proveedor").
- **"Anular movimiento"** = un movimiento compensatorio con `opId` (idempotente, deja rastro y no borra nada).
- Selector de método con botones, para que no se salga de la pantalla a 360 px (#24).
- **Verificación:** sandbox: anular un egreso → el esperado vuelve a su valor.

### 2.13 Conteo con el láser (S)

- **Causa:** `ConteoMode.tsx:327` ignora el mismo código durante 600 ms aunque venga del láser (#26).
- **Solución:** el anti-rebote se aplica solo a la cámara (`UnifiedScanner` entrega la fuente).
- **Verificación:** unit con 3 escaneos láser en 300 ms → 3 unidades.

---

## 5. Fase 3: resto y decisiones de negocio

| # | Qué | Tamaño | Notas |
|---|---|---|---|
| 3.1 | **Conteo de góndola** (#13) | S/M | `close_stock_count` ya acepta `p_zero_uncounted=false` y `p_deactivate_uncounted=false`. Falta que la UI lo ofrezca ("Solo aplica lo escaneado") y que la ruta `cerrar` permita a un SELLER cerrar **solo** en ese modo. Decide el dueño. |
| 3.2 | **Stock negativo** (#29) y anulación exacta | S de SQL + decisión | Migración M3: quitar `GREATEST(0, …)` de `apply_sale` (y quizá de `apply_transfer`). La web no se rompe (hecho 16). El conteo pasa a ser más exacto. Riesgo: `apply_sale` **no está en las migraciones de OlivoWeb**; hay que copiar el cuerpo actual con `pg_get_functiondef` de producción. Es una regla "nunca negativo" deliberada, así que la decide el dueño. |
| 3.3 | PIN por empleado | M | Migración `sellers.pin_hash`. Ver la advertencia de 2.1. |
| 3.4 | Foto con la cámara | M | Subida a Supabase Storage (el bucket que use OlivoWeb), con compresión en el cliente. |
| 3.5 | Corregir el código de barras | S | El RPC `rename_product_barcode` ya existe (OlivoWeb #104). Solo ADMIN, con confirmación. |
| 3.6 | Oferta con fecha de término (#22) | M | Migración `products.offer_ends_at`. `precioVigente` en **las dos apps** y en la web. |
| 3.7 | Referencia de la transferencia (#30) | S | `sale_payments.reference` ya existe: campo opcional "últimos dígitos o nombre". |
| 3.8 | Redondeo del efectivo, Ley 20.956 (#31) | M | Cambia el total, los pagos y el cierre. Lo deciden el dueño y su contador. |
| 3.9 | Fiado como medio de pago en la venta (#34) | L | Esquema nuevo: un método en el enum o `account_entries.sale_id`, además de `registrar_cierre`. Hay que rediseñar con OlivoWeb. |
| 3.10 | Consolidar `apply_sale` y tipos generados (`PLAN.md §1`) | M | Hay tres sobrecargas. Este plan no cambia ninguna firma. |
| 3.11 | "¿Sigues tú?" por inactividad | S | Sobre 2.1. |
| 3.12 | Smoke tests e2e con Playwright en CI | M | Los scripts del sandbox convertidos en tests. |

---

## 6. Diseño detallado: edición de productos (resumen de flujos y toques)

| Tarea | Hoy | Con el plan |
|---|---|---|
| Cambiar un precio | 5 toques + borrar + tipear, y **borra el costo** | Escanear en Productos (0 toques) → tipear → Enter. **0 toques** |
| Lista de 5 precios | 25 toques | 5 escaneos + 5 tipeos y Enter (2.3) |
| Corregir un precio en plena venta | Se pierde el carrito | Lápiz en la línea → tipear → Enter (2.4). **2 toques** |
| Producto sin precio al vender | Se regala o da error | Se pide el precio ahí mismo (1.5). **1 toque** |
| Costo nuevo al recibir mercadería | No se puede | Campo en la línea + precio sugerido (2.4) |
| Reactivar un inactivo | No se puede (desaparece) | Escanearlo → "Reactivar" o el filtro "Inactivos" (2.2). **1 toque** |
| Ajustar stock | Se edita en la ficha y **pisa** el real | "Ajustar stock" + motivo, idempotente (2.2) |
| Encontrar lo incompleto | No hay forma | Chips: "Sin costo 26 · Sin precio 1 · …" |

Reglas fijas:
- PATCH solo con lo que cambió, con `expected` para detectar que otra persona cambió el mismo campo.
- **Jamás `stock`** desde una ficha.
- Altas con `insert` y `is_active: true`.
- La ficha se abre con datos frescos.
- La caché de IndexedDB se actualiza después de guardar.

---

## 7. Diseño detallado: asignar dueño y "¿quién atiende?" (qué ve la vendedora)

1. **Al entrar** (después del login): "¿Quién atiende?" con 5 botones grandes (María, Mariana, Fabricio, Alfredo, Ingrid). Un toque.
2. **Arriba, siempre visible:** "👤 Mariana ▾". Para cambiar de persona: tocar el chip y luego el nombre. 2 toques, sin cerrar sesión.
3. **Abrir caja:** "Abre la caja: Mariana ✓" (preseleccionada), efectivo propuesto = lo que quedó ayer y "Abrir". La app vuelve sola a Venta.
4. **Cierre:** en Resumen, "Cierra: Mariana ✓".
5. **Caja → Turno:** si hay compras propias sin dueño, la tarjeta ámbar "4 compras propias sin dueño", la lista y el nombre. Confirmar.
6. **Cerrar sesión:** en el mismo menú del chip, bloqueado si hay ventas sin sincronizar.

---

## 8. Migraciones (para `OlivoWeb/supabase/migrations`; no se aplican solas)

### M1: `20261002000000_un_turno_abierto_por_sucursal.sql` (fase 1)

Es segura y retrocompatible para el POS. En OlivoWeb, una doble apertura pasa a fallar, que es lo correcto, pero conviene mapear el mensaje.

```sql
-- Un solo turno OPEN por sucursal. Los turnos sin sucursal (branch_id NULL, por
-- ejemplo los de /admin/pos en OlivoWeb) cuentan como una "sucursal" más, para
-- que tampoco se dupliquen.
--
-- ANTES DE APLICAR: esta consulta tiene que devolver 0 filas.
--   SELECT COALESCE(branch_id::text,'(sin sucursal)') AS sucursal, count(*), array_agg(id)
--     FROM public.cash_shifts WHERE status = 'OPEN' GROUP BY 1 HAVING count(*) > 1;
-- Si devuelve filas, hay que cerrar o declarar los turnos sobrantes, o asignarles
-- su sucursal, antes de aplicar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cash_shifts WHERE status = 'OPEN'
     GROUP BY COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay sucursales con más de un turno abierto: resuélvelo antes (ver consulta en el encabezado)';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_un_turno_abierto_por_sucursal
  ON public.cash_shifts ((COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'OPEN';
```

`cash_shifts` es una tabla chica: el bloqueo dura milisegundos. Es idempotente (`IF NOT EXISTS`). **[QA]:** puede que hoy existan turnos huérfanos abiertos en producción (#3); si es así, la reparación de 1.3 va primero.

### M2: `20261010000000_quien_atiende.sql` (fase 2, opcional)

Solo agrega columnas nulas sin default, así que es un cambio de metadatos instantáneo y retrocompatible.

```sql
ALTER TABLE public.cash_shifts    ADD COLUMN IF NOT EXISTS closed_by_seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS seller_id          uuid REFERENCES public.sellers(id) ON DELETE SET NULL;
ALTER TABLE public.stock_ops      ADD COLUMN IF NOT EXISTS seller_id          uuid REFERENCES public.sellers(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.cash_movements.seller_id IS 'Empleado que estaba atendiendo (selector "¿Quién atiende?" del POS). No es la sesión.';
```

No cambia ningún RPC: el POS escribe estas columnas con un `UPDATE` después (como ya hace con `sales.seller_id`). OlivoWeb no se ve afectado. `account_entries` se deja fuera a propósito, porque `registrar_cierre` la borra y la vuelve a insertar.

### M3: stock negativo en `apply_sale` (fase 3, solo si el dueño lo aprueba)

Es un `CREATE OR REPLACE` de la sobrecarga de 17 parámetros, copiada **textual** de producción (`SELECT pg_get_functiondef('public.apply_sale(numeric,text,numeric,numeric,numeric,numeric,text,text,text,jsonb,timestamptz,text,text,text,uuid,jsonb,uuid)'::regprocedure)`), cambiando únicamente `SET stock = GREATEST(0, stock - v_qty)` por `SET stock = stock - v_qty`. Es retrocompatible en la firma. En el comportamiento, el stock puede bajar de 0 en el local, la web lo muestra agotado y `anular_venta` pasa a ser exacta. Hay que revisar el informe "enNegativo" de `close_stock_count`.

---

## 9. Tests (el POS hoy no tiene ninguno)

**Infraestructura (1.11):**
- `devDependencies`: `vitest`, `@vitest/coverage-v8`, `fake-indexeddb` y `jsdom` (para hooks), además de `pg` para los tests de base.
- `vitest.config.ts` con alias `@/`.
- Scripts: `npm test` (unitarios, sin red) y `npm run test:db` (necesita `DATABASE_URL`; cada test corre en `BEGIN … ROLLBACK`; se salta solo si la variable no está). En el sandbox: `postgresql:///olivo_ing?host=/tmp&port=54322&user=postgres`.
- Los tests de rutas importan el handler e inyectan un `supabaseServer` simulado con `vi.mock`, o lo apuntan a PostgREST del sandbox con `test:db`. La sesión se simula sobre `requireApiAdminOrSeller`.
- CI: `.github/workflows/ci.yml` con `npm ci`, `typecheck`, `lint` y `npm test` en cada PR. `test:db` corre localmente o contra un branch de Supabase (después).

**Tests mínimos que atajan desastres:**

| # | Test | Tipo | Ataja |
|---|---|---|---|
| T1 | `apply_sale` idempotente: la misma `client_sale_id` dos veces da el mismo id, 1 venta y el stock descontado una vez | db | `PLAN.md §3` |
| T2 | Venta por peso: 350 g a $4.000/kg → subtotal $1.400 y `branch_stock` −0,350, sin truncar | db + unit (`lineSubtotal`) | `PLAN.md §3` |
| T3 | Pago mixto: `registrar_cierre.pos_totals` = CASH 5000 / CARD 3070, y `resumenTurno` igual | db + unit | `PLAN.md §3`, #7 |
| T4 | El outbox no encola un 4xx; sí encola un `TypeError`; un 401 de venta se encola; un 401 al drenar no suma intentos | unit (`fake-indexeddb`, fetch simulado) | `PLAN.md §3`, 1.10 |
| T5 | `diffProduct` nunca incluye `stock`; solo los campos cambiados | unit | #1 |
| T6 | `POST /api/products` con el payload viejo: sin `stock`, sin `purchase_price` 0 y sin `apply_stock_absolute` | ruta | 1.0 |
| T7 | `PATCH` con `stock` → 400; conflicto de `expected` → 409; alta con código existente → 409, sin pisar | ruta (+db) | 1.1, #14 |
| T8 | `parseCLP` y `parseGramos` (casos de 1.4) | unit | #9, #20 |
| T9 | Detector de escaneo: ráfaga + Enter → código, el Enter se cancela sobre un botón con foco, el tipeo lento se ignora | unit + jsdom | #2 |
| T10 | `cobro.ts`: el monto sigue al total, tarjeta tope, sin vuelto fantasma en compra propia | unit | #5 |
| T11 | Abrir caja sin `branchId` → sucursal por defecto; dos aperturas en paralelo → 1 turno (con M1) | ruta + db | #3 |
| T12 | Venta en vivo con línea a $0 o `qty ≤ 0` → 400; con `X-Olivo-Replay` → aceptada con nota | ruta | #8 |
| T13 | Asignar dueño: solo si `seller_id` es nulo y no está liquidada; la segunda vez → 409 | ruta + db | 1.9 |
| T14 | `soldAt` llega a `sales.ts`; uno futuro se ignora | ruta + db | 1.10 |
| T15 | Carrito: persistir y restaurar con precios refrescados | unit | #6 |
| T16 (F2) | `calcularPreciosVenta` con redondeo por línea (3 líneas por peso) | unit | 2.5 |
| T17 (F2) | Venta con `attendantSellerId` → `seller_id` correcto; la versión vieja sin el campo → igual que hoy | ruta | 2.1 |
| T18 (F2) | Anular dos veces → el stock se repone una sola vez | db | 2.8 |

---

## 10. Daño en producción: diagnóstico y reparación [QA]

Lo que sigue son consultas **de solo lectura** para que QA o el dueño midan el daño. La reparación la hace el dueño desde el panel de Supabase.

1. **Costos y mínimos borrados por el POS.** La huella de un guardado desde el POS es `min_stock IS NULL AND optimum_stock IS NULL`, porque los defaults de la base son 5 y 20.
   ```sql
   SELECT barcode, name, purchase_price, min_stock, optimum_stock, category, image_url, updated_at
     FROM products
    WHERE min_stock IS NULL AND optimum_stock IS NULL
    ORDER BY updated_at DESC;
   ```
   Los que tienen proveedor con costo no perdieron el costo (hecho 2). **Recuperación:** restaurar el último respaldo diario o PITR de Supabase en un proyecto o branch aparte y copiar con `UPDATE products p SET purchase_price=b.purchase_price, min_stock=b.min_stock, optimum_stock=b.optimum_stock, … FROM respaldo b WHERE p.barcode=b.barcode AND COALESCE(p.purchase_price,0)=0 AND b.purchase_price>0`, campo por campo y revisando la lista primero.
2. **Stock revertido por ajustes fantasma.** `POST /api/products` no manda `opId`, así que sus ajustes quedan con `reference_id NULL`.
   ```sql
   SELECT a.product_barcode, a.created_at, a.type, a.quantity,
          s.reason AS movimiento_previo, s.created_at AS cuando, s.quantity AS cant_previa
     FROM inventory_movements a
     JOIN inventory_movements s
       ON s.product_barcode = a.product_barcode
      AND s.reason IN ('SALE','RECEPTION','TRANSFER_IN','TRANSFER_OUT','WEB_SALE')
      AND s.created_at BETWEEN a.created_at - interval '2 hours' AND a.created_at
    WHERE a.reason = 'MANUAL_ADJUSTMENT' AND a.reference_id IS NULL
    ORDER BY a.created_at;
   ```
   Cada coincidencia (por ejemplo, `OUT 2 SALE` y después `IN 2 MANUAL_ADJUSTMENT`) es candidata a revertir con un ajuste de signo contrario, que hay que revisar una por una. Después de la fase 1, lo correcto es un **conteo** de esos productos.
3. **Productos sobrescritos por "Nuevo" o la creación rápida** (#14): productos con `category IS NULL AND image_url IS NULL AND purchase_price = 0` que en el respaldo tenían datos. Se recuperan igual que en el punto 1.
4. **Turnos huérfanos sin sucursal:** la consulta de 1.3.
5. **Ventas con línea a $0:** `SELECT s.id, s.ts, i.product_name FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE i.unit_price <= 0 AND NOT s.voided;`
6. **Compras propias sin dueño:** `SELECT id, ts, total, seller_id, seller_name, staff_settled_at FROM sales WHERE is_staff_purchase AND NOT voided AND staff_settled_at IS NULL AND seller_id IS NULL;`, que debería devolver las 257, 258, 260 y 261.

---

## 11. Lo que queda FUERA y por qué

- **Boleta o comprobante para el cliente** (#33): la boleta electrónica es un proyecto legal y de integración con el SII. Un comprobante "no fiscal" impreso en la misma impresora se puede confundir con una boleta. Lo decide el dueño con su contador.
- **Encolar la edición de productos sin red:** se mantiene la decisión documentada (`ProductosMode.tsx:113-115`). Resolver conflictos entre ediciones diferidas de un dato compartido no compensa. La lista de precios guarda localmente lo no guardado para reintentar (2.3).
- **Editar el costo de productos con proveedor** (`product_suppliers`, bultos, IVA): es del dominio de OlivoWeb (Precios / Taller de precios). El POS lo muestra solo para mirar.
- **Marcar `price_reviewed_at` desde el POS:** es parte del proceso de revisión de OlivoWeb.
- **Deshacer o modificar el PR #8:** no se toca. 2.1 agrega quién atiende sin cambiar quién compra.
- **Cambiar firmas de RPC** (`apply_sale`, `apply_reception`, `registrar_cierre`): todo se resuelve con parámetros existentes o con `UPDATE` posteriores. Consolidar las sobrecargas es la 3.10.
- **Rediseño general, Play Store o keystore** (`PLAN.md §6`) **y decidir entre "Olivo Operaciones" y el POS** (`PLAN.md §7`): no son parte del pedido.
- **Teclado o PIN de seguridad real por empleado:** con un teléfono compartido y sin red, un PIN offline no es seguridad (ver 2.1). Queda como opción en la 3.3.

---

## 12. Orden de PRs sugerido

1. **PR-A (hoy):** 1.0, la guarda de `POST /api/products`, y el test T6.
2. **PR-B:** 1.11 (vitest + CI) junto con 1.4 (`num.ts`, `MoneyInput`) y 1.6 (`cobro.ts`): lógica pura con tests.
3. **PR-C:** 1.1 + 1.5 (PATCH, altas, `PriceSheet`, reintento) con T5, T7 y T12.
4. **PR-D:** 1.2 (láser) + 1.7 (persistencia) con T9 y T15.
5. **PR-E:** 1.3 (sucursal y turno) + M1 en OlivoWeb + reparación de huérfanos, con T11.
6. **PR-F:** 1.8 + 1.9 + 1.10, con T3, T4, T13 y T14.
7. Fase 2 en este orden: 2.1 → 2.2/2.3 → 2.4/2.5 → 2.6 → 2.7/2.8 → el resto.

Regla de `PLAN.md §2`: cada arreglo de lógica compartida (1.3 sobre el turno, 2.5 sobre los precios) se revisa el mismo día en OlivoWeb.

---

## 13. Puntos que dependen de QA

- **Magnitud del daño en producción** del #1 y el #14 (sección 10, puntos 1 a 3) y si hace falta restaurar desde un respaldo.
- **Turnos huérfanos abiertos en producción**, que hay que resolver antes de aplicar M1.
- **Estado exacto de las ventas 257, 258, 260 y 261:** `seller_id NULL`, o un `seller_id` de una cuenta tipo "ADMIN".
- Resultados de los scripts `t01` (precio manipulado y cantidad negativa), `t02` (venta y movimiento a un turno cerrado, re-cierre por SELLER, carrera de aperturas), `t07` (hora de la venta offline, sesión vencida) y `t08` (creación rápida sobre un inactivo). Mis pruebas en `olivo_ing` coinciden con lo que esos scripts buscan (hechos 5 a 10). Si QA encuentra algo distinto, hay que ajustar 1.3, 1.5, 1.10 y 2.7.
- Pendiente de QA y no cubierto aquí: **movimiento de caja a un turno ya cerrado.** Mi propuesta: en vivo → 409; en un reintento → se acepta, porque el dinero se movió antes del conteo. Va junto con 2.12.

*Sandbox:* dejé creada la base `olivo_ing` (en el mismo servidor, puerto 54322) con algunas ventas y turnos de prueba. No afecta a `olivo`. Se puede borrar con `dropdb -h /tmp -p 54322 -U postgres olivo_ing`.
