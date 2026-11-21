import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { stockDeSede } from "@/server/transfer.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/branch-stock?branchId=… → { stock: { [barcode]: cantidad } } de
 * esa sede. Lo usa Traspaso para mostrar cuánto hay en el origen.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;
  try {
    const branchId = (new URL(req.url).searchParams.get("branchId") ?? "").trim();
    if (!branchId) return NextResponse.json({ error: "Falta branchId" }, { status: 400 });
    const mapa = await stockDeSede(branchId);
    return NextResponse.json({ ok: true, stock: Object.fromEntries(mapa) });
  } catch (e) {
    return errorResponse(e);
  }
}
