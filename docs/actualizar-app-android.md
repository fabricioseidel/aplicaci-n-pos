# Actualizar la app del celular

La app Android es un **cascarón**: no lleva el sitio adentro, lo carga en vivo
desde `server.url` (`capacitor.config.ts`). Eso parte el trabajo en dos.

## 1. Cambios de pantalla → no requieren APK

Todo lo que sea HTML, React o lógica web llega sola al celular con el próximo
deploy del sitio. No hay que reinstalar nada: basta con cerrar y abrir la app.

El cierre de caja completo (conteo, transferencias, vouchers, fiados, el PDF)
entra por acá.

## 2. Plugins nativos → sí requieren APK nuevo

Un plugin de Capacitor es código Java que vive dentro del APK. Si el sitio
nuevo llama a un plugin que el APK instalado no trae, la llamada falla aunque
la web esté actualizada.

Plugins agregados para el cierre:

- `@capacitor/filesystem` — escribe el PDF en la caché de la app
- `@capacitor/share` — abre el menú de compartir de Android para que lo tome
  la app de la impresora (MPT-II por Bluetooth)

Mientras no se reconstruya el APK, la app **no deja de funcionar**: detecta que
los plugins no están y descarga el PDF en vez de abrir el menú de compartir,
avisando que hay que actualizar la app.

### Pasos para generar el APK

Ya está corrido `npx cap sync android` y commiteados los archivos que genera
(`android/capacitor.settings.gradle` y `android/app/capacitor.build.gradle`),
así que el proyecto nativo ya tiene los dos plugins enlazados.

```bash
npm install            # trae los plugins a node_modules
npm run android:open   # abre Android Studio
```

En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
El archivo queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

O sin Android Studio, con el SDK de Android instalado:

```bash
cd android && ./gradlew assembleDebug
```

Se instala en el celular con el APK directo (hay que permitir "instalar apps de
orígenes desconocidos") o por `adb install -r <ruta del apk>`.

### Por qué no se generó acá

El entorno donde corre Claude bloquea `dl.google.com`, que es de donde salen
tanto el SDK de Android como las librerías AndroidX. Sin ese host no hay forma
de compilar un APK, así que este paso es el único que queda a mano.
