import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { validarNuevoCodigo } from "@/lib/products/edicion";
import { esCodigoGenerico } from "@/lib/products/codigos";
import { actorDe } from "@/server/productos.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ barcode: string }> };

/**
 * POST /api/products/:barcode/adoptar-codigo — el producto se queda con el
 * código de barras que se acaba de escanear. Body: { nuevo, atiende? }.
 *
 * El caso: se escanea un envase, el código no está en el catálogo, se busca
 * por nombre y el producto aparece con un código genérico (INT-…, SINCOD-…,
 * 9000000…). Antes elegirlo sólo lo contaba y el código real se perdía.
 *
 * Lo puede hacer quien atiende (el inventario lo hacen vendedores), pero
 * sólo sobre un código genérico: reemplazar un código real es decidir que
 * dos envases son el mismo producto, y eso sigue siendo de admin (`/codigo`).
 *
 * Usa `rename_product_barcode`, que arrastra ventas, movimientos, stock por
 * sucursal, conteos y proveedores. Queda en `audit_logs` como
 * `products.rename_barcode`: el inventario lo usa para reubicar lotes que
 * otro teléfono guardó con el código viejo.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { barcode: raw } = await ctx.params;
    const viejo = decodeURIComponent(raw).trim();
    const body = (await req.json().catch(() => null)) as { nuevo?: unknown; atiende?: unknown } | null;

    const v = validarNuevoCodigo(viejo, body?.nuevo);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    if (!esCodigoGenerico(viejo) && auth.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Este producto ya tiene un código real. Cambiarlo lo hace un administrador." },
        { status: 403 }
      );
    }

    const { error } = await supabaseServer.rpc("rename_product_barcode", {
      p_old_barcode: viejo,
      p_new_barcode: v.codigo,
    });
    if (error) {
      const esperado = /ya está en uso|inválido|es igual|no existe/i.test(error.message ?? "");
      if (!esperado) console.error("[productos] adoptar-codigo:", error.message);
      return NextResponse.json(
        { error: esperado ? error.message : "No se pudo guardar el código" },
        { status: esperado ? 409 : 500 }
      );
    }

    const actor = actorDe(auth.session, body?.atiende);
    const { error: errVer } = await supabaseServer
      .from("products")
      .update({ is_active: true, verified_at: new Date().toISOString(), verified_by: actor })
      .eq("barcode", v.codigo);
    if (errVer) console.error("[productos] adoptar-codigo verificar:", errVer.message);

    const { error: errAudit } = await supabaseServer.from("audit_logs").insert({
      action: "products.rename_barcode",
      entity: "products",
      entity_id: v.codigo,
      actor,
      details: { origen: "pos-escaneo", antes: viejo, despues: v.codigo },
    });
    if (errAudit) console.error("[productos] audit_logs:", errAudit.message);

    return NextResponse.json({ ok: true, antes: viejo, barcode: v.codigo });
  } catch (e) {
    return errorResponse(e);
  }
}
