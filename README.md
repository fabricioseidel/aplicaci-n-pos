# Olivo POS

Punto de venta del local de OLIVOMARKET. App Next.js independiente que comparte
la base de datos Supabase con la tienda web (OlivoWeb), pero no comparte código
ni despliegue.

Toda la app **es** la herramienta de mostrador: no hay panel admin alrededor ni
tienda pública. Una barra de seis pestañas y nada más.

| Pestaña | Qué hace |
| --- | --- |
| **Venta** | Carrito, escaneo, pago mixto (efectivo / tarjeta / transferencia), venta por peso |
| **Recepción** | Escanea mercadería que llega y suma stock (`apply_reception`) |
| **Inventario** | Verificación por escaneo: lo escaneado queda activo |
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
encolada no puede cobrarla dos veces. Los movimientos de caja y las recepciones
no tienen deduplicación en la base — es una limitación conocida y asumida.

Abrir y cerrar caja **no** se encolan: ambas necesitan la respuesta real del
servidor (el `shiftId` y el cuadre).

## Instalar en los celulares del local

La app es una PWA: desde Chrome, "Agregar a pantalla de inicio" ya deja un
ícono que abre en pantalla completa y funciona sin conexión.

Para un **APK instalable** (sideload, sin Play Store) se empaqueta la misma URL
como TWA — el APK no lleva código propio, sólo abre el sitio a pantalla
completa, así que cada deploy actualiza la app sin reinstalar nada:

1. En [pwabuilder.com](https://www.pwabuilder.com) se pega la URL de
   producción y se genera el paquete Android. Guarda el `signing.keystore` y su
   contraseña: sin esa misma llave, una actualización futura no se puede
   instalar encima y hay que desinstalar primero.
2. El paquete trae un `assetlinks.json`. Va en `public/.well-known/assetlinks.json`
   de este repo y se despliega **antes** de instalar el APK: es lo que prueba
   que el dominio y la app son del mismo dueño. Sin él el APK funciona igual,
   pero muestra la barra de direcciones de Chrome arriba.
3. En cada teléfono hay que permitir "Instalar apps de origen desconocido" para
   el gestor de archivos que abra el `.apk`.

Los íconos del manifest (`public/icons/`) se generan con el mismo diseño del
`icon.svg`; el de 512 es el que Android usa para el lanzador.

## Base de datos

Se usa el mismo proyecto Supabase que OlivoWeb. Este repo **no** define ni
migra esquema; se apoya en lo que ya existe:

- `apply_sale(...)` — crea la venta completa en una transacción, idempotente por
  `p_client_sale_id`.
- `apply_reception(p_items, p_branch_id, p_reference, p_notes)` — suma stock.
- `close_shift(p_shift_id, p_counts)` — cuadre por método de pago.
- `v_shifts_history` — historial de turnos (`GET /api/reports/shifts`).

El identificador de negocio de un producto es `barcode` (los upserts van con
`onConflict: 'barcode'`), no la PK `id`.
