import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { registrarCierre, obtenerResumen, listarCierres } from "@/server/cierre.service";
import type { CierrePayload } from "@/lib/cierre/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/cierre?shiftId=xxx  → resumen de un cierre (para imprimir)
 * GET /api/caja/cierre?branchId=&desde=&hasta=  → historial de cierres
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(req.url).searchParams;
    const shiftId = params.get("shiftId");

    if (shiftId) {
      const resumen = await obtenerResumen(shiftId);
      if (!resumen) return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
      return NextResponse.json({ resumen });
    }

    const cierres = await listarCierres({
      branchId: params.get("branchId"),
      desde: params.get("desde") ?? undefined,
      hasta: params.get("hasta") ?? undefined,
    });
    return NextResponse.json({ cierres });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/caja/cierre — registra (o corrige) el cierre declarado del turno.
 * Body: { shiftId, payload }
 *
 * El RPC es idempotente por turno, así que reenviar un cierre corregido desde
 * el computador reemplaza el anterior en vez de duplicarlo.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as { shiftId?: string; payload?: CierrePayload };

    if (!body.shiftId) {
      return NextResponse.json({ error: "shiftId requerido" }, { status: 400 });
    }
    if (!body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ error: "Falta el detalle del cierre" }, { status: 400 });
    }

    const resumen = await registrarCierre(body.shiftId, body.payload);
    return NextResponse.json({ ok: true, resumen });
  } catch (e) {
    return errorResponse(e);
  }
}
