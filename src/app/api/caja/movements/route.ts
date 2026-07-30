import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { addCashMovement } from "@/server/shifts.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/caja/movements — ingreso/egreso manual de efectivo.
 * Body: { shiftId, amount, type: 'IN'|'OUT', reason }
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      shiftId?: string;
      amount?: number;
      type?: "IN" | "OUT";
      reason?: string;
    };

    const amount = Number(body.amount);
    if (!body.shiftId) {
      return NextResponse.json({ error: "shiftId requerido" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }
    if (body.type !== "IN" && body.type !== "OUT") {
      return NextResponse.json({ error: "Tipo inválido (IN u OUT)" }, { status: 400 });
    }

    await addCashMovement({
      shift_id: body.shiftId,
      amount,
      type: body.type,
      reason: body.reason || (body.type === "IN" ? "Ingreso manual" : "Egreso manual"),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
