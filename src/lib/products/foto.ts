/**
 * Foto del producto tomada con la cámara del teléfono.
 *
 * El teléfono la achica antes de subirla (una foto de 12 MP pesa 4-6 MB y
 * en el local la red es la del celular): lado mayor 1000 px y JPEG 0,8, que
 * queda en ~150-250 KB. Es el mismo tope que usa OlivoWeb al subir a
 * Cloudinary (1000 × 1000, crop "limit").
 */

export const FOTO_LADO_MAXIMO = 1000;
export const FOTO_CALIDAD = 0.8;
/** Lo que acepta el servidor (después de comprimir sobra). */
export const FOTO_BYTES_MAXIMO = 5 * 1024 * 1024;
export const FOTO_TIPOS = ["image/jpeg", "image/png", "image/webp"] as const;
/** Carpeta de Cloudinary de OlivoWeb para productos (`uploadImage`). */
export const CARPETA_CLOUDINARY = "olivomarket/products";

/** Tamaño final manteniendo la proporción; nunca agranda. */
export function medidasReducidas(ancho: number, alto: number, max = FOTO_LADO_MAXIMO): { ancho: number; alto: number } {
  if (!(ancho > 0) || !(alto > 0)) return { ancho: 0, alto: 0 };
  const f = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/**
 * Lo que firma Cloudinary en una subida firmada: los parámetros (sin file,
 * api_key ni resource_type) ordenados por nombre, `k=v` unidos con `&`, y el
 * secreto pegado al final. El hash (SHA-1) lo hace quien llama.
 */
export function textoAFirmarCloudinary(params: Record<string, string | number>, secreto: string): string {
  return (
    Object.keys(params)
      .filter((k) => !["file", "api_key", "resource_type", "cloud_name"].includes(k) && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&") + secreto
  );
}

/** Nombre del archivo en el bucket `uploads` (mismo prefijo que OlivoWeb: `product-`). */
export function nombreArchivoFoto(barcode: string, ahora = Date.now(), azar = Math.random()): string {
  const limpio = barcode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "sin-codigo";
  return `product-${limpio}-${ahora}-${azar.toString(36).slice(2, 8)}.jpg`;
}
