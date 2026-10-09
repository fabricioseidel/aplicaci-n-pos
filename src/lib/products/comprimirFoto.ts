import { FOTO_CALIDAD, medidasReducidas } from "./foto";

/**
 * Achica una foto en el teléfono (canvas → JPEG). Respeta la orientación EXIF
 * cuando el navegador lo permite (`imageOrientation: "from-image"`; el
 * WebView de Android la aplica también al dibujar un <img>).
 */
export async function comprimirFoto(archivo: Blob): Promise<Blob> {
  let fuente: CanvasImageSource;
  let ancho: number;
  let alto: number;
  let liberar = () => {};

  try {
    const bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    fuente = bmp;
    ancho = bmp.width;
    alto = bmp.height;
    liberar = () => bmp.close();
  } catch {
    const url = URL.createObjectURL(archivo);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la foto"));
      i.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    fuente = img;
    ancho = img.naturalWidth;
    alto = img.naturalHeight;
  }

  try {
    const m = medidasReducidas(ancho, alto);
    if (!m.ancho) throw new Error("No se pudo leer la foto");
    const canvas = document.createElement("canvas");
    canvas.width = m.ancho;
    canvas.height = m.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la foto");
    // Fondo blanco: un PNG con transparencia no queda negro en JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, m.ancho, m.alto);
    ctx.drawImage(fuente, 0, 0, m.ancho, m.alto);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", FOTO_CALIDAD));
    if (!blob) throw new Error("No se pudo procesar la foto");
    return blob;
  } finally {
    liberar();
  }
}
