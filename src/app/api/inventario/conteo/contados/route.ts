import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { countedList } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventario/conteo/contados?sessionId=… → todo lo ya escaneado en
 * el inventario, por producto (total, veces guardado, quién contó cuánto).
 *
 * Es lo que la pantalla muestra en "Ya escaneados" y lo que usa para avisar,
 * en el momento de escanear, que ese producto ya se contó: sin ese aviso se
 * vuelve a contar el mismo estante y el total queda inflado.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const sessionId = (new URL(req.url).searchParams.get("sessionId") ?? "").trim();
    if (!sessionId) return NextResponse.json({ error: "Falta sessionId" }, { status: 400 });

    const res = await countedList(sessionId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, productos: res.productos });
  } catch (e) {
    return errorResponse(e);
  }
}
