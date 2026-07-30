import { NextRequest, NextResponse } from "next/server";
import { getShiftsHistory } from "@/server/reports.service";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/shifts?from=ISO&to=ISO&branchId=uuid&limit=50
 * Historial de turnos con el cuadre por método (closed_by_method).
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;
    const branchId = searchParams.get("branchId");
    const limit = Number(searchParams.get("limit")) || 50;

    const shifts = await getShiftsHistory({ from, to, branchId, limit });
    return NextResponse.json({ shifts });
  } catch (e) {
    return errorResponse(e);
  }
}
