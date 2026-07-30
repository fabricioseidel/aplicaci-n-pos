import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/estado
 * Dice si hay un turno de caja abierto. El POS lo consulta antes de dejar
 * vender: sin caja abierta las ventas quedan fuera del arqueo del día.
 *
 * Nota: la ruta equivalente de OlivoWeb selecciona `opening_amount`, columna
 * que no existe (la real es `starting_cash`), por lo que allá devuelve 500
 * siempre. Acá se usa el nombre correcto.
 */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseServer
      .from("cash_shifts")
      .select("id, started_at, starting_cash, branch_id")
      .eq("status", "OPEN")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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
