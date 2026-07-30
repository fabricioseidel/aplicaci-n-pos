import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse, successResponse } from "@/lib/api-response";
import { mapSupaToUI, PRODUCT_COLUMNS } from "@/services/products";
import type { SupaProduct } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/products — catálogo completo para el POS.
 *
 * A diferencia del catálogo público de la tienda, acá NO se filtra por
 * "producto visible" (foto + categoría + precio): en el mostrador hay que
 * poder cobrar un producto aunque le falte la foto. Sólo se excluyen los
 * explícitamente inactivos.
 *
 * El service worker cachea esta respuesta (NetworkFirst) para que el catálogo
 * siga navegable sin conexión.
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseServer
      .from("products")
      .select(PRODUCT_COLUMNS)
      .neq("is_active", false)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const items = ((data ?? []) as unknown as SupaProduct[]).map(mapSupaToUI);
    return NextResponse.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Upsert con tolerancia a columnas ausentes: si PostgREST responde que una
 * columna no existe en el schema cache, se quita del payload y se reintenta.
 * Evita que un despliegue de la base fuera de fase tumbe la creación de
 * productos desde el mostrador.
 */
async function upsertProductsWithColumnFallback(payloadsInput: Record<string, unknown>[]) {
  let payloads = payloadsInput.map((p) => ({ ...p }));
  let lastError: unknown;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabaseServer
      .from("products")
      .upsert(payloads, { onConflict: "barcode" });
    if (!error) return;

    lastError = error;

    if (error.code === "PGRST204" && typeof error.message === "string") {
      const match = error.message.match(/Could not find the '([^']+)' column of 'products'/);
      const missingColumn = match?.[1];
      if (missingColumn) {
        let changed = false;
        payloads = payloads.map((p) => {
          if (Object.prototype.hasOwnProperty.call(p, missingColumn)) {
            const next = { ...p };
            delete next[missingColumn];
            changed = true;
            return next;
          }
          return p;
        });
        if (changed) continue;
      }
    }

    throw error;
  }

  throw lastError;
}

/** POST /api/products — crea o actualiza por `barcode`. */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const text = await req.text();
    if (!text.trim()) return errorResponse(new Error("Empty request body"), 400);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(new Error("Invalid JSON body"), 400);
    }

    const asRecord = body as { items?: unknown };
    const items = (Array.isArray(asRecord?.items) ? asRecord.items : [body]) as Record<
      string,
      unknown
    >[];

    if (items.length === 0) return errorResponse(new Error("Missing items"), 400);

    for (const item of items) {
      if (!item?.barcode) return errorResponse(new Error("Missing barcode"), 400);
    }

    await upsertProductsWithColumnFallback(items);

    return successResponse({ success: true, count: items.length });
  } catch (e) {
    return errorResponse(e);
  }
}
