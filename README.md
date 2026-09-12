# Olivo POS

Punto de venta del local de OLIVOMARKET. App Next.js independiente que comparte
la base de datos Supabase con la tienda web (OlivoWeb), pero no comparte código
ni despliegue.

Toda la app **es** la herramienta de mostrador: no hay panel admin alrededor ni
tienda pública. Una barra de seis pestañas y nada más.

| Pestaña | Qué hace |
| --- | --- |
| **Venta** | Carrito, escaneo, pago mixto (efectivo / tarjeta / transferencia), venta por peso |
| **Recepción** | Escanea mercadería que llega y **suma** stock (`apply_reception`) |
| **Conteo** | Toma de inventario: **fija** la cantidad real (`apply_stock_absolute`) |
| **Caja** | Abre turno, ingresos y egresos manuales de efectivo |
| **Cierre** | Arqueo por método de pago contra lo esperado (`close_shift`) |
| **Productos** | Alta y edición de productos, incluido el marcado "se vende por peso" |

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y completa los valores reales
npm run dev                  # http://localhost:3000
```

Variables necesarias (ver `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

Sin ellas la app compila igual (los clientes de Supabase usan valores
placeholder para no romper el build), pero cualquier consulta real falla.

Otros comandos:

```bash
npm run build       # build de producción (genera public/sw.js)
npm run start       # sirve el build
npm run lint
npm run typecheck
```

## Acceso

Login por email + contraseña contra la tabla `users` (hash bcrypt en
`password_hash`). Sólo entran los roles `ADMIN` y `SELLER`; el middleware
protege todo salvo `/login`, `/api/auth/*` y los estáticos.

No hay Google OAuth a propósito: acá se entra con la cuenta de la tienda.

## Conteo de inventario (toma de inventario)

Recepción y Conteo hacen cosas distintas y no son intercambiables:

| | Recepción | Conteo |
| --- | --- | --- |
| Qué hace con la cantidad | la **suma** al stock | la **fija** como el stock |
| Para qué es | mercadería que acaba de llegar | saber qué hay de verdad en la tienda |
| El mismo producto en dos lugares | suma dos veces | suma las dos cantidades |
| Cuándo escribe el stock | al confirmar | al cerrar el conteo (modo por defecto) |

Contar con Recepción es lo que corrompió el inventario: suma lo contado sobre
lo que el sistema ya creía tener (si decía 12 y hay 5, queda 17), y no había
forma de decir "hay 5" ni "no hay ninguno".

### El conteo es independiente de las ventas

Por defecto (modo **"al cerrar el conteo"**) escanear **sólo anota**: el stock no
se toca. La tienda sigue vendiendo con sus números todo el tiempo que dure el
conteo, y recién al cerrar se aplica todo junto — corrigiendo producto por
producto lo que se vendió o se recibió después de contarlo:

```
final = contado + (stock_de_ahora − stock_cuando_se_contó)
```

El paréntesis son exactamente las ventas (negativo) y las recepciones (positivo)
posteriores al conteo. No hace falta leer `inventory_movements` para saberlo:
`branch_stock` sólo cambia por esos movimientos, así que el propio stock lleva
la cuenta.

> Contaste 8 a las 10:00 (el sistema decía 6). Durante el día se vendieron 3, así
> que el stock de ahora es 3. Al cerrar queda **8 + (3 − 6) = 5**: había 8, se
> vendieron 3. Sin la corrección quedaría 8 y las tres ventas del día
> desaparecerían del inventario.

Si se vendió más de lo contado, el producto queda en 0 y el cierre lo informa
aparte: o ese conteo ya estaba viejo, o se vendió sin stock. Conviene recontarlo.

El otro modo, **"al instante"**, fija el stock en cada lote que guardas. Sirve
para recontar unos pocos productos con la tienda cerrada y verlos corregidos ya.
Con la tienda abierta pierde las ventas del medio, y por eso no es el default.

El modo se elige al abrir el conteo y no se puede cambiar a mitad de camino.

### El flujo

1. **Empezar conteo** — abre una sesión para la sucursal y se elige el modo. Sólo
   puede haber una abierta a la vez, así que dos teléfonos cuentan sobre la misma
   sesión y se ven el avance.
2. **Escanear y escribir la cantidad** — cada escaneo del mismo código suma una
   unidad (se cuenta pasando el lector por cada envase) y la cantidad también se
   puede escribir.
3. **Un producto en varios lugares se SUMA** — si el mismo producto está en la
   vitrina y en la bodega, se cuenta en cada recorrido y las cantidades se
   suman. La pantalla avisa "ya contaste N · total M" y, si lo que quieres es
   corregir un error de tipeo en vez de sumar otro lugar, el botón **Corregir**
   reinicia lo contado de ese producto.
4. **Guardar** — manda el lote. La lista sin guardar vive en el teléfono
   (`localStorage`), así que cerrar la app a mitad de una góndola no la pierde.
5. **Cerrar conteo** (sólo admin) — se aplica lo contado con la corrección de
   arriba, y lo que nunca se escaneó queda en 0 y sale del catálogo disponible.
   **Eso** es lo que define qué hay a la fecha.

> **Por qué se suma y no se reemplaza.** El primer inventario real (11-sep-2026)
> se hizo en dos recorridos, vitrina y después bodega. Cada escaneo guardado
> reemplazaba al anterior del mismo producto, así que de 487 ítems enviados
> quedaron 366: se perdió lo que había en vitrina de 120 productos. Nunca dejó
> stock de más, pero sí de menos. Ahora cada escaneo guardado es una **marca**
> (`stock_count_tags`) y lo contado de un producto es la suma de sus marcas,
> como las tarjetas de un inventario de papel.

**No hace falta poner todo en 0 antes de empezar**, y con el modo independiente
no tiene ningún sentido (la base lo rechaza): dejaría el catálogo sin
existencias durante todo el conteo y la tienda web sin poder vender. La casilla
existe sólo en el modo "al instante", para quien prefiera arrancar de una hoja
en blanco con la tienda cerrada.

Sin conexión el conteo sigue: el conteo abierto queda recordado en el teléfono y
lo escaneado se encola en el outbox. Abrir y cerrar el conteo sí necesitan red.

### Por qué no se puede duplicar

- Cada lote lleva un `opId` (uuid del cliente) que la base registra en
  `stock_ops`: si el lote ya se aplicó, se descarta antes de tocar nada, así que
  reenviarlo no lo cuenta dos veces. Recepción y Traspaso también lo llevan:
  antes, una respuesta que no llegaba por timeout —indistinguible de una
  petición que nunca salió— hacía que el outbox reenviara una recepción que sí
  había entrado, y el stock quedaba al doble.
- `products.stock` tiene **un solo escritor**: es derivado de `branch_stock` y lo
  recalcula un trigger. Ni el POS ni el panel lo escriben. Por eso el campo
  "stock" de la pestaña Productos ya no escribe la columna: aplica la cantidad
  como ajuste absoluto sobre la sucursal (`MANUAL_ADJUSTMENT`), que es lo que
  antes se descartaba en silencio.

## Venta por peso

Un producto con `by_weight = true` interpreta su `sale_price` como **precio por
kilo**. Al tocarlo o escanearlo, el POS abre un cuadro que pide el peso (en
gramos, que es lo que muestra la balanza) y arma la línea con la cantidad
fraccionaria; el subtotal se redondea a peso por línea.

Las columnas de cantidad (`sale_items.quantity`, `inventory_movements.quantity`,
`branch_stock.stock`) ya son `numeric`, así que los decimales llegan enteros
hasta la base.

## Funcionamiento sin conexión

- **Service worker** (Serwist): precachea el shell para que la app abra sin red.
  `GET /api/products` y `GET /api/branches` van por **NetworkFirst** con timeout
  de 5 s — con red se quiere el precio fresco; sin ella, la última copia buena.
  El resto de `/api/**` es **NetworkOnly**: servir una escritura cacheada haría
  creer que una venta entró cuando no.
- **IndexedDB** (Dexie, `src/lib/offline/db.ts`): `productsCache` con el
  catálogo y `outbox` con las escrituras pendientes.
- **`apiWrite`** (`src/lib/offline/apiWrite.ts`): puerta única de escritura. Con
  red hace el POST; sin red encola y responde "guardado, pendiente". Un error
  HTTP del servidor **no** se encola: reintentar un 400 en bucle no arregla nada.
- **`SyncContext`**: drena la cola FIFO al volver la conexión y cada 20 s. La
  barra de pestañas muestra un punto ámbar con el número de pendientes.

Las **ventas son idempotentes**: cada una lleva un UUID de cliente que viaja
como `p_client_sale_id` a `apply_sale`, que deduplica. Reintentar una venta
encolada no puede cobrarla dos veces. Recepción, Traspaso y Conteo hacen lo
mismo con `opId` contra la tabla `stock_ops`. Los **movimientos de caja** siguen
sin deduplicación: si el outbox reintenta un ingreso de efectivo tras una caída
de red, entra dos veces y el arqueo no cuadra. Es la última pieza pendiente.

Abrir y cerrar caja **no** se encolan: ambas necesitan la respuesta real del
servidor (el `shiftId` y el cuadre).

## Instalar en los celulares del local

La app es una PWA: desde Chrome, "Agregar a pantalla de inicio" ya deja un
ícono que abre en pantalla completa y funciona sin conexión.

### APK

`android/` es un cascarón Capacitor (`cl.olivomarket.pos`) que **no lleva build
web propio**: carga en vivo la URL de `capacitor.config.ts`. Por eso cada deploy
en Vercel actualiza la app de los teléfonos sin reinstalar nada — el APK sólo se
rehace si cambia el ícono, el nombre o la URL.

El APK se compila en CI, no hace falta Android Studio: en GitHub → **Actions** →
"Build Android APK (POS)" → *Run workflow*. Al terminar, el `.apk` queda como
artifact del run. El workflow también corre solo cuando cambia `android/`,
`www/` o `capacitor.config.ts` en `main`.

Para instalarlo hay que permitir "Instalar apps de origen desconocido" en el
gestor de archivos que abra el `.apk`.

Ese artifact es un **debug APK**, firmado con la llave de debug: sirve para
sideload en los teléfonos del local, no para Play Store. Publicar en Play pide
un release firmado con una llave propia que hay que guardar (sin ella no se
puede actualizar la app después).

Si se toca `capacitor.config.ts`, corre `npm run android:sync` para que el
proyecto nativo quede al día.

Los íconos salen del mismo diseño del `icon.svg`: `public/icons/` para el
manifest de la PWA y `android/app/src/main/res/mipmap-*/` para el lanzador.

## Base de datos

Se usa el mismo proyecto Supabase que OlivoWeb. Este repo **no** define ni
migra esquema; se apoya en lo que ya existe:

- `apply_sale(...)` — crea la venta completa en una transacción, idempotente por
  `p_client_sale_id`.
- `apply_reception(p_items, p_branch_id, p_reference, p_notes, p_op_id)` — suma
  stock; idempotente por `p_op_id`.
- `apply_stock_absolute(p_items, p_branch_id, p_op_id, p_reason, p_session_id,
  p_counted_by)` — **fija** cantidades exactas. Es la puerta del conteo y de los
  ajustes manuales.
- `open_stock_count` / `stock_count_progress` / `close_stock_count` — sesión de
  conteo físico. El cierre es el que aplica el borrador corrigiendo las ventas
  del medio.
- `stock_count_product(p_session_id, p_barcode)` — cuánto lleva contado un
  producto en la sesión abierta, para avisarlo antes de sumar otro lugar.
- `close_shift(p_shift_id, p_counts)` — cuadre por método de pago.
- `v_shifts_history` — historial de turnos (`GET /api/reports/shifts`).

El identificador de negocio de un producto es `barcode` (los upserts van con
`onConflict: 'barcode'`), no la PK `id`.

Las migraciones viven en **OlivoWeb** (`supabase/migrations/`), que es el dueño
del esquema. Las funciones del conteo se agregaron en
`20260910000000_conteo_fisico_de_inventario.sql`, que además explica en detalle
cómo se rompía el stock antes. Una RPC que cambia de firma hay que cambiarla ahí
y desplegar los dos repos: no hay tipos generados que avisen en tiempo de build,
así que el desfase aparece recién cuando un cajero no puede vender.

**Modelo de stock, en una línea:** `branch_stock` (por sucursal) es la fuente de
verdad; `products.stock` es derivado y lo escribe **sólo** un trigger. Nada del
POS escribe esa columna.
