import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { createTransfer, type TransferItem } from "@/server/transfer.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/transfers — traspaso de stock desde la casa matriz a una sucursal.
 * Body: { items: [{barcode, qty}], toBranchId, reference?, notes? }
 *
 * El origen es siempre la sucursal matriz (resuelto en el servidor); acá
 * sólo se recibe a dónde va.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      items?: TransferItem[];
      toBranchId?: string | null;
      reference?: string | null;
      notes?: string | null;
    };

    if (!body.items?.length) {
      return NextResponse.json({ error: "No hay ítems para traspasar" }, { status: 400 });
    }
    if (!body.toBranchId) {
      return NextResponse.json({ error: "Falta la sucursal destino" }, { status: 400 });
    }

    const result = await createTransfer({
      items: body.items,
      toBranchId: body.toBranchId,
      reference: body.reference ?? null,
      notes: body.notes ?? "TRANSFER",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, count: result.count, transferId: result.transferId });
  } catch (e) {
    return errorResponse(e);
  }
}
