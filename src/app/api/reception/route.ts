import { NextResponse } from "next/server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { createReception, type ReceptionItem } from "@/server/reception.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/reception — recepción de mercadería.
 * Body: { items: [{barcode, qty, name}], branchId?, reference?, notes? }
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as {
      items?: ReceptionItem[];
      branchId?: string | null;
      reference?: string | null;
      notes?: string | null;
    };

    if (!body.items?.length) {
      return NextResponse.json({ error: "No hay ítems para recibir" }, { status: 400 });
    }

    const result = await createReception({
      items: body.items,
      branchId: body.branchId ?? null,
      reference: body.reference ?? null,
      notes: body.notes ?? "RECEPTION",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, count: result.count });
  } catch (e) {
    return errorResponse(e);
  }
}
