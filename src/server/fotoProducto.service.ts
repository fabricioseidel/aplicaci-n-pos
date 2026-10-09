import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { CARPETA_CLOUDINARY, nombreArchivoFoto, textoAFirmarCloudinary } from "@/lib/products/foto";

/**
 * Dónde se guarda la foto de un producto.
 *
 * 1. Cloudinary, como OlivoWeb (`server/cloudinary.service.ts`, carpeta
 *    `olivomarket/products`), si el POS tiene las mismas tres variables:
 *    CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.
 *    Subida firmada en el servidor: el secreto nunca llega al teléfono.
 * 2. Si no están, el bucket público `uploads` de Supabase Storage (el que ya
 *    usa el POS para los comprobantes y OlivoWeb como respaldo de las fotos de
 *    producto), con la service_role que el POS ya tiene.
 */
export function destinoFoto(): "cloudinary" | "supabase" {
  return process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
    ? "cloudinary"
    : "supabase";
}

async function subirACloudinary(datos: Buffer, tipo: string): Promise<string> {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const secreto = process.env.CLOUDINARY_API_SECRET!;
  const params = { folder: CARPETA_CLOUDINARY, timestamp: Math.floor(Date.now() / 1000) };
  const signature = createHash("sha1").update(textoAFirmarCloudinary(params, secreto)).digest("hex");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(datos)], { type: tipo }), "foto.jpg");
  form.append("api_key", apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("folder", params.folder);
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } };
  if (!res.ok || !data.secure_url) {
    throw new Error(`Cloudinary: ${data.error?.message ?? res.status}`);
  }
  return data.secure_url;
}

async function subirASupabase(barcode: string, datos: Buffer, tipo: string): Promise<string> {
  const nombre = nombreArchivoFoto(barcode);
  const { error } = await supabaseServer.storage
    .from("uploads")
    .upload(nombre, datos, { contentType: tipo, upsert: false });
  if (error) throw new Error(`Storage: ${error.message}`);
  const { data } = supabaseServer.storage.from("uploads").getPublicUrl(nombre);
  if (!data?.publicUrl) throw new Error("Storage: sin URL pública");
  return data.publicUrl;
}

/** Sube la foto y devuelve su URL pública (no toca la base). */
export async function subirFotoProducto(barcode: string, datos: Buffer, tipo: string): Promise<string> {
  return destinoFoto() === "cloudinary" ? subirACloudinary(datos, tipo) : subirASupabase(barcode, datos, tipo);
}
