import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/estado?branchId=xxx
 * Dice si hay un turno de caja abierto EN ESA SUCURSAL. El POS lo consulta
 * antes de dejar vender: sin caja abierta las ventas quedan fuera del
 * arqueo del día. Cada sucursal tiene su propia caja — sin `branchId` se
 * cae al comportamiento histórico (cualquier turno abierto, sin filtrar).
 *
 * Nota: la ruta equivalente de OlivoWeb selecciona `opening_amount`, columna
 * que no existe (la real es `starting_cash`), por lo que allá devuelve 500
 * siempre. Acá se usa el nombre correcto.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branchId = new URL(request.url).searchParams.get("branchId");

    let query = supabaseServer
      .from("cash_shifts")
      .select("id, started_at, starting_cash, branch_id")
      .eq("status", "OPEN")
      .order("started_at", { ascending: false })
      .limit(1);
    if (branchId) query = query.eq("branch_id", branchId);

    const { data, error } = await query.maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      open: Boolean(data?.id),
      shiftId: data?.id ?? null,
      startedAt: data?.started_at ?? null,
      startingCash: data?.starting_cash ?? null,
      branchId: data?.branch_id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[caja/estado]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
