import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { infoRecepcion } from "@/server/reception.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/recepcion?barcodes=a,b,c — precio, costo (solo ADMIN),
 * si el costo lo fija un proveedor y la regla de margen de cada producto de
 * la recepción en curso. Ver `infoRecepcion`.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const raw = new URL(req.url).searchParams.get("barcodes") ?? "";
    const barcodes = raw.split(",").map((b) => b.trim()).filter(Boolean);
    const items = await infoRecepcion(barcodes, auth.role === "ADMIN");
    return NextResponse.json({ items, verCosto: auth.role === "ADMIN" });
  } catch (e) {
    return errorResponse(e);
  }
}
