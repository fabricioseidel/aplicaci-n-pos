import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { resolveBranchId, SinSucursalError } from "@/server/branches.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja/estado?branchId=xxx
 * Dice si hay un turno de caja abierto EN ESA SUCURSAL. El POS lo consulta
 * antes de dejar vender: sin caja abierta las ventas quedan fuera del
 * arqueo del día. Cada sucursal tiene su propia caja. Sin `branchId` (o con
 * uno que no existe) se usa la sucursal por defecto, igual que al abrir: antes
 * devolvía cualquier turno abierto, y así un turno huérfano sin sucursal
 * "abría" la caja de Principal en una pantalla y no en otra.
 *
 * Nota: la ruta equivalente de OlivoWeb selecciona `opening_amount`, columna
 * que no existe (la real es `starting_cash`), por lo que allá devuelve 500
 * siempre. Acá se usa el nombre correcto.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const branchId = await resolveBranchId(new URL(request.url).searchParams.get("branchId"));

    const { data, error } = await supabaseServer
      .from("cash_shifts")
      .select("id, started_at, starting_cash, branch_id")
      .eq("status", "OPEN")
      .eq("branch_id", branchId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      open: Boolean(data?.id),
      shiftId: data?.id ?? null,
      startedAt: data?.started_at ?? null,
      startingCash: data?.starting_cash ?? null,
      branchId,
    });
  } catch (error) {
    if (error instanceof SinSucursalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[caja/estado]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
