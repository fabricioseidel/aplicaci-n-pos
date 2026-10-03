import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { tienePedidoAnulacion } from "@/lib/caja/anular";
import { obtenerVenta, pedirAnulacion } from "@/server/anulacion.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/caja/ventas/:id/pedir-anulacion — Body: { motivo, atendio? }
 *
 * Para cuando la vendedora ya no puede anular (más de 30 minutos o turno
 * cerrado): deja la venta marcada en sus notas y el admin la ve marcada en
 * "Ventas del turno". Pedirla dos veces no la marca dos veces.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Venta inválida" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { motivo?: string; atendio?: string };
    const motivo = (body.motivo ?? "").trim().slice(0, 300);
    if (!motivo) {
      return NextResponse.json({ error: "Escribe o elige el motivo" }, { status: 400 });
    }

    const venta = await obtenerVenta(id);
    if (!venta) return NextResponse.json({ error: "La venta no existe" }, { status: 404 });
    if (venta.voided) return NextResponse.json({ ok: true, yaAnulada: true });
    if (tienePedidoAnulacion(venta.notes)) return NextResponse.json({ ok: true, yaPedida: true });

    const cuenta = auth.session.user?.email ?? auth.userId;
    const atendio = (body.atendio ?? "").trim().slice(0, 60);
    await pedirAnulacion(venta, motivo, atendio ? `${atendio} (${cuenta})` : cuenta);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
