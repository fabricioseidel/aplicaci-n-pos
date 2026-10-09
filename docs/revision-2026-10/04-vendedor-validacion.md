# Validación del plan: lo que opina Camila (vendedora)

Leí las secciones 2, 6 y 7 del plan (`03-ingeniero-plan.md`) y, para entender cada punto, también los ítems de las fases 1 a 3. Opino como vendedora: un día real, con fila de clientes y un solo teléfono para María, Mariana, Fabricio, Alfredo e Ingrid.

Comprobé una sola cosa en el sandbox, sin resetear y sin confirmar ventas:

> **Si el láser lee un código mientras está abierto el cuadro de peso, el código queda escrito como gramos.** Quedaron 7.801.610.001.196 g y un subtotal de **$88.938.354.013.634**. El Enter del lector lo agregaría al carrito.
>
> El plan apaga el láser mientras se pesa (`enabled = … && !weighing`), así que **esto seguiría pasando**.
>
> Captura: `shots/vendedor-90-laser-en-peso.png`

---

## Mi veredicto punto por punto

### 1. Escanear siempre funciona sin tocar nada; la cámara pasa a botón secundario en modo continuo
**Sí, pero…** Es lo que más necesito: hoy cobra el producto equivocado. Le pongo cuatro condiciones:
- **Con un cuadro abierto (peso, "sin precio", creación rápida, ajustar stock), una lectura del láser nunca debe escribirse en un campo.** Lo comprobé: hoy se escribe como gramos y Enter lo agrega.
  - El detector tiene que reconocer la ráfaga también dentro de esos campos y no escribirla.
  - Debe mostrar "Termina primero el peso del queso" y, mejor todavía, dejar ese producto en cola para agregarlo después.
  - Lo mismo vale para el precio ya seleccionado de la ficha y del modo "Lista de precios": un escaneo ahí no puede quedar como precio $7.801.610.001.196.
- **Que suene o vibre en cada lectura**, y que se vea grande qué entró ("+ Coca-Cola Lata · $1.100"). Con clientes hablando no miro el aviso chico de abajo. "No encontrado" tiene que ser distinto: otro sonido y en rojo.
- **Si escaneo estando en Caja, que me lleve a Venta con el producto agregado** (o que avise "Estás en Caja"). Pasa que estoy anotando un egreso y llega un cliente.
- **Cámara en modo continuo:** sí, con un botón grande "Listo" y un contador de lo que va entrando.

### 2. El carrito queda guardado ("Seguimos con la venta en curso (3 productos)" + "Empezar de cero")
**Sí, pero…**
- El aviso tiene que mostrar **qué productos y qué total**, no solo "3 productos", para saber si es el cliente que tengo delante o uno que se fue.
- "Empezar de cero" debe poder deshacerse unos segundos, igual que el vaciar carrito que propone el plan.
- **Me falta "Dejar en espera".** Un cliente se olvidó el pan y va a buscarlo; mientras, atiendo al siguiente. Con un carrito guardado en espera (aunque sea solo uno) basta.

### 3. Cobro con botones grandes; Tarjeta = 1 toque; billetes hasta $20k; el monto sigue al total; banda "Venta #N · Vuelto $X"
**Sí, pero…**
- **Total y Confirmar siempre visibles abajo, sin hacer scroll.** Hoy, con 3 productos, el botón Confirmar ya queda fuera de la pantalla. El plan no lo menciona y me parece clave.
- **Los billetes deberían sumarse.** Si el cliente paga con un billete de $10.000 y uno de $5.000, toco $10k y $5k y queda "Recibido $15.000", con un botón "Borrar". Si cada toque reemplaza al anterior, voy a tener que tipear.
- **La banda del vuelto:** sí, grande ("Recibió $5.000 · Total $1.000 · **Vuelto $4.000**"), y que dure hasta el siguiente escaneo, como dice el plan. Es lo que más me salva cuando el cliente pregunta "¿cuánto me tenía que dar?".
- **Transferencia:** el toque está bien, pero me gustaría un campo opcional "nombre o últimos 4 dígitos" (el plan lo deja para la fase 3.7). No debe bloquear la venta.
- **La alerta "¿Recibiste $200.000?":** sí.

### 4. Producto sin precio se pide ahí; un cambio de más del 50 % pide confirmar; "3.500" y "30.000" se entienden
**Sí, pero…**
- La hoja "sin precio" necesita un **"No sé el precio"** que no agregue el producto, para preguntarle al dueño. Ese producto queda en el filtro "Sin precio".
- Cuando una vendedora pone un precio desde la caja, debe quedar anotado **quién lo puso** y aparecer en una lista "Precios cambiados hoy" que vea el dueño.
- **El aviso del 50 % no cubre todo:**
  - Un producto nuevo o sin precio no tiene "antes" con qué comparar.
  - El peso no tiene ningún tope.
  - Pido además topes absolutos: precio mayor que $100.000 → confirmar; peso mayor que 20 kg → confirmar. Eso ataja el código escrito por error en un campo.
- **"0,35" en el peso → "= 350 g":** perfecto.

### 5. Ficha nueva: precio grande ya seleccionado; escanear → tipear → Enter guarda; stock solo para mirar con "Ajustar stock" y motivo; filtros; modo "Lista de precios"
**Sí, es lo que más va a agradecer el dueño, pero…**
- **Mismo riesgo que en el punto 1:** con el precio seleccionado, un segundo escaneo no puede escribirse en el precio. Debe abrir la ficha del otro producto o avisar "No guardaste Coca lata".
- **Enter guarda:** sí, con una confirmación grande y clara ("✓ Coca lata $1.000 → $1.100"). En "Lista de precios" quiero además un **"Deshacer el último"**.
- **Motivos de "Ajustar stock":** agregaría **"Devolución a proveedor"** y **"Consumo del local"**. Las vendedoras sí devolvemos mercadería al camión.
- **Costo solo para el admin:** lo acepto. Pero **las facturas las recibimos nosotras.** Si el costo no se puede cargar en Recepción, nunca se va a cargar. Pido que el dueño habilite el costo **solo en Recepción**, sin mostrarnos el margen.
- **Filtros:** que cada rol vea solo los suyos. "Sin costo" no me sirve si no puedo cargarlo. "Sin precio", "Inactivos" y "Con oferta" sí.

### 6. Lápiz en cada línea del carrito para corregir el precio de la ficha sin perder la venta
**Sí, pero con cuidado.** En el mostrador pasan dos cosas distintas:
- *"La etiqueta de la góndola dice $900 y el sistema $1.000"*: corregir la ficha. El lápiz sirve para esto.
- *"¿Me lo deja en $800?"*: un descuento, que no existe.

Si el lápiz cambia la ficha **para siempre** y no hay descuentos, alguien lo va a usar como descuento y el precio va a quedar mal para todos los clientes siguientes. Pido tres cosas:
- Que la hoja diga clarito **"Esto cambia el precio para todos: $1.000 → $900"**.
- Que quede quién lo cambió, en la lista "Precios cambiados hoy" del punto 4.
- Que **el dueño decida** si quiere un "precio solo para esta venta" con motivo y visible en el cierre, o si lo prohíbe y lo dice claramente.

### 7. Chip "👤 Mariana ▾": cambiar de persona en 2 toques, sin PIN; se pregunta al entrar, al abrir y al cerrar caja; "Cerrar sesión" bloqueado si hay pendientes
**Sí, sin PIN.** Estoy de acuerdo: el PIN nos frena y entre nosotras nos conocemos. Pero…
- **El problema real va a ser olvidarse de cambiar el chip.** Mariana va a vender toda la tarde como "Camila". Que el nombre aparezca en el botón ("**Cobrar · Mariana**") y en la banda del vuelto, así lo veo en cada venta. El "¿Sigues tú?" después de 30 minutos sin uso lo subiría a la fase 2, siempre que pregunte en el primer escaneo después de la pausa y no a mitad de una venta.
- **La lista de nombres tiene que ser solo las 5 personas.** Hoy aparecen "Fabricio" y "Fabricio (admin)", "Camila Vendedora", etc. Es limpieza de datos que tiene que hacer el dueño.
- **El efectivo propuesto al abrir no puede ser "lo que se contó ayer" ($33.500).** El dueño saca la plata del día y deja el sencillo. **Falta una pregunta en el cierre: "¿Cuánto dejas en la caja para mañana?"**, y ese es el número que se propone al abrir.
- **Bloquear "Cerrar sesión" si hay pendientes:** sí. Sin red no hay por qué salir.

### 8. Compras propias sin dueño: tarjeta ámbar en Caja → Turno
**Sí, pero no es urgente para el mostrador.**
- Para elegir bien necesito ver **fecha, hora, productos y quién atendía**, y tener un botón **"No sé"** que lo deje para el admin. Las 4 de producción son de días pasados y yo no sabría de quién son.
- Si falta tiempo, que el admin las asigne a mano.
- La tarjeta no debe aparecer en cada apertura de la pestaña Caja.

### 9. Cierre: antes de registrar muestra "el POS registró $X, contaste $Y" por método y pide confirmar
**Sí, pero…**
- **Que se muestre recién en el Resumen, después de contar,** como dice el plan. Si veo antes cuánto "debería" haber, cuento hacia ese número. Así está bien.
- **La diferencia en palabras y en color:** "Efectivo: el POS registró $13.525 y contaste $11.500 → **faltan $2.025**". Al lado, un botón **"Volver a contar"** que me lleve al paso Efectivo.
- **En el resumen y en el PDF faltan dos cosas:**
  - las compras propias por cobrar del día ("Mariana $1.125"), que el dueño descuenta del sueldo;
  - la pregunta del punto 7: cuánto queda para mañana.
- **"Traer las transferencias del POS":** sí, me ahorra tipear todo de nuevo.

### 10. Fiados: cliente elegido de una lista con búsqueda; crear uno nuevo pide confirmar; abono a quien no debe pide confirmar
**Sí, pero se queda corto.** Esto arregla los duplicados, pero el problema de todos los días sigue:
- **Don Pedro se lleva sus cosas a las 11 y yo tengo que acordarme hasta la noche.** Además esos productos no se descuentan del stock.
- **Pido en la fase 2 un botón "Anotar fiado" en la pestaña Fiados** (igual que "Registrar abono"), para anotar en el momento.
- **Que lo anotado durante el día no viva solo en el teléfono.** Hoy queda en el borrador del cierre; si el teléfono se apaga o alguien borra los datos, se pierde.
- **Al elegir al cliente, que se vea cuánto debe** ("Don Pedro debe $12.300"). Así no le fío de más sin saberlo.
- **El "fiado como medio de pago" en la venta** (3.9) es lo ideal, porque descuenta stock. En un almacén de barrio es diario: si se puede, que no quede al final.

### 11. Anular venta desde "Ventas del turno", con motivo; vendedora solo turno abierto y últimos 30 minutos; admin siempre
**Sí, 30 minutos está bien** para errores de mostrador (cobré con tarjeta y era efectivo, se duplicó, me equivoqué en la cantidad). Pero…
- **Quiero "Anular y corregir":** que vuelva a cargar los mismos productos en el carrito para cobrar bien. Es el caso más común y ahorra volver a escanear todo.
- **Si era efectivo, que me diga "Devuelve $X al cliente"** y que el esperado en caja se ajuste solo.
- **Pasados los 30 minutos (devolución en la tarde):** un "Pedir anulación al admin" que la deje marcada, en vez de nada.
- **La lista "Ventas del turno" tiene que mostrar en cada fila el método y los primeros productos** ("Coca lata ×3, Papas…"). Así encuentro la venta sin abrir una por una.

### 12. Conteo de una góndola sola en la fase 3
**No: lo adelantaría a la fase 2.**
- El plan mismo dice que la base ya lo soporta (`p_zero_uncounted=false`) y que es S/M.
- El riesgo de hoy es grave: un admin que cierra "el conteo de la góndola" deja **154 productos en 0**.
- **Si no se puede adelantar,** al menos para la fase 1: que cerrar un conteo que va a dejar productos en 0 pida escribir el número ("Vas a dejar 154 productos en 0. Escribe 154 para confirmar").
- **El arreglo del anti-rebote del láser (2.13):** sí.

---

## Lo que falta en el plan (según yo)
1. **Total y Confirmar fijos abajo** en el carrito (punto 3).
2. **Ninguna lectura del láser se escribe dentro de un campo** (peso, precio, cantidad, "sin precio"): se detecta y se descarta o se deja en cola (puntos 1 y 5, comprobado).
3. **Sonido o vibración en cada lectura**, y un "No encontrado" que se note.
4. **"Dejar en espera"** un carrito.
5. **Accesos rápidos para lo que no tiene código** (pan, hallulla, marraqueta, plátano, palta) arriba en Venta. Con la grilla de 2 columnas va a haber que buscar más.
6. **Tipear la cantidad también en el carrito**, no solo en Recepción (tocar el número → "12").
7. **"¿Cuánto dejas para mañana?" en el cierre** y usarlo al abrir (punto 7).
8. **Compras propias por cobrar en el resumen y en el PDF del cierre** (punto 9).
9. **"Precios cambiados hoy"** con quién los cambió, para el dueño (puntos 4 y 6).
10. **Recepción con la cámara plegada** cuando hay láser (#27: hoy la cámara ocupa media pantalla y el botón fijo tapa la lista). El plan no lo menciona.
11. **Aviso grande "Sin conexión"** cuando no hay red (hoy es un círculo chico), para que la vendedora sepa que no debe cerrar sesión ni borrar datos.
12. **Boleta o comprobante para el cliente:** no está en el plan. A mí no me urge, pero algunos clientes lo piden. Que el dueño diga si va.

## Lo que me sobra o no me importa
- **PIN (3.3):** de acuerdo con no hacerlo.
- **El aviso 409 "el precio cambió, vuelve a confirmar" (2.5):** lo acepto como protección. Pero con el cliente mirando tiene que ser un toque y con el total nuevo en grande, y que pase pocas veces (que el catálogo se refresque seguido).
- **IVA, neto/bruto, tests y CI:** no es mi tema. No los saquen por darme prioridad a mí: si algo de esto se rompe de nuevo, la que queda mal frente al cliente soy yo.

---

## Si solo se puede hacer la mitad: mi orden

1. **1.0** Hotfix: guardar un producto no borra el costo ni pisa el stock (hoy mismo).
2. **1.2** Láser en Venta sin tocar nada, que nunca cobre el producto anterior **y que no escriba dentro de los campos** (peso, precio).
3. **1.6** Cobro: el monto sigue al total, Tarjeta en 1 toque, billetes, **Total y Confirmar fijos abajo**, y **la banda del vuelto** (sacarla de la 2.6 y traerla acá).
4. **1.7** El carrito no se pierde.
5. **1.4** "3.500" y "30.000" se entienden, más los topes de precio y peso.
6. **1.5** No vender a $0 (con "No sé el precio").
7. **1.3** La caja no se abre sin sucursal ni dos veces.
8. **1.10** Una venta no se pierde si la sesión venció, y guarda su hora real.
9. **2.1** "¿Quién atiende?" + cerrar sesión, con el nombre visible en el botón de cobrar.
10. **1.1 + lo mínimo de 2.2 + 2.3** Ficha sin pisar datos, escanear abre la ficha, precio seleccionado, Enter guarda, Inactivos/Reactivar y el modo "Lista de precios". Es la prioridad del dueño.
11. **1.8** Caja → Turno bien calculado.
12. **2.8** Anular venta, con "Anular y corregir".
13. **2.7** El cierre compara con el POS antes de registrar.

**Puede esperar** (en este orden):
1. 2.6 (el resto de los botones grandes)
2. 2.9 + "Anotar fiado" durante el día
3. Conteo de góndola (3.1, que adelantaría)
4. 2.12 movimientos
5. 2.4 editar desde venta y recepción
6. 2.10, 2.11 y 2.13
7. 1.9 compras sin dueño (el admin puede asignarlas a mano)
8. 2.5
