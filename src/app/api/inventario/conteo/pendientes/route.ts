import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { uncountedProducts } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/** GET /api/inventario/conteo/pendientes?sessionId= — los activos que faltan por contar. */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;
  try {
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ error: "Falta la sesión de conteo" }, { status: 400 });
    const r = await uncountedProducts(sessionId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ total: r.total, productos: r.productos });
  } catch (e) {
    return errorResponse(e);
  }
}
