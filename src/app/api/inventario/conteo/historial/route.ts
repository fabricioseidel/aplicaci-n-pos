import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { countHistory, recentSessions } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/conteo/historial
 *
 * - `?sessionId=…` → lotes guardados de ese inventario (quién, cuándo, qué
 *   productos) y el total por persona. Vale para abiertos y cerrados.
 * - `?branchId=…` (sin sessionId) → los últimos inventarios de la sucursal.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(req.url).searchParams;
    const sessionId = (params.get("sessionId") ?? "").trim();

    if (!sessionId) {
      const res = await recentSessions(params.get("branchId"));
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, sesiones: res.sesiones });
    }

    const res = await countHistory(sessionId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...res.historial });
  } catch (e) {
    return errorResponse(e);
  }
}
