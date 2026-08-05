# Plan a futuro — Olivo POS + OlivoWeb

Escrito el 2026-08-01, después de arreglar el bug que impedía abrir caja.
Todo lo de acá sale de lo que apareció esa noche revisando el código y la base;
no es una lista genérica de buenas prácticas.

Estado al cerrar: POS desplegado y funcionando, APK compilando en CI, los dos
errores en bucle de OlivoWeb corregidos. Nada de lo que sigue es urgente para
la presentación.

---

## 0. Antes que nada: rotar la service_role key

La `SUPABASE_SERVICE_ROLE_KEY` se pegó en texto plano en un chat. Esa llave
**bypasea RLS por completo**: quien la tenga lee y escribe toda la base sin
restricción, y no caduca hasta 2035.

Rotarla en Supabase → Settings → API → *Generate new service_role key*, y
actualizar la variable en Vercel en los dos proyectos (`aplicaci-n-pos` y
`olivo-web`). Es un cambio de 5 minutos y no requiere tocar código.

Regla para adelante: las llaves se pasan por el dashboard de Vercel o un gestor
de contraseñas, nunca por chat, mail o WhatsApp.

---

## 1. El problema de fondo: dos apps, una base, ningún dueño del esquema

Los tres bugs de esa noche son **el mismo bug** con tres caras:

| Síntoma | Causa |
| --- | --- |
| No se podía abrir caja | el código asumía un `users.id` que ya no existía |
| `/api/admin/caja/estado` daba 500 desde siempre | pedía `opening_amount`; la columna es `starting_cash` |
| `column users.password does not exist` en bucle | código que adivinaba el nombre de la columna |

Ninguna de las dos apps define ni versiona el esquema: las dos *suponen* cómo
es la base. Cuando la suposición se rompe, nadie se entera hasta que un cajero
no puede vender.

**Qué hacer, en orden de esfuerzo creciente:**

1. **Tipos generados** (una tarde). Supabase genera tipos TypeScript del
   esquema real: `supabase gen types typescript`. Con el cliente tipado,
   `select("opening_amount")` deja de compilar. Esto solo habría atajado dos de
   los tres bugs en tiempo de build, gratis y para siempre.
2. **Un repo dueño de las migraciones**. Hoy el esquema vive únicamente dentro
   de Supabase; no hay historial ni forma de saber cuándo cambió algo ni por
   qué. Conviene que OlivoWeb (que es el más viejo) sea el dueño, con
   `supabase/migrations/` versionado en git.
3. **Consolidar `apply_sale`**. Hoy hay **tres sobrecargas** en la base (14, 15
   y 17 parámetros). PostgREST elige según los parámetros exactos que mande el
   cliente; si alguna app manda un set que encaje en dos, falla con "could not
   choose the best candidate function". Hoy funciona por suerte, no por diseño.
   Dejar una sola firma y borrar las viejas cuando ninguna app las use.

---

## 2. Código compartido que se duplicó y se desincronizó

El bug del id fantasma estaba **en las dos apps**, con el mismo `if (!token.uid)`.
`getUserByEmail` también está duplicado, y en OlivoWeb había derivado a una
versión con código de diagnóstico que corría en cada request.

Un paquete compartido (monorepo, o simplemente un `@olivo/auth` privado) para
lo que las dos apps hacen igual: auth/sesión, tipos de la base, helpers de
métodos de pago. Mientras eso no pase, la regla mínima: **un bug que se arregla
en un repo se busca en el otro el mismo día**.

---

## 3. El POS no tiene un solo test

OlivoWeb tiene 97 tests; el POS, que es el que toca la plata, cero. No hace
falta cobertura alta — hacen falta los que atajan un desastre:

- `apply_sale` es idempotente: la misma venta encolada dos veces no cobra dos
  veces.
- Venta por peso: 350 g de un producto a $4.000/kg cobra $1.400 y descuenta
  0.350 del stock, sin truncar a 0.
- El cuadre de `close_shift` cuadra con pago mixto (efectivo + tarjeta).
- La cola offline no encola errores 4xx del servidor (reintentar un 400 en
  bucle no arregla nada).

Los tres primeros se pueden escribir contra la base real usando transacciones
que se revierten al final — es exactamente como se verificó el flujo esa noche,
y funciona bien.

---

## 4. Huecos conocidos que hoy son deuda aceptada

Están documentados en el README y son decisiones conscientes, pero conviene
ponerles fecha antes de que el volumen los convierta en problema:

- **Movimientos de caja y recepciones no tienen deduplicación en la base.** Las
  ventas sí (`p_client_sale_id`). Si el outbox reintenta un ingreso de efectivo
  tras una caída de red, entra dos veces y el arqueo no cuadra. La solución es
  la misma que ya funciona en ventas: un uuid de cliente + índice único.
- **Los errores de Postgres llegan crudos a la pantalla del cajero.**
  `errorResponse` devuelve `error.message` tal cual — por eso el toast decía
  `violates foreign key constraint "cash_shifts_user_id_fkey"`. Además de ser
  ilegible, filtra nombres de tablas y columnas. Conviene un mapa de códigos
  (`23503`, `23505`, `PGRST…`) a frases en español, y el detalle técnico solo
  al log. Ya está hecho para el `23503` de abrir caja; falta el resto.

---

## 5. Nadie se entera cuando algo se rompe

`/api/admin/caja/estado` devolvió 500 **desde el día que se escribió** y nadie
lo supo. El bug de abrir caja se encontró leyendo los logs de Postgres a mano.

- **Sentry** (o similar) en los dos proyectos de Vercel. Es gratis en el tier
  chico y avisa la primera vez que una ruta empieza a fallar, no la centésima.
- Revisar **Supabase → Logs → Postgres** de vez en cuando: los errores de
  esquema aparecen ahí aunque la app los esté tragando en silencio.

---

## 6. APK: de debug a algo distribuible

El artifact de hoy está firmado con la llave de debug de Android. Sirve para
sideload en los teléfonos del local y para la presentación, pero:

- **Una llave propia** (`keystore`) guardada en un gestor de contraseñas, con la
  contraseña. Si se pierde, no se puede volver a actualizar la app instalada:
  hay que desinstalar y perder los datos locales.
- El keystore va como secret en GitHub Actions, y el workflow pasa a
  `assembleRelease`. Nunca commiteado al repo.
- Subir `versionCode` en cada build distribuido (`android/app/build.gradle`),
  si no Android rechaza la actualización.
- Recién ahí tiene sentido pensar en Play Store, que además pide política de
  privacidad y ficha de la app.

Ojo: **el APK carga la URL en vivo**, así que la mayoría de los cambios llegan
solos con el deploy de Vercel. Solo hay que regenerar el APK si cambia el ícono,
el nombre o la URL.

---

## 7. Cosas sueltas para revisar sin apuro

- OlivoWeb tiene `/debug/bootstrap` y `/api/admin/bootstrap` en producción.
  Vale la pena confirmar que están protegidos o borrarlos.
- El POS depende de que exista una sucursal `is_default`; si alguien la
  desmarca, `currentBranch` queda en la primera de la lista sin avisar.
- La app "Olivo Operaciones" de OlivoWeb y el POS nuevo se pisan
  conceptualmente: las dos son mostrador. Conviene decidir cuál queda y retirar
  la otra, antes de que se instalen las dos en los mismos teléfonos.

---

## Orden sugerido

1. Rotar la service_role key (5 min, hoy).
2. Tipos generados de Supabase en los dos repos (una tarde, corta la clase de
   bug más cara).
3. Sentry (una hora).
4. Los cuatro tests del POS (un día).
5. Deduplicación de movimientos de caja y recepciones.
6. Migraciones versionadas + consolidar `apply_sale`.
7. Keystore propio y release APK.
