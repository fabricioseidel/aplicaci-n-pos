import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdmin } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { validarNuevoCodigo } from "@/lib/products/edicion";
import { actorDe } from "@/server/productos.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ barcode: string }> };

/**
 * POST /api/products/:barcode/codigo — corrige el código de barras.
 * Body: { nuevo, atiende? }. Sólo ADMIN.
 *
 * Usa el RPC `rename_product_barcode` (el mismo de OlivoWeb): mueve en una
 * transacción las ventas, movimientos, stock por sucursal, conteos y
 * proveedores. Un UPDATE directo dejaría la historia del producto huérfana.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { barcode: raw } = await ctx.params;
    const viejo = decodeURIComponent(raw);
    const body = (await req.json().catch(() => null)) as { nuevo?: unknown; atiende?: unknown } | null;
    const v = validarNuevoCodigo(viejo, body?.nuevo);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    const { error } = await supabaseServer.rpc("rename_product_barcode", {
      p_old_barcode: viejo,
      p_new_barcode: v.codigo,
    });
    if (error) {
      if (error.code === "23503") {
        // FK no diferible: falta 20261009000100_renombrar_codigo_fk_diferibles
        // en la base. Sin ella sólo se renombran productos sin historial.
        console.error("[productos] rename_product_barcode:", error.message);
        return NextResponse.json(
          {
            error:
              "La base todavía no permite cambiar el código de un producto con stock o historial. Avísale al administrador del sistema.",
          },
          { status: 409 }
        );
      }
      const esperado = /ya está en uso|inválido|es igual|no existe/i.test(error.message ?? "");
      return NextResponse.json(
        { error: esperado ? error.message : "No se pudo cambiar el código" },
        { status: esperado ? 409 : 500 }
      );
    }

    try {
      const { error: errAudit } = await supabaseServer.from("audit_logs").insert({
        action: "products.rename_barcode",
        entity: "products",
        entity_id: v.codigo,
        actor: actorDe(auth.session, body?.atiende),
        details: { origen: "pos", antes: viejo, despues: v.codigo },
      });
      if (errAudit) console.error("[productos] audit_logs:", errAudit.message);
    } catch (e) {
      console.error("[productos] audit_logs:", e);
    }

    return NextResponse.json({ ok: true, antes: viejo, barcode: v.codigo });
  } catch (e) {
    return errorResponse(e);
  }
}
