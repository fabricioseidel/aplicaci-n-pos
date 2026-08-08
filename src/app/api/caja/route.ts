import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/caja?shiftId=xxx
 * Movimientos y ventas del turno en una sola llamada. Lo usan la pestaña Caja
 * (para el esperado en caja) y la de Cierre (para el cuadre por método).
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const shiftId = new URL(request.url).searchParams.get("shiftId");
    if (!shiftId) {
      return NextResponse.json({ error: "shiftId requerido" }, { status: 400 });
    }

    const [movRes, salesRes] = await Promise.all([
      supabaseServer
        .from("cash_movements")
        .select("id, amount, type, method, reason, created_at")
        .eq("shift_id", shiftId)
        .order("created_at", { ascending: false }),
      supabaseServer
        .from("sales")
        .select("id, total, payment_method, ts, sale_payments(method, amount, reference)")
        .eq("shift_id", shiftId)
        .order("ts", { ascending: false }),
    ]);

    if (movRes.error) throw movRes.error;
    if (salesRes.error) throw salesRes.error;

    return NextResponse.json({
      movements: movRes.data ?? [],
      sales: salesRes.data ?? [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
