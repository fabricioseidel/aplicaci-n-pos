import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { applyCount, type CountItem } from "@/server/stock-count.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventario/conteo/items — registra cantidades contadas.
 * Body: { items: [{barcode, qty}], sessionId?, branchId?, opId? }
 *
 * `qty` es la cantidad REAL que hay, no un incremento. Por eso reenviar el
 * mismo lote (el outbox reintentando tras una caída de red) deja el stock
 * exactamente igual; `opId` además lo deduplica en la base.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      items?: CountItem[];
      sessionId?: string | null;
      branchId?: string | null;
      opId?: string | null;
    };

    if (!body.items?.length) {
      return NextResponse.json({ error: "No hay ítems para contar" }, { status: 400 });
    }

    const result = await applyCount({
      items: body.items,
      branchId: body.branchId ?? null,
      sessionId: body.sessionId ?? null,
      opId: body.opId ?? null,
      countedBy: auth.session.user?.name ?? auth.session.user?.email ?? auth.userId ?? null,
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({
      ok: true,
      aplicados: result.aplicados,
      ajustados: result.ajustados,
      desconocidos: result.desconocidos,
      yaAplicada: result.yaAplicada,
      soloAnotado: result.soloAnotado,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
