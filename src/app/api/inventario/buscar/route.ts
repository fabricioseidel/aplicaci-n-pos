import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { mapSupaToUI } from "@/services/products";
import { conColumnasDeProducto } from "@/server/productos.service";
import type { SupaProduct } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/buscar?barcode=123  → un producto por código exacto.
 * GET /api/inventario/buscar?q=texto      → hasta 25 productos por nombre.
 * GET /api/inventario/buscar?q=texto&inactivos=1 → sólo los inactivos. Es lo
 *   que usa Conteo: los activos ya los tiene en el catálogo local, y si venían
 *   mezclados llenaban el límite de 25 y los inactivos no llegaban nunca.
 *
 * Las dos búsquedas **incluyen inactivos a propósito**, y ahí está el punto:
 * el catálogo que carga el POS (`/api/products`) sólo trae activos, así que un
 * producto que un conteo anterior dio por no disponible no aparece. Si al
 * escanearlo se ofreciera crearlo, el mostrador terminaría con dos fichas del
 * mismo producto y el stock repartido entre las dos. Contarlo lo reactiva.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const barcode = (params.get("barcode") ?? "").trim();

    if (barcode) {
      const { data, error } = await conColumnasDeProducto((cols) =>
        supabaseServer.from("products").select(cols).eq("barcode", barcode).maybeSingle()
      );

      if (error) throw error;

      return NextResponse.json({
        producto: data ? mapSupaToUI(data as unknown as SupaProduct) : null,
      });
    }

    const q = (params.get("q") ?? "").trim();
    const soloInactivos = params.get("inactivos") === "1";
    if (q.length < 2) return NextResponse.json({ productos: [] });

    // Cada palabra se busca por separado (en cualquier orden): "harina pan"
    // tiene que encontrar "HARINA DE MAÍZ PAN BLANCA". Comodines escapados.
    const patrones = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);

    const { data, error } = await conColumnasDeProducto((cols) => {
      let query = supabaseServer.from("products").select(cols);
      if (soloInactivos) query = query.eq("is_active", false);
      for (const patron of patrones) query = query.ilike("name", patron);
      return query.order("name").limit(25);
    });

    if (error) throw error;

    // Misma forma que `/api/products` para que el cliente no tenga dos mapeos.
    const productos = ((data ?? []) as unknown as SupaProduct[]).map(mapSupaToUI);

    return NextResponse.json({ productos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[inventario/buscar]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
