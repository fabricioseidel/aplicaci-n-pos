import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { asignarDueno, AsignacionError } from "@/server/comprasPropias.service";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/compras-propias/asignar — Body: { saleId, sellerId, atendio? }
 *
 * Cualquiera del personal puede asignar una compra SIN dueño (queda anotado
 * quién atendía); cambiar un dueño ya asignado no se hace desde acá. 409 si
 * ya tiene dueño o ya se liquidó.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      saleId?: number;
      sellerId?: string;
      atendio?: string;
    };
    const saleId = Number(body.saleId);
    if (!Number.isInteger(saleId) || saleId <= 0 || !body.sellerId || !UUID_RE.test(body.sellerId)) {
      return NextResponse.json({ error: "Falta la compra o la persona" }, { status: 400 });
    }
    const cuenta = auth.session.user?.email ?? auth.userId;
    const atendio = (body.atendio ?? "").trim().slice(0, 60);
    const r = await asignarDueno(saleId, body.sellerId, atendio ? `${atendio} · ${cuenta}` : cuenta);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof AsignacionError) return errorResponse(e, e.status);
    return errorResponse(e);
  }
}
