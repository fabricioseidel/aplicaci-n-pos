import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { closeShift, type ShiftPaymentMethod } from "@/server/shifts.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/caja/shifts/:id/close
 * Body: { counts: { CASH: 50000, CARD: 12000, ... }, notes? }
 * El RPC close_shift devuelve el cuadre por método.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      counts?: Partial<Record<ShiftPaymentMethod, number>> | number;
      notes?: string | null;
    };

    if (body.counts === undefined || body.counts === null) {
      return NextResponse.json({ error: "Faltan los conteos del cierre" }, { status: 400 });
    }

    const closed = await closeShift(id, body.counts, body.notes ?? null);

    return NextResponse.json({ ok: true, shift: closed, breakdown: closed.breakdown });
  } catch (e) {
    return errorResponse(e);
  }
}
