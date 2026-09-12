import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { countedProduct } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/conteo/producto?sessionId=…&barcode=…
 * → cuánto lleva contado ese producto en la sesión abierta.
 *
 * Sirve para avisar "ya contaste 3 de esto" cuando el mismo producto aparece
 * en dos lugares del recorrido, y para ofrecer corregir en vez de sumar. Es
 * informativo: si falla (sin red), el conteo sigue siendo correcto porque
 * sumar no necesita conocer el total previo.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const params = new URL(req.url).searchParams;
    const sessionId = (params.get("sessionId") ?? "").trim();
    const barcode = (params.get("barcode") ?? "").trim();

    if (!sessionId || !barcode) {
      return NextResponse.json({ error: "Falta sessionId o barcode" }, { status: 400 });
    }

    const res = await countedProduct({ sessionId, barcode });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

    return NextResponse.json({ ok: true, contado: res.contado, marcas: res.marcas });
  } catch (e) {
    return errorResponse(e);
  }
}
