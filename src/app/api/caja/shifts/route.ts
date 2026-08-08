import { NextRequest, NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { openShift, getCurrentShift } from "@/server/shifts.service";

export const dynamic = "force-dynamic";

/** GET /api/caja/shifts?branchId=xxx — turno abierto actual de esa sucursal (o null). */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branchId = new URL(req.url).searchParams.get("branchId");
    const shift = await getCurrentShift({ branchId });
    return NextResponse.json({ shift });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/caja/shifts — abre un turno. Body: { startingCash, notes, branchId }. */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      startingCash?: number;
      notes?: string | null;
      branchId?: string | null;
    };

    const startingCash = Number(body.startingCash);
    if (!Number.isFinite(startingCash) || startingCash < 0) {
      return NextResponse.json({ error: "Efectivo inicial inválido" }, { status: 400 });
    }

    // Cada sucursal tiene su propia caja: dos turnos abiertos a la vez EN LA
    // MISMA sucursal harían que las ventas se repartan entre ambos y ninguno
    // cuadre, pero dos sucursales distintas sí pueden tener cada una el suyo.
    // Si ya hay uno abierto para esta sucursal, se devuelve ese.
    const existing = await getCurrentShift({ branchId: body.branchId ?? null });
    if (existing) {
      return NextResponse.json(
        { ok: true, shift: existing, alreadyOpen: true },
        { status: 200 }
      );
    }

    const shift = await openShift({
      starting_cash: startingCash,
      user_id: auth.userId || null,
      branch_id: body.branchId ?? null,
      notes: body.notes ?? null,
    });

    return NextResponse.json({ ok: true, shift });
  } catch (e) {
    return errorResponse(e);
  }
}
