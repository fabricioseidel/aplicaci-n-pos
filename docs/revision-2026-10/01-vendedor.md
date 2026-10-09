# Informe de jornada: Camila (vendedora de mostrador), Olivo POS

**Fecha de prueba:** 01-10-2026 (sandbox local, base Postgres copia de producción, 170 productos reales).
**Cómo lo usé:** Playwright con Chromium, perfil Pixel 7 (412×839), locale es-CL, zona America/Santiago. También revisé 360×740. Simulé el escáner láser con `keyboard.type(código)+Enter` y miré cada captura.
**Usuario:** vendedor@olivo.test ("Camila Vendedora"). Usé admin@olivo.test como "segundo equipo" en dos pruebas (venta #9 y la comparación de vistas).
**Capturas:** `/tmp/claude-0/-home-user/c1215d25-32f0-5577-bb27-55af33782d5f/scratchpad/sandbox/shots/vendedor-*.png` (en el texto abrevio la ruta como `shots/vendedor-NN-….png`).

> Nota sobre la base: es compartida. El coordinador registró las ventas #1 y #5 (compra propia de Mariana, por cobrar, $1.125 c/u). Reseteé la base solo al principio. Las ventas #2, #3, #4, #6, #7, #8 y #12 a #15 son mías. La #9 la hice como admin desde el segundo equipo.

---

## 1. Resumen de la jornada

| Tarea | Qué hice | Toques / pantallas (medidos) | Veredicto |
|---|---|---|---|
| Entrar | Login | 2 campos + 1 toque, ~4 s | OK |
| Abrir caja con $30.000 | Venta → "Ir a abrir la caja" → borrar el 10000 precargado → tipear → Abrir turno → volver a Venta | 4 toques + 5 borrados + tipeo | Se entiende, pero **la primera vez en un teléfono nuevo la caja queda sin sucursal** (#3). Si tipeo "30.000", abre con **$30** (#9). |
| Venta 1 producto, efectivo con vuelto | Escanear Pepsi lata y pagar con $5.000 | Con láser: cámara (1) + escaneo + carrito (1) + $5k (1) + Confirmar (1) = **4 toques** | Funciona. El vuelto ($4.000) no queda visible después de confirmar. |
| 3 bebidas iguales | Escanear 3 veces o usar "+" en el carrito | 3 escaneos (3 toques de cámara) o 2 toques en "+" de 24×36 px | Funciona, pero los botones son chicos y **el monto a pagar se queda pegado en el primer producto** (#5). |
| Buscar por nombre | "papas marco", "doritos", "queso", "platano" | 1 toque + tipeo + 1 toque | Muy buena búsqueda por palabras sueltas y sin tildes. |
| Producto por peso | Queso semiduro 350 g, plátano 1.200 g | buscar + tarjeta + gramos + Agregar | Muy bien: se pide en gramos, con atajos y subtotal en vivo (350 g × $11.400 = $3.990, coincide con la base). |
| Quitar un producto / vaciar | X del producto, basurero del carrito | 1 toque cada uno | Funciona, pero **vaciar no pide confirmación** y el ícono mide 16×24 px. |
| Tarjeta | Elegir método + tipear el total a mano | 2 toques + borrar + tipeo | Molesto: con tarjeta no aparece "Exacto". |
| Transferencia | Elegir "Transf." | 2 toques | No pide comprobante ni referencia. Queda "verified". |
| Pago mixto efectivo + tarjeta | $5k + "Añadir pago" (propone el saldo) + tarjeta | 4 toques | **Muy bien**: se guardó bien en `sale_payments`. Pero la pantalla de Caja lo cuenta todo como efectivo (#7). |
| Doble toque en Confirmar | `dblclick` | n/a | **No duplica.** Bien. |
| Fiado / descuento | n/a | n/a | En la venta no hay fiado ni descuento. Solo existe "Compra propia −25%". |
| Producto que no existe | Escanear código desconocido → Crear → nombre y precio | 2 toques + tipeo | **Bien**: el carrito se mantiene. |
| Corregir un precio en medio de una venta | Ir a Productos y volver | n/a | **Se pierde el carrito entero** (#6). |
| Recargar / sin internet | Recargar con carrito; `setOffline(true)` y vender | n/a | Al recargar se pierde el carrito. Sin red, la venta se guarda ("1 pendiente") y se sincroniza sola. Bien. |
| Editar precio (Productos) | Buscar o escanear → tocar → precio → Guardar | **5 toques + borrar + tipeo, ~10–15 s por producto** | Rápido, pero **borra el costo y el stock mínimo, y puede revertir el stock** (#1). |
| Lista nueva de 5 precios | Cinco ediciones seguidas | 25 toques | Los 5 productos quedaron con **costo $0**. |
| Recepción de proveedor | 12 Coca lata, 6 Pepsi 1.25, 24 Oreo (nuevo) | ~20 toques (10 de "+") | El stock queda bien. No pide costo ni proveedor, y el producto nuevo queda a **$0** (#8). |
| Egreso / ingreso de caja | Pago al proveedor $15.000, ingreso $5.000 | 2–3 campos + 1 toque | Funciona. No pide confirmación y no se puede borrar un movimiento. |
| Historial / anular venta | n/a | n/a | El historial es de cierres, no de ventas. **No se puede anular una venta** (#11). |
| Fiados | Don Pedro se lleva $3.500 y Señora Rosa abona $2.000 | Solo se puede en el paso "Fiados" del cierre | Se creó una cuenta duplicada "don pedro" y se aceptó el abono de alguien que no debía (#12). |
| Conteo de góndola | Coca lata y Pepsi lata | Empezar + 5 escaneos + cantidades + Guardar | Quedó anotado, pero **una vendedora no puede aplicar un conteo parcial** (#13). |
| Cierre del día | 5 pasos: efectivo (billetes), transferencias, vouchers, fiados, resumen; PDF | ~25 toques | Claro y ordenado, con un **PDF de 58 mm muy legible**. **No me muestra el descuadre contra lo que registró el POS** (#10). |
| Cambio de turno / cerrar sesión | Volver a abrir la caja como "otra vendedora" | n/a | **No hay cerrar sesión ni forma de decir quién atiende** (#4). |

---

## 2. Hallazgos

### BLOQUEANTE

**1. [BLOQUEANTE] Productos: editar solo el precio borra el costo y el stock mínimo, y revierte el stock al número viejo de la pantalla.**
- **Pasos:** Productos → escanear 7801610001196 (Coca-Cola Lata) → precio 1000→1100 → Guardar.
- **Esperaba:** que cambiara solo el precio.
- **Pasó:** también se borraron el costo (571,43 → 0), `min_stock` (5 → NULL) y `optimum_stock` (20 → NULL). Lo mismo pasó con Pepsi lata (487,39 → 0), con los 5 productos de la "lista nueva" (Cachantun 782, Mantequilla 1000, Azúcar 597, Papel Scott 831,93 → todos 0), con "Correa anti-tirones" (2500 → 0) y con "Pepsi Zero 3L" (1638,66 → 0).
- **Stock pisado:** abrí la ficha de Pepsi lata cuando tenía stock 17. Desde el otro equipo (admin) vendí 2 y el stock quedó en 15. Guardé solo el precio y **el stock volvió a 17**. La base registró un `MANUAL_ADJUSTMENT IN 2` que nadie hizo.
- **Evidencia:** `select purchase_price,min_stock from products where barcode='7801610001196'` → `0 | NULL` (el seed tenía `571.43, 5`). En `inventory_movements` de 7801620852689 quedan `OUT 2 SALE` y luego `IN 2 MANUAL_ADJUSTMENT`.
- **Captura:** `shots/vendedor-37-editar-producto.png`
- **Causa:** el formulario no tiene campos de costo ni de mínimos, pero igual los envía en 0/null. Además envía el stock en pantalla como ajuste absoluto.

**2. [BLOQUEANTE] Venta: con el escáner láser se cobra el producto equivocado, y sin foco no pasa nada.**
- **Pasos:**
  - (a) En Venta, sin tocar nada, escanear 7801610001196 + Enter: no pasa nada, ni siquiera un aviso.
  - (b) Tocar el buscador y escanear: el código queda escrito y aparece la tarjeta, pero Enter no la agrega. Hay que tocarla y después limpiar el buscador.
  - (c) Después de tocar la tarjeta de Coca, escanear una **Pepsi** (7801620852689) + Enter: **se agregó otra Coca**. El Enter del lector "presiona" la tarjeta que quedó con el foco.
- **Esperaba:** que escanear en la pantalla de venta agregara el producto escaneado, como pasa en Recepción.
- **Pasó:** el láser solo funciona con el modal de cámara abierto, y el modal se cierra después de cada lectura: un toque por producto, y en el teléfono se prende la cámara cada vez.
- **Evidencia:** venta #2 con `7801610001196 qty 3` cuando escaneé 2 Cocas y 1 Pepsi.
- **Capturas:** `shots/vendedor-07-laser-sin-foco.png`, `shots/vendedor-08-laser-buscador.png`, `shots/vendedor-11-carrito.png`

**3. [BLOQUEANTE] Caja: la primera vez que se entra en un teléfono, la caja se abre sin sucursal, y al recargar "desaparece" y se abre otra.**
- **Pasos:** teléfono nuevo (sin datos guardados) → login → abrir caja con $30.000 → recargar la app.
- **Esperaba:** que la caja siguiera abierta.
- **Pasó:** después de recargar dice "La caja está cerrada", así que la abrí de nuevo. Quedaron **2 turnos abiertos de $30.000**. El primero no tiene sucursal y contiene ventas (#2 por $3.000 en efectivo y #1 del coordinador) que **no salen en el cierre de "Principal"**. En el login se ve `GET /api/branches 401` y después del login no se vuelve a pedir. El login navega con `router.replace`, así que el proveedor de sucursales no se recarga.
- **Evidencia:** `cash_shifts`: e42aab82… `branch_id NULL, OPEN` y c77abbad… `Principal`. El turno e42 sigue abierto con 2 ventas por $4.125.
- **Capturas:** `shots/vendedor-04-caja-abierta.png`, `shots/vendedor-05-tras-recargar.png`

**4. [BLOQUEANTE para un teléfono compartido] No hay "cerrar sesión" ni forma de decir quién atiende.**
- **Pasos:** buscar cómo salir o cambiar de usuario en todas las pestañas (en el código no hay ningún `signOut`).
- **Pasó:** en el local un mismo teléfono lo usan María, Mariana, Fabricio, Alfredo e Ingrid con la sesión de quien abrió la caja. **Todas las ventas, recepciones y conteos quedan a nombre de Camila.** El "cambio de turno" es cerrar la caja y volver a abrirla con la misma sesión. Solo la "Compra propia" pregunta de quién es.
- **Evidencia:** todas mis ventas tienen `seller_id = 3333… (Camila)`. Las recepciones quedan con `created_by NULL`.

### ERROR

**5. [ERROR] Venta: el monto a pagar se queda pegado en el precio del primer producto.**
- **Pasos:** agregar Coca ($1.000) y después 2 más, o agregar otros productos → abrir el carrito.
- **Esperaba:** que el efectivo propuesto fuera el total.
- **Pasó:** el campo sigue en 1000 y aparece "FALTA $2.000" (o $3.920, $4.080…) con Confirmar deshabilitado. Hay que tocar "Exacto" o tipear.
- **Con tarjeta:** no existe "Exacto", así que en **cada** venta con tarjeta hay que borrar y tipear el total.
- **Con compra propia:** aparece un "VUELTO $275" fantasma porque el monto quedó con el precio sin descuento.
- **Capturas:** `shots/vendedor-11-carrito.png`, `shots/vendedor-19-carrito-3items.png`, `shots/vendedor-20-tarjeta.png`, `shots/vendedor-49-compra-propia.png`

**6. [ERROR] Venta: el carrito se pierde al cambiar de pestaña o al recargar.**
- **Pasos:** carrito con 2 productos → pestaña Productos (por ejemplo, para corregir un precio) → volver a Venta. O recargar o reabrir la app.
- **Pasó:** el carrito queda vacío. Corregir un precio en medio de una venta obliga a volver a escanear todo, y un corte de luz o un reinicio del teléfono borra la venta en curso.
- **Captura:** `shots/vendedor-35-tras-recarga.png`

**7. [ERROR] Caja → Turno: "Ventas efectivo" y "Esperado en caja" están mal con pagos mixtos, y "Total ventas" incluye compras por cobrar.**
- **Pasos:** venta #6 de $8.070, pagada con $5.000 en efectivo y $3.070 con tarjeta → Caja → Turno.
- **Esperaba:** ventas en efectivo $13.525 y esperado $43.525 (antes de los movimientos).
- **Pasó:** "Ventas efectivo" muestra la venta mixta completa como efectivo (**+$3.070 de más**). El esperado salió $46.595. "Total ventas" suma la compra propia por cobrar ($1.125), que no es plata.
- **Evidencia:** `sale_payments` de la venta #6 = CASH 5000 + CARD 3070. El cierre del servidor calculó bien (`pos_totals.CASH = 13525`); la pantalla de Turno no.
- **Captura:** `shots/vendedor-27-caja-turno.png`

**8. [ERROR] Productos a $0: se regalan, o salen con un error técnico.**
- **Pasos:** en Recepción, crear "Galletas Oreo Original 118g" (la recepción no pide precio, queda en $0) → venderla.
- **Pasó:**
  - Sola: el botón Confirmar está activo con "CUADRADO $0" y el error dice `APPLY_SALE FALLÓ: NEW ROW FOR RELATION "SALE_PAYMENTS" VIOLATES CHECK CONSTRAINT…`.
  - Junto a una Coca: **la venta pasó con la Oreo a $0** (venta #12).
- **Evidencia:** `sale_items` de la venta #12: `Galletas Oreo … unit_price 0`.
- **Capturas:** `shots/vendedor-47-venta-precio-cero.png`, `shots/vendedor-48-error-venta-cero.png`

**9. [ERROR] Precios y montos tipeados con punto de miles se guardan mal.**
- **Pasos:**
  - (a) Productos → precio "3.500" → Guardar. Se guardó **$3,5** y en la lista se ve "$ 4", sin ningún aviso.
  - (b) Abrir caja tipeando "30.000". El campo muestra "30.000", pero la caja se abrió con **$30**, y después no hay cómo corregir el fondo inicial (tuve que hacer un "Ingreso" de $29.970).
- **Evidencia:** `products.sale_price = 3.5` en 805026003505 (después lo corregí a 3500). `cash_shifts.bdd5a705… starting_cash = 30.00`.
- **Captura:** `shots/vendedor-80-turno-abierto-con-30.png`

**10. [ERROR] Cierre: no me dice si cuadra con lo que vendí.**
- **Pasos:** completar el cierre (contado $33.500, transferencia $1.500, voucher $7.570, fiado $3.500, abono $2.000) → Resumen → Registrar.
- **Esperaba:** ver "el POS registró $13.525 en efectivo, tú declaraste $X, diferencia $Y" **antes** de confirmar.
- **Pasó:** el resumen solo repite lo que declaré. En la base, `difference = 0.00`. La comparación ("Lo que registró el POS": CARD/CASH/TRANSFER/STAFF_CREDIT, códigos en inglés) aparece **recién después**, en Historial, y con un texto que dice que la diferencia "es esperable".
- El paso de transferencias tampoco trae las que ya registré en el POS (hay que tipearlas de nuevo).
- "Registrar cierre" no pide confirmación.
- **Capturas:** `shots/vendedor-72-cierre-resumen-full.png`, `shots/vendedor-85b-historial-pos.png`

**11. [ERROR] No se puede anular ni corregir una venta mal hecha.**
- No hay ningún botón para hacerlo (tampoco en Historial, que solo muestra cierres). La lista "Ventas del turno" muestra número, hora y total, sin productos ni medio de pago, y no se puede tocar.
- **Captura:** `shots/vendedor-54-historial.png`

**12. [ERROR] Fiados: solo se anotan en el cierre, como un monto suelto, y se duplican clientes.**
- No hay "fiado" como medio de pago en la venta, así que lo que se lleva el cliente **no descuenta stock** y hay que acordarse hasta la noche.
- Escribí "don pedro" y se creó **otra cuenta** en vez de usar "Don Pedro (vecino)".
- Se aceptó un abono de $2.000 de "Señora Rosa", que no debía nada (quedó con saldo a favor sin aviso).
- La pestaña Fiados es solo para mirar: no se puede registrar ahí que alguien vino a pagar.
- **Evidencia:** `customer_accounts` tiene ahora "Don Pedro (vecino)" y "don pedro". En `account_entries`: CHARGE 3500 a "don pedro" y PAYMENT 2000 de "Señora Rosa".
- **Capturas:** `shots/vendedor-70-cierre-fiados-lleno.png`, `shots/vendedor-77-fiados-tras-cierre.png`

**13. [ERROR] Conteo: no se puede contar una góndola sola.**
- El conteo es de la tienda completa. Al cerrarlo (solo puede un admin), **"los 154 productos que nunca se escanearon quedan en 0"**.
- Mi conteo de 2 productos quedó anotado pero no aplicado. El modo "Al instante" advierte que se pierden las ventas que ocurran mientras se cuenta.
- **Evidencia:** `stock_count_sessions` ce647fd9… **sigue OPEN** (ver "Estado que dejé").
- **Capturas:** `shots/vendedor-56-conteo.png`, `shots/vendedor-59-conteo-guardado.png`

**14. [ERROR] Desactivar un producto lo hace desaparecer, y "Crear" con un código que ya existe pisa el producto.**
- **Desactivar:** desactivé "Correa anti-tirones" y ya no se encuentra en ninguna pestaña, así que no hay cómo reactivarla.
- **Escanear un inactivo en Venta:** con "Monster ripper" la app dice "No encontrado" y ofrece "Creación rápida".
- **"Nuevo" con un código existente:** "Nuevo" con 805026003505 (Pepsi Zero 3L, inactivo) dijo **"Producto creado"**, pero en realidad sobrescribió el existente y le borró la categoría, la foto, el costo y el mínimo.
- **Evidencia:** `805026003505 | category NULL | image_url NULL | purchase_price 0`.
- **Capturas:** `shots/vendedor-40-desactivado-no-aparece.png`, `shots/vendedor-63-inactivo-escaneado.png`

### MOLESTO

15. **[MOLESTO] Venta: botones y textos muy chicos para un mostrador.** Medidas reales:
    - "+/−" del carrito: 24×36 px.
    - Quitar producto (X) y vaciar carrito: 16×24 px.
    - Atajos $1k/$2k/$5k/$10k/Exacto: 31×28 px con letra de 9 px.
    - "← Productos": 88×15 px.
    - Etiquetas de las pestañas: letra de 8 px.

    En la grilla de 3 columnas los nombres se cortan ("Coca-Cola Lata Ori…", "Pepsi Original L…") y no se distinguen variantes. Capturas: `shots/vendedor-19-carrito-3items.png`, `shots/vendedor-60-360-venta.png`.
16. **[MOLESTO] Venta: vaciar el carrito no pide confirmación ni se puede deshacer.** El basurero está al lado del título del carrito. Captura: `shots/vendedor-29-vaciar-carrito.png`.
17. **[MOLESTO] No se puede tipear la cantidad, ni en el carrito ni en Recepción.** 12 Cocas en Recepción fueron 2 escaneos + 10 toques en "+". Para 24 unidades serían 23 toques. Captura: `shots/vendedor-45-recepcion-lista.png`.
18. **[MOLESTO] Venta: después de confirmar no queda visible el vuelto.** El aviso solo dice "✓ Venta registrada", sin vuelto ni número de venta, y el buscador queda con la última búsqueda escrita. Captura: `shots/vendedor-17-tras-venta.png`.
19. **[MOLESTO] Venta: errores de monto sin alerta.**
    - Si tipeo 45000 con tarjeta para una venta de $4.500, dice "CUADRADO $0" y Confirmar queda gris sin explicar por qué.
    - Si tipeo 200000 por error en efectivo, muestra "VUELTO $199.000" sin ninguna alerta.
    - Los atajos llegan a $10k; falta $20k, el billete grande más común.
    - Captura: `shots/vendedor-30-billete-grande-error.png`.
20. **[MOLESTO] Peso: tipear "0.35" (en kilos) en el campo de gramos agrega 0,35 g por $4 sin avisar.** Captura: `shots/vendedor-24-peso-0.35.png`.
21. **[MOLESTO] Crear un producto desde la búsqueda por nombre ("pan amasado") pone el nombre en el campo de código de barras y deja el nombre vacío.** Captura: `shots/vendedor-34-crear-desde-nombre.png`.
22. **[MOLESTO] Las ofertas no se notan y "ganan" sin que se vea.**
    - Marraqueta: precio 330, se vende a 300.
    - Mantequilla: subí el precio de 1.840 a 1.890 y en la venta sigue saliendo a $1.800 por una oferta antigua.
    - Ni la grilla ni la lista de Productos marcan que es una oferta.
23. **[MOLESTO] Los avisos (toasts) se apilan y tapan el área de pago.** Pasa al agregar 3 productos seguidos. Captura: `shots/vendedor-61-360-carrito.png`.
24. **[MOLESTO] Movimientos de caja: un egreso mal hecho no se puede borrar y no se pide confirmación.** A 360 px el selector de método (EFECTIVO) se sale de la pantalla. Captura: `shots/vendedor-83-360-caja-turno.png`.
25. **[MOLESTO] Abrir caja: varias trabas pequeñas.**
    - El campo trae 10000 escrito y al tocarlo no se selecciona: quedó "1003000000".
    - No hay atajo de $30k.
    - Después de abrir, la app no vuelve sola a Venta.
    - En el cambio de turno no propone el efectivo que quedó en el cierre anterior.
    - Captura: `shots/vendedor-03-caja-tipeo.png`.
26. **[MOLESTO] Conteo: el mismo código escaneado dos veces en menos de 600 ms se cuenta una sola vez.** Escaneé 3 latas rápido y contó 1.
27. **[MOLESTO] Recepción: la cámara ocupa media pantalla y el botón fijo "Confirmar recepción" tapa los "+/−" del primer producto.** Captura: `shots/vendedor-43-recepcion-item.png`.
28. **[MOLESTO] Mensajes técnicos o en inglés.**
    - "REQUESTED DEVICE NOT FOUND" cuando falla la cámara.
    - "APPLY_SALE FALLÓ: NEW ROW FOR RELATION…".
    - "CASH/CARD/TRANSFER/STAFF_CREDIT" en Historial.
    - En el PDF, la hora "3:58:42 p" queda cortada.
29. **[MOLESTO] Un producto sin stock se puede vender (bien), pero el stock no queda negativo: se queda en 0 sin avisar.** Plátano tenía 0, vendí 1,2 kg y siguió en 0, así que se pierde el dato de que vendí más de lo que había.
30. **[MOLESTO] Transferencia: no pide comprobante, últimos dígitos ni nombre.** Queda marcada como "verified" automáticamente.

### SUGERENCIA

31. **[SUGERENCIA] Redondeo del efectivo (Ley 20.956).** Totales como $825 (compra propia) o $3.990 (queso) en efectivo deberían redondearse a la decena.
32. **[SUGERENCIA] Selector "¿Quién atiende?" con PIN** en la barra superior, para el teléfono compartido.
33. **[SUGERENCIA] Comprobante o boleta simple para el cliente,** compartible por WhatsApp o en la misma impresora de 58 mm.
34. **[SUGERENCIA] "Fiado" como medio de pago en la venta,** eligiendo al cliente de la lista, y "Abono" como acción directa en la pestaña Fiados.

### Lo que funciona bien
- **Pago mixto:** "Añadir pago" propone el saldo que falta y se guarda bien en `sale_payments`.
- **Doble toque:** no duplica la venta.
- **Sin internet:** la venta queda pendiente con el aviso "1 pendiente" y se sincroniza sola al volver la red.
- **Producto por peso:** se pide en gramos, con atajos, y el cálculo es exacto.
- **Creación rápida desde la venta:** pide lo justo y no pierde el carrito. El modal cabe con el teclado abierto.
- **Búsqueda:** por palabras sueltas y sin tildes, muy práctica ("papas marco", "coca lata").
- **Recepción:** el láser funciona sin tocar nada y se pueden crear productos con su cantidad. El stock y los movimientos quedan correctos en la base.
- **Cierre:** paso a paso, el conteo por billetes tiene botones grandes, el Historial con detalle está bien y el **PDF de 58 mm es claro**.
- **Compra propia:** el selector nuevo se entiende, los botones son grandes y obliga a elegir de quién es. Detalle: aparecen "Fabricio" y "Fabricio (admin)" como dos personas.
- **Ficha de producto:** cabe en una pantalla y la búsqueda se mantiene al volver, lo que ayuda a editar varios productos seguidos.

---

## 3. Edición de productos (prioridad del dueño)

**Cómo es hoy.** Productos → buscar o escanear (con el buscador tocado) → tocar el producto → ficha con código (bloqueado), nombre, categoría (texto libre), "se vende por peso", precio, precio oferta, stock, URL de imagen y "activo" → Guardar.
- Cambiar un precio: **5 toques + borrar el precio viejo + tipear, ~10–15 s**.
- Lista de 5 precios: **25 toques**.

**Lo que falta o está mal**
1. **No hay costo.** No se puede cargar ni ver, y encima cada vez que se guarda la ficha el costo queda en 0 (#1). Sin costo no hay margen.
2. **No hay stock mínimo ni óptimo,** y guardar los borra (#1).
3. **El stock es editable en la ficha y pisa el stock real** (#1). Debería verse solo para mirar, con un botón "Ajustar stock" que pida el motivo.
4. **El código no se puede corregir** ("identifica al producto en toda la base"). Si se cargó mal, no hay salida.
5. **La categoría es texto libre** ("Bebidas", "bebidas ", "Bebida"…). Existen 31 categorías y no se ofrecen en una lista.
6. **La foto es solo una URL.** En el mostrador nadie tiene una URL: quiero sacar la foto con la cámara.
7. **Los inactivos no aparecen,** así que no se pueden reactivar (#14).
8. **No hay filtros:** sin precio, sin costo (26 productos), sin categoría, sin foto, sin stock, bajo el mínimo, inactivos.
9. **No se puede editar desde la venta ni desde la recepción.** Corregir un precio en plena venta borra el carrito (#6). En Recepción no se carga ni el costo nuevo ni el precio.
10. **Formato de números:** "3.500" se guarda como $3,5 (#9). No hay aviso cuando el precio cambia mucho (de 3.500 a 4).
11. **La oferta no tiene fecha de término** y no se distingue del precio normal (#22).

**Cómo me gustaría que fuera**
- **Escanear desde Productos sin tocar nada** abre directo la ficha de ese producto. Si no existe, abre "Nuevo" con el código puesto. Si está inactivo: "Este producto está desactivado: ¿reactivar?".
- **Ficha corta arriba y más campos abajo:**
  - Arriba: nombre, **precio**, **costo** (con el margen % calculado al lado), por peso, activo.
  - Abajo (plegable): categoría con lista, stock mínimo, oferta con fecha de fin, foto con cámara, código editable (con confirmación).
- **Modo "Lista de precios":** escaneo → se abre solo el precio (y el costo), ya seleccionado → tipeo → Enter guarda y vuelve a esperar el siguiente escaneo. Debajo, una lista de lo cambiado: "Coca lata 1.000 → 1.100 ✓".
- **Lápiz en cada línea del carrito** para corregir el precio de ese producto (con PIN si hace falta), sin perder la venta.
- **Recepción con costo:** en cada línea, "costo unitario" (prellenado con el último) y, si sube, la pregunta "¿Actualizar precio de venta?" con un precio sugerido según el margen.
- **Guardar solo lo que cambié:** nunca tocar costo, stock ni mínimos si no los toqué.
- **Avisos:** "El precio cambió más de 30 %", "Precio en 0", "¿Quisiste decir $3.500?".
- **Lista de pendientes:** botón "Productos con problemas: 26 sin costo, 1 sin precio, N sin categoría".

---

## 4. Mi top 10 (en mis palabras de vendedora)

1. **Que cambiar un precio no me borre el costo ni me cambie el stock.** Hoy cada precio que arreglo le borra el costo al dueño y me puede descuadrar el inventario.
2. **Que el láser funcione en la pantalla de venta sin tocar nada,** y que nunca me cobre el producto anterior en vez del que escaneé.
3. **Que no se me borre la venta** si cambio de pestaña para arreglar un precio, si se recarga la app o si se corta la luz.
4. **Que la caja no se abra dos veces ni "desaparezca"** la primera vez que entro en un teléfono.
5. **Que el monto a pagar siempre sea el total** (también con tarjeta), y que después de cobrar me quede a la vista el vuelto.
6. **Poder decir quién está atendiendo,** con un PIN o nuestros nombres, y poder cerrar sesión. El teléfono lo usamos cinco personas.
7. **Que el cierre me diga si cuadra:** "el sistema registró $13.525 en efectivo y contaste $X, te faltan/sobran $Y", antes de apretar Registrar.
8. **Poder anular una venta mal hecha y anotar un fiado en el momento,** eligiendo al cliente de la lista, con los productos descontados del stock.
9. **Que no me deje vender a $0 y que entienda "3.500" o "30.000",** o que me avise.
10. **Botones más grandes (+, −, X, $20k) y poder tipear la cantidad** (24 unidades en Recepción no son 23 toques). También contar una sola góndola sin poner en cero el resto de la tienda.

---

## 5. Estado que dejé en el sandbox (para quien siga)
- **Turnos:**
  - e42aab82… OPEN **sin sucursal** (el huérfano de #3), con las ventas #1 y #2.
  - c77abbad… CLOSED (mi cierre del día).
  - bdd5a705… OPEN en Principal, abierto con **$30** por el error de #9, más un ingreso de corrección de $29.970 y la venta #15.
- **Conteo:** sesión ce647fd9… **OPEN** (ON_CLOSE) con 2 productos. **No cerrarla:** pondría 154 productos en 0.
- **Productos modificados:**
  - Coca lata (precio 1100) y Pepsi lata (precio 1100, stock revertido 15→17): costo en 0.
  - Pepsi 1.25 (1500), Cachantun (1450), Mantequilla (1890), Azúcar (1150), Papel Scott (1590): costo en 0.
  - "Correa anti-tirones" desactivada.
  - "Pepsi Zero 3L" reactivada y sobrescrita.
  - Nuevos: "Chocolate Sahne-Nuss 30g" (7801234567890) y "Galletas Oreo Original 118g" (7622300489434, **precio 0**).
- **Fiados:** cuenta duplicada "don pedro" con $3.500; "Señora Rosa" con saldo a favor de $2.000.
