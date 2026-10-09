# Plan acordado (ingeniero + validación de la vendedora)

Base: `03-ingeniero-plan.md` y `04-vendedor-validacion.md`. Decisiones del dueño, por defecto mientras no responda: **costo solo para ADMIN, sin PIN, sin stock negativo**. Datos nuevos:
- En producción, `sellers` no tiene a Fabricio duplicado (eso era del sandbox).
- Las 4 cuentas de usuario del POS en producción son ADMIN.

## Respuesta a cada ajuste de la vendedora

| # | Ajuste pedido | Decisión | Motivo / forma |
|---|---|---|---|
| 1a | Ninguna lectura del láser se escribe en un campo (peso, precio, cantidad, "sin precio", ajustar stock); avisar "Termina primero…" | **Aceptado** | Lo comprobó en el sandbox: es un bug real de mi plan, que apagaba el láser mientras se pesaba. En lugar de apagarlo, el detector reconoce la ráfaga también dentro de los inputs marcados con `data-scan-guard`, borra lo escrito y cancela el Enter. Productos marca con `data-scan-guard` todos sus campos numéricos (MoneyInput ya lo trae). |
| 1a' | Dejar en cola el producto escaneado durante el peso | **Aceptado con cambio** | Cola de un solo elemento: el último escaneo se agrega al cerrar el cuadro. Si es más, se descarta con aviso. |
| 1b | Sonido o vibración en cada lectura; "No encontrado" en rojo y con otro sonido | **Aceptado** | Lo hace el coordinador en Venta. En Productos el aviso es visible y en rojo. |
| 1c | Escanear estando en Caja lleva a Venta | **Aceptado con cambio** | Solo si no hay ningún campo con foco ni un cuadro abierto. Si los hay, aviso "Estás en Caja". |
| 1d | Cámara continua con "Listo" y contador | **Aceptado** | (2.6) |
| 2a | El aviso de carrito recuperado muestra qué productos y qué total | **Aceptado** | |
| 2b | "Empezar de cero" se puede deshacer | **Aceptado** | Mismo "Deshacer" de 5 s que vaciar el carrito. |
| 2c | "Dejar en espera" (un carrito) | **Aceptado con cambio** | Un solo carrito en espera, guardado en `localStorage`. Fase 2. |
| 3a | Total y Confirmar fijos abajo | **Aceptado** | Entra en 1.6. |
| 3b | Los billetes suman ("Recibido $15.000" + Borrar) | **Aceptado** | Entra en 1.6. "Exacto" reemplaza; los billetes suman. |
| 3c | Banda grande del vuelto en la fase 1 | **Aceptado** | Se mueve de 2.6 a 1.6. |
| 3d | Referencia opcional en Transferencia | **Aceptado con cambio** | Campo opcional en `sale_payments.reference` que no bloquea. Fase 2, adelantado desde 3.7. |
| 4a | "No sé el precio" en la hoja "sin precio" | **Aceptado** | No agrega el producto; este queda en el filtro "Sin precio". |
| 4b | Quién puso el precio y "Precios cambiados hoy" | **Aceptado** | Sin cambio de esquema: cada cambio de precio u oferta desde el POS se registra en `audit_logs` (`action: products.save`, `details.cambiosDePrecio: [{campo, antes, despues}]`), el mismo formato que ya usa OlivoWeb. El actor es quien atiende más la sesión. La lista lee los de hoy. (No sirve `products.verified_at`: en OlivoWeb significa "contado en góndola".) |
| 4c | Topes absolutos: precio > $100.000 o cambio > 50 % o < $50 confirman; peso > 20 kg confirma; un producto nuevo también tiene tope | **Aceptado** | |
| 5a | Un segundo escaneo con el precio seleccionado no se escribe en el precio | **Aceptado** | Abre la ficha del otro producto. Si había cambios sin guardar, primero avisa "No guardaste Coca lata: Guardar / Descartar". |
| 5b | Confirmación grande "✓ Coca lata $1.000 → $1.100" y "Deshacer el último" en Lista de precios | **Aceptado** | "Deshacer" hace un PATCH de vuelta, con `expected`. |
| 5c | Motivos "Devolución a proveedor" y "Consumo del local" | **Aceptado** | |
| 5d | Costo cargable en Recepción por vendedoras, sin ver el margen | **Aceptado con cambio** | Por defecto el costo es solo ADMIN (decisión del dueño). Queda preparado como opción del dueño para la fase 2 (2.4). Hoy las 4 cuentas de producción son ADMIN, así que en la práctica ya pueden. |
| 5e | Cada rol ve solo sus filtros | **Aceptado** | "Sin costo" solo para ADMIN. |
| 6 | Lápiz: aviso "cambia el precio para todos", quién lo cambió y que el dueño decida sobre "precio solo para esta venta" | **Aceptado** | El aviso y "quién" entran en 2.4 (con 4b). El precio por venta queda como **pregunta abierta al dueño**. Por defecto no existe: con 2.5 el servidor lo rechazaría. |
| 7a | Nombre visible en "Cobrar · Mariana" y en la banda del vuelto | **Aceptado** | (2.1, coordinador) |
| 7b | "¿Sigues tú?" en la fase 2, en el primer escaneo después de 30 min | **Aceptado** | Se adelanta desde 3.11. |
| 7c | Lista con solo las 5 personas | **Aceptado** | Es limpieza de datos del dueño. En producción no hay duplicado de Fabricio. |
| 7d | "¿Cuánto dejas para mañana?" en el cierre y usarlo al abrir | **Aceptado con cambio** | Se guarda en las `notes` del cierre con formato `Deja para mañana: $X` y lo lee la apertura. Una columna dedicada sería mejor (migración M2b opcional). Lo hace el agente de Caja. |
| 8 | Compras sin dueño con fecha, hora, productos y quién atendía; botón "No sé"; no urgente | **Aceptado** | Baja al final de la lista. La tarjeta solo aparece en Turno y se puede plegar. |
| 9a | Comparación solo en Resumen, con la diferencia en palabras y "Volver a contar" | **Aceptado** | |
| 9b | Compras propias por cobrar y "deja para mañana" en el resumen y el PDF | **Aceptado** | (Caja) |
| 9c | "Traer transferencias del POS" | **Aceptado** | |
| 10a | "Anotar fiado" en el momento, que no viva solo en el teléfono; ver cuánto debe | **Aceptado con cambio** | Requiere escribir `account_entries` fuera del cierre, porque hoy `registrar_cierre` borra y reinserta las del turno. Hace falta cambiar el RPC o agregar una marca de origen: lo coordina el agente de Caja con OlivoWeb. Mostrar la deuda sí entra en 2.9. |
| 10b | Fiado como medio de pago en la venta | **Aceptado con cambio** | Sigue en la fase 3 (3.9), primero en esa lista, porque necesita esquema. |
| 11a | "Anular y corregir" recarga el carrito | **Aceptado** | (2.8) |
| 11b | "Devuelve $X al cliente" | **Aceptado** | |
| 11c | "Pedir anulación al admin" pasados 30 min | **Aceptado con cambio** | Marca en `notes` y aviso en la lista del admin, sin esquema. |
| 11d | Ventas del turno muestran método y primeros productos | **Aceptado** | |
| 12 | Conteo de góndola en la fase 2; si no, confirmar escribiendo el número | **Aceptado** | Pasa a 2.14, porque la base ya lo soporta. La confirmación escribiendo el número entra ya, en la fase 1, y es S. |
| F5 | Accesos rápidos para lo que no tiene código (pan, plátano…) | **Aceptado con cambio** | Fase 2: fila de favoritos con los productos por peso o sin código más vendidos. |
| F6 | Tipear la cantidad en el carrito | **Aceptado** | (2.6) |
| F10 | Recepción con la cámara plegada | **Aceptado** | (2.6) |
| F11 | Aviso grande "Sin conexión" | **Aceptado** | Banda ámbar fija. Coordinador. |
| F12 | Boleta o comprobante | **Rechazado por ahora** | Fuera del plan (implica al SII). Queda como pregunta al dueño. |
| — | Bajar la prioridad de 1.9 y 2.5 | **Aceptado** | |

## Orden final acordado (combina mi orden de PRs con su prioridad)

1. **1.0** Hotfix de productos. **Hecho** (PR #9, `088bdcb`).
2. Base común: `num.ts`, `MoneyInput`, vitest y CI. **Hecho** (`53efa37`).
3. **1.2** Láser en Venta, con `data-scan-guard`, sonido y "No encontrado". *Coordinador*
4. **1.6** Cobro: sigue al total, billetes que suman, Total y Confirmar fijos, banda del vuelto. *Coordinador*
5. **1.7** Carrito persistente (+ deshacer). *Coordinador*
6. **1.4** Topes de precio y peso: Productos *(yo)*, peso *(coordinador)*.
7. **1.5** Nada a $0: PriceSheet con "No sé el precio" *(coordinador)* y creaciones rápidas con precio *(yo)*.
8. **1.3** Sucursal y turno + M1. *Caja*
9. **1.10** Hora real y venta que no se pierde con sesión vencida. *Coordinador*
10. **2.1** ¿Quién atiende? + cerrar sesión + nombre en Cobrar + "¿Sigues tú?". *Coordinador*
11. **1.1 + 2.2 mínimo + 2.3** Productos: PATCH, alta con insert, ficha fresca, precio seleccionado y Enter guarda, Ajustar stock con motivo, filtros con Inactivos y Reactivar, oferta visible, Lista de precios con deshacer, "Precios cambiados hoy". *Yo*
12. **1.8** Caja → Turno bien calculado. *Caja*
13. **2.8** Anular venta con "Anular y corregir". *Caja*
14. **2.7** Cierre que compara + "deja para mañana" + compras por cobrar en el PDF. *Caja*
15. Confirmación escribiendo el número al cerrar un conteo que pone productos en 0 (S) → luego **2.14** conteo de góndola.
16. 2.6 resto (botones grandes, cantidad tipeable, cámara continua, Recepción plegada, accesos rápidos, en espera).
17. 2.9 fiados (+ deuda visible; "Anotar fiado" según el RPC).
18. 2.12 movimientos · 2.4 editar desde venta y recepción (+ costo en Recepción si el dueño lo habilita) · 2.10/2.11/2.13 · 1.9 compras sin dueño · 2.5 precios en el servidor.
19. Fase 3: 3.9 fiado en la venta, 3.2 (solo si el dueño cambia de opinión), 3.4 a 3.8, M4 historial de precios.

## Reparto
- **Coordinador:** Venta: 1.2, 1.5 (lado venta), 1.6, 1.7, 1.10, 2.1, 2.5, 2.6, WeightPrompt.
- **Agente de Caja:** 1.3, 1.8, 1.9, 2.7, 2.8, 2.12, fiados.
- **Ingeniero (yo):** Productos: 1.1, creaciones rápidas, 2.2, 2.3, topes de precio y "Precios cambiados hoy". Archivos: `ProductosMode` y `components/operaciones/productos/*`, `QuickCreate*Modal`, `services/products.ts`, `api/products/**`, `api/inventario/buscar`, `useProductCatalog`, `lib/offline/db.ts` (solo `cacheProduct`) y `types/index.ts` (solo agregar).
