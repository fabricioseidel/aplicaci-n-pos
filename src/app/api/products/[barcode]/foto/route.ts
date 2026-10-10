import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { mapSupaToUI } from "@/services/products";
import { FOTO_BYTES_MAXIMO, FOTO_TIPOS } from "@/lib/products/foto";
import { conColumnasDeProducto, filaParaRol } from "@/server/productos.service";
import { subirFotoProducto } from "@/server/fotoProducto.service";
import type { SupaProduct } from "@/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ barcode: string }> };

/**
 * POST /api/products/:barcode/foto — multipart con `file` (la foto ya
 * comprimida en el teléfono). La sube (Cloudinary o Storage, ver
 * `fotoProducto.service`) y deja la URL en `products.image_url`.
 *
 * La foto anterior no se borra: puede estar usándola la tienda en caché y
 * borrar archivos ajenos desde el mostrador no aporta nada.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { barcode: raw } = await ctx.params;
    const barcode = decodeURIComponent(raw);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No llegó la foto" }, { status: 400 });
    }
    if (!(FOTO_TIPOS as readonly string[]).includes(file.type)) {
      return NextResponse.json({ error: "La foto tiene que ser JPG, PNG o WEBP" }, { status: 400 });
    }
    if (file.size > FOTO_BYTES_MAXIMO) {
      return NextResponse.json({ error: "La foto es demasiado grande" }, { status: 413 });
    }

    const { data: existe, error: errExiste } = await supabaseServer
      .from("products")
      .select("barcode")
      .eq("barcode", barcode)
      .maybeSingle();
    if (errExiste) throw errExiste;
    if (!existe) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    let url: string;
    try {
      url = await subirFotoProducto(barcode, Buffer.from(await file.arrayBuffer()), file.type);
    } catch (e) {
      console.error("[productos] foto:", e);
      return NextResponse.json({ error: "No se pudo subir la foto. Intenta de nuevo." }, { status: 502 });
    }

    const { data, error } = await conColumnasDeProducto((cols) =>
      supabaseServer.from("products").update({ image_url: url }).eq("barcode", barcode).select(cols)
    );
    if (error) throw error;
    const fila = (data?.[0] ?? null) as unknown as (SupaProduct & Record<string, unknown>) | null;
    if (!fila) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const visible = filaParaRol(fila, auth.role);
    return NextResponse.json({ ok: true, url, fila: visible, producto: mapSupaToUI(visible as SupaProduct) });
  } catch (e) {
    return errorResponse(e);
  }
}
