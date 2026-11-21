import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { createTransfer, listTransfers, type TransferItem } from "@/server/transfer.service";
import { actorDe } from "@/server/productos.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/transfers?branchId=… — últimos traspasos de esa sede (entrantes y
 * salientes): quién, cuándo, desde dónde, hacia dónde y qué productos.
 */
export async function GET(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;
  try {
    const res = await listTransfers(new URL(req.url).searchParams.get("branchId"));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, traspasos: res.traspasos });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/transfers — traspaso de stock entre sedes.
 * Body: { items: [{barcode, qty}], fromBranchId?, toBranchId, atiende?, opId? }
 *
 * Sin `fromBranchId` el origen es la matriz: así siguen entrando los traspasos
 * que un teléfono con la versión anterior dejó en su cola sin conexión.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      items?: TransferItem[];
      fromBranchId?: string | null;
      toBranchId?: string | null;
      reference?: string | null;
      notes?: string | null;
      atiende?: string | null;
      /** Clave de idempotencia del cliente (ver apiWrite.idField). */
      opId?: string | null;
    };

    if (!body.items?.length) {
      return NextResponse.json({ error: "No hay ítems para traspasar" }, { status: 400 });
    }
    if (!body.toBranchId) {
      return NextResponse.json({ error: "Falta la sede destino" }, { status: 400 });
    }

    const result = await createTransfer({
      items: body.items,
      fromBranchId: body.fromBranchId ?? null,
      toBranchId: body.toBranchId,
      reference: body.reference ?? null,
      notes: body.notes ?? "TRANSFER",
      opId: body.opId ?? null,
      actor: actorDe(auth.session, body.atiende),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, count: result.count, transferId: result.transferId });
  } catch (e) {
    return errorResponse(e);
  }
}
