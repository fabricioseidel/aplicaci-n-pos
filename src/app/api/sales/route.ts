import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { createSale, resolveSellerId, type SalePaymentInput } from "@/server/sales.service";
import { normalizePaymentMethod } from "@/lib/pos/payments";

export const dynamic = "force-dynamic";

interface SaleRequestBody {
  total: number;
  branchId?: string | null;
  /** Turno vigente cuando se hizo la venta. Clave para ventas encoladas. */
  shiftId?: string | null;
  payments?: SalePaymentInput[];
  paymentMethod?: string;
  items?: Array<{
    barcode: string;
    name?: string;
    qty: number;
    unit_price: number;
    subtotal: number;
    discount?: number;
  }>;
  notes?: string | null;
  cashReceived?: number;
  changeGiven?: number;
  discount?: number;
  tax?: number;
  transferReceiptUri?: string | null;
  transferReceiptName?: string | null;
  /** Compra de personal: descuento fijo asociado al vendedor que atiende. */
  isStaffPurchase?: boolean;
  /** La compra de personal queda por cobrar (se descuenta del sueldo). */
  staffUnpaid?: boolean;
  staffDiscountRate?: number;
  /** UUID generado en el cliente. Idempotencia de la cola offline. */
  clientSaleId?: string;
}

/**
 * POST /api/sales — registra una venta.
 *
 * Es la escritura crítica de la app y la única que se encola offline, por eso
 * `clientSaleId` viaja hasta `apply_sale`: reintentar el mismo POST no puede
 * cobrar dos veces.
 */
export async function POST(req: Request) {
  const auth = await requireApiAdminOrSeller();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json()) as SaleRequestBody;

    if (!body.items?.length) {
      return NextResponse.json({ error: "Carrito vacío" }, { status: 400 });
    }
    if (!Number.isFinite(body.total) || body.total < 0) {
      return NextResponse.json({ error: "Total inválido" }, { status: 400 });
    }

    /**
     * Toda venta tiene que quedar dentro de un turno abierto, o el arqueo del
     * día no cuadra nunca. Se valida en el servidor a propósito: bloquear sólo
     * la UI no impide que alguien pegue directo al endpoint.
     *
     * Si el cliente manda `shiftId` (venta hecha offline y sincronizada
     * después) se respeta ese turno, aunque ya esté cerrado: la venta ocurrió
     * de verdad dentro de él y moverla al turno actual descuadraría los dos.
     */
    let shiftId: string | null = null;

    if (body.shiftId) {
      const { data: known } = await supabaseServer
        .from("cash_shifts")
        .select("id")
        .eq("id", body.shiftId)
        .maybeSingle();
      shiftId = known?.id ?? null;
    }

    if (!shiftId) {
      // Cada sucursal tiene su propia caja: el turno vigente es el de la
      // sucursal donde se hizo la venta, no "el último abierto" a secas
      // (con dos sucursales operando a la vez eso mezclaría el arqueo).
      let query = supabaseServer
        .from("cash_shifts")
        .select("id")
        .eq("status", "OPEN")
        .order("started_at", { ascending: false })
        .limit(1);
      if (body.branchId) query = query.eq("branch_id", body.branchId);
      const { data: shift } = await query.maybeSingle();
      shiftId = shift?.id ?? null;
    }

    if (!shiftId) {
      return NextResponse.json(
        { error: "No hay caja abierta. Abre la caja antes de registrar ventas." },
        { status: 409 }
      );
    }

    // Una compra propia "por cobrar" no recibe dinero ahora: se registra como
    // STAFF_CREDIT para que no entre al arqueo de caja.
    const payments: SalePaymentInput[] =
      body.payments && body.payments.length > 0
        ? body.payments.map((p) => ({
            ...p,
            method: normalizePaymentMethod(p.method),
          }))
        : [
            {
              method:
                body.isStaffPurchase && body.staffUnpaid
                  ? "STAFF_CREDIT"
                  : normalizePaymentMethod(body.paymentMethod),
              amount: body.total,
            },
          ];

    const result = await createSale({
      branchId: body.branchId ?? null,
      shiftId,
      total: body.total,
      discount: body.discount ?? 0,
      tax: body.tax ?? 0,
      notes: body.notes ?? null,
      cashReceived: body.cashReceived ?? 0,
      changeGiven: body.changeGiven ?? 0,
      sellerName: auth.session.user?.name ?? "POS",
      sellerId: await resolveSellerId(auth.userId),
      transferReceiptUri: body.transferReceiptUri ?? null,
      transferReceiptName: body.transferReceiptName ?? null,
      isStaffPurchase: body.isStaffPurchase ?? false,
      staffDiscountRate: body.staffDiscountRate,
      clientSaleId: body.clientSaleId,
      payments,
      items: body.items,
    });

    return NextResponse.json({ ok: true, saleId: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}
