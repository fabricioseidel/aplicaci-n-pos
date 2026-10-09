import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { anotarMovimiento } from "@/server/cierre.service";
import { resolveBranchId } from "@/server/branches.service";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cuentas/movimiento — anota un fiado o un abono en el momento.
 *
 * Queda en el turno abierto de la sucursal. Al registrar el cierre, el
 * borrador ya lo trae (registrar_cierre reescribe los movimientos del turno
 * con lo que manda el cierre), así no se anota dos veces ni se pierde.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;
  try {
    const b = (await req.json()) as {
      id?: string;
      accountId?: string | null;
      nombreNuevo?: string | null;
      kind?: string;
      amount?: number;
      method?: string | null;
      note?: string | null;
      branchId?: string | null;
      atendio?: string | null;
    };
    if (!b.id || !UUID_RE.test(b.id)) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
    if (b.kind !== "CHARGE" && b.kind !== "PAYMENT") {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }
    const amount = Math.round(Number(b.amount));
    if (!(amount > 0)) return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    if (!b.accountId && !b.nombreNuevo?.trim()) {
      return NextResponse.json({ error: "Elige la cuenta" }, { status: 400 });
    }
    const method =
      b.kind === "PAYMENT"
        ? b.method === "TRANSFER" || b.method === "CARD"
          ? b.method
          : "CASH"
        : null;

    const branchId = await resolveBranchId(b.branchId);
    const { data: turno } = await supabaseServer
      .from("cash_shifts")
      .select("id")
      .eq("status", "OPEN")
      .eq("branch_id", branchId)
      .maybeSingle();
    if (!turno) {
      return NextResponse.json({ error: "No hay caja abierta: abre la caja para anotar fiados" }, { status: 409 });
    }

    const nota = [b.note?.trim(), b.atendio ? `Anotó: ${b.atendio}` : null].filter(Boolean).join(" · ") || null;
    const r = await anotarMovimiento({
      id: b.id,
      accountId: b.accountId ?? null,
      nombreNuevo: b.nombreNuevo?.trim() ?? null,
      kind: b.kind,
      amount,
      method,
      note: nota,
      shiftId: (turno as { id: string }).id,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
