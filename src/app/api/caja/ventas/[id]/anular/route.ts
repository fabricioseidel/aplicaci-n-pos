import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { anularVenta, obtenerVenta, permisoAnular } from "@/server/anulacion.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/caja/ventas/:id/anular — Body: { motivo, atendio? }
 *
 * La regla de quién puede (ADMIN siempre; vendedora sólo turno abierto y
 * últimos 30 min) se valida acá y no sólo en la pantalla: una pestaña con el
 * código viejo no la puede saltar. Anular dos veces responde ok.
 *
 * `atendio` es quién está en el mostrador ("¿Quién atiende?"); queda en
 * `voided_by` junto a la cuenta de la sesión, porque el teléfono es compartido.
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
      return NextResponse.json({ error: "Escribe o elige el motivo de la anulación" }, { status: 400 });
    }

    const venta = await obtenerVenta(id);
    if (!venta) return NextResponse.json({ error: "La venta no existe" }, { status: 404 });
    if (venta.voided) return NextResponse.json({ ok: true, yaAnulada: true });

    const permiso = await permisoAnular(auth.role, venta);
    if (!permiso.ok) return NextResponse.json({ error: permiso.motivo }, { status: 403 });

    const cuenta = auth.session.user?.email ?? auth.userId;
    const atendio = (body.atendio ?? "").trim().slice(0, 60);
    const actor = atendio ? `${atendio} (${cuenta})` : cuenta;

    const anulada = await anularVenta(id, motivo, actor);
    return NextResponse.json({ ok: true, yaAnulada: !anulada });
  } catch (e) {
    return errorResponse(e);
  }
}
