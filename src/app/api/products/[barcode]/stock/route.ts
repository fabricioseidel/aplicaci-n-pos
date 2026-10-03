import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { applyCount } from "@/server/stock-count.service";
import { esMotivoAjuste } from "@/lib/products/edicion";
import {
  actorDe,
  registrarAjusteDeStock,
  stockEnSucursal,
  sucursalOPorDefecto,
} from "@/server/productos.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ barcode: string }> };

/**
 * POST /api/products/:barcode/stock — "Ajustar stock" de la ficha.
 * Body: { stock, stockVisto, motivo, opId, branchId?, atiende? }
 *
 * - Es la única forma de mover stock desde Productos. Antes el campo stock de
 *   la ficha se reenviaba en cada guardado y revertía las ventas del medio.
 * - `stockVisto` es lo que la pantalla mostraba: si en la sucursal ya hay otra
 *   cantidad (alguien vendió o recibió), no se aplica y se responde 409 con el
 *   stock actual para que la persona decida de nuevo.
 * - `opId` hace la operación idempotente (`stock_ops` vía `apply_stock_absolute`):
 *   un reintento no la aplica dos veces. Si el stock ya es el pedido, es ok.
 * - El motivo queda en `audit_logs` (la base sólo guarda MANUAL_ADJUSTMENT).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { barcode: raw } = await ctx.params;
    const barcode = decodeURIComponent(raw);
    const body = (await req.json().catch(() => null)) as {
      stock?: unknown;
      stockVisto?: unknown;
      motivo?: unknown;
      opId?: unknown;
      branchId?: unknown;
      atiende?: unknown;
    } | null;

    const nuevo = Number(body?.stock);
    const visto = Number(body?.stockVisto);
    if (!Number.isFinite(nuevo) || nuevo < 0) {
      return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
    }
    if (!Number.isFinite(visto)) {
      return NextResponse.json({ error: "Falta el stock que se veía" }, { status: 400 });
    }
    if (!esMotivoAjuste(body?.motivo)) {
      return NextResponse.json({ error: "Elige el motivo del ajuste" }, { status: 400 });
    }
    const opId = typeof body?.opId === "string" && body.opId.length >= 8 ? body.opId : null;
    if (!opId) return NextResponse.json({ error: "Falta opId" }, { status: 400 });

    const { data: producto, error: errProd } = await supabaseServer
      .from("products")
      .select("barcode, name")
      .eq("barcode", barcode)
      .maybeSingle();
    if (errProd) throw errProd;
    if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    const branchId = await sucursalOPorDefecto(body?.branchId);
    if (!branchId) return NextResponse.json({ error: "No hay sucursal configurada" }, { status: 409 });

    const actual = await stockEnSucursal(barcode, branchId);
    const igual = (a: number, b: number) => Math.abs(a - b) < 1e-9;

    if (igual(actual, nuevo)) {
      // Reintento de un ajuste que ya entró, o no había nada que cambiar.
      return NextResponse.json({ ok: true, stock: actual, sinCambios: true });
    }
    if (!igual(actual, visto)) {
      return NextResponse.json(
        {
          error: `El stock cambió a ${actual} mientras ajustabas (alguien vendió o recibió). Revisa y vuelve a ajustar.`,
          conflicto: true,
          stock: actual,
        },
        { status: 409 }
      );
    }

    const actor = actorDe(auth.session, body?.atiende);
    const res = await applyCount({
      items: [{ barcode, qty: nuevo }],
      branchId,
      opId,
      reason: "MANUAL_ADJUSTMENT",
      countedBy: actor,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

    await registrarAjusteDeStock(actor, {
      barcode,
      nombre: (producto as { name: string | null }).name,
      antes: actual,
      despues: nuevo,
      motivo: body!.motivo as string,
      opId,
      branchId,
    });

    return NextResponse.json({ ok: true, stock: nuevo, yaAplicada: res.yaAplicada });
  } catch (e) {
    return errorResponse(e);
  }
}
