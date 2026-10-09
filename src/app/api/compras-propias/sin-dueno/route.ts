import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { listarSinDueno } from "@/server/comprasPropias.service";

export const dynamic = "force-dynamic";

/** GET /api/compras-propias/sin-dueno — compras del personal por cobrar sin persona asignada. */
export async function GET() {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ compras: await listarSinDueno() });
  } catch (e) {
    return errorResponse(e);
  }
}
