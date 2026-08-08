import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { addCashMovement } from "@/server/shifts.service";

export const dynamic = "force-dynamic";

const VALID_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
type ManualMovementMethod = (typeof VALID_METHODS)[number];

/**
 * POST /api/caja/movements — ingreso/egreso manual de dinero.
 * Body: { shiftId, amount, type: 'IN'|'OUT', reason, method }
 *
 * `method` deja anotar el movimiento en el medio real en que se movió el
 * dinero (efectivo, tarjeta, transferencia, otro) — antes todo movimiento
 * manual se contaba como efectivo aunque en realidad no lo fuera.
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
      method?: string;
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

    const method = (body.method?.toUpperCase() ?? "CASH") as ManualMovementMethod;
    if (!VALID_METHODS.includes(method)) {
      return NextResponse.json({ error: "Método inválido" }, { status: 400 });
    }

    await addCashMovement({
      shift_id: body.shiftId,
      amount,
      type: body.type,
      reason: body.reason || (body.type === "IN" ? "Ingreso manual" : "Egreso manual"),
      method,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
