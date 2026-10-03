import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiAdminOrSeller } from "@/lib/api-auth";
import { errorResponse } from "@/lib/api-response";
import { createSale, resolveSellerId, type SalePaymentInput } from "@/server/sales.service";
import { normalizePaymentMethod } from "@/lib/pos/payments";
import { precioUnitario, totalEsperado, type PrecioFicha } from "@/lib/pos/precios";

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
  /**
   * `sellers.id` del empleado que compra. No se deduce de la sesión: la cuenta
   * del mostrador se comparte y quien cobra no siempre es quien compra.
   */
  staffSellerId?: string | null;
  /** `sellers.id` de quien atiende (selector "¿Quién atiende?"). */
  attendantSellerId?: string | null;
  /** UUID generado en el cliente. Idempotencia de la cola offline. */
  clientSaleId?: string;
  /** Hora real de la venta en el teléfono (ISO). Sin red se sincroniza después. */
  soldAt?: string;
}

/** Una venta "en el futuro" o de hace más de una semana no se cree: se usa la hora del servidor. */
const MAX_FUTURO_MS = 5 * 60 * 1000;
const MAX_ATRASO_MS = 7 * 24 * 60 * 60 * 1000;

function horaDeLaVenta(soldAt: unknown): string | null {
  if (typeof soldAt !== "string") return null;
  const t = Date.parse(soldAt);
  if (!Number.isFinite(t)) return null;
  const ahora = Date.now();
  if (t > ahora + MAX_FUTURO_MS || t < ahora - MAX_ATRASO_MS) return null;
  return new Date(t).toISOString();
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

    // Reintento del outbox: la venta ya ocurrió en el mostrador (y el cliente
    // se fue con el producto). Rechazarla ahora no la deshace, sólo la pierde.
    const esReintento = req.headers.get("x-olivo-replay") === "1";

    for (const it of body.items) {
      if (!(Number(it.qty) > 0)) {
        return NextResponse.json(
          { error: `Cantidad inválida para ${it.name ?? it.barcode}` },
          { status: 400 }
        );
      }
    }
    const sinPrecio = body.items.filter((it) => !(Number(it.unit_price) > 0) || !(Number(it.subtotal) > 0));
    if (sinPrecio.length > 0 && !esReintento) {
      return NextResponse.json(
        {
          error: `${sinPrecio.map((it) => it.name ?? it.barcode).join(", ")} no tiene precio. Ponle precio antes de cobrar.`,
        },
        { status: 400 }
      );
    }
    if (body.total <= 0) {
      // apply_sale no puede registrar una venta en $0 (los pagos deben ser > 0).
      return NextResponse.json(
        { error: "Una venta en $0 no se puede registrar: revisa los precios" },
        { status: esReintento ? 422 : 400 }
      );
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

    // Precios de la ficha, no los del navegador (un catálogo cacheado de hace
    // horas o un payload armado a mano cobraban cualquier cosa).
    const codigos = [...new Set(body.items.map((it) => String(it.barcode)))];
    const { data: fichasRows, error: errFichas } = await supabaseServer
      .from("products")
      .select("barcode, sale_price, offer_price")
      .in("barcode", codigos);
    if (errFichas) throw errFichas;
    const fichas = new Map(
      ((fichasRows ?? []) as (PrecioFicha & { barcode: string })[]).map((f) => [String(f.barcode), f])
    );
    const esperado = totalEsperado(
      body.items.map((it) => ({ barcode: String(it.barcode), qty: Number(it.qty) })),
      fichas,
      Boolean(body.isStaffPurchase)
    );
    let notaPrecio: string | null = null;
    if (esperado.faltantes.length > 0) {
      return NextResponse.json(
        { error: `Producto no encontrado: ${esperado.faltantes.join(", ")}` },
        { status: esReintento ? 422 : 400 }
      );
    }
    if (Math.abs(esperado.total - body.total) > 1) {
      if (!esReintento) {
        // El teléfono actualiza las líneas y se vuelve a confirmar (1 toque).
        const cambiados = body.items
          .filter((it) => {
            const f = fichas.get(String(it.barcode));
            return f && precioUnitario(f) !== Math.round(Number(it.unit_price));
          })
          .map((it) => {
            const f = fichas.get(String(it.barcode))!;
            return {
              barcode: String(it.barcode),
              name: it.name ?? String(it.barcode),
              price: Math.round(Number(f.sale_price ?? 0)),
              offerPrice: Number(f.offer_price ?? 0) > 0 ? Math.round(Number(f.offer_price)) : null,
            };
          });
        return NextResponse.json(
          {
            error: `Cambió el precio${cambiados.length ? ` de ${cambiados.map((c) => c.name).join(", ")}` : ""}. El total correcto es $${esperado.total.toLocaleString("es-CL")}.`,
            code: "PRICE_CHANGED",
            items: cambiados,
            total: esperado.total,
          },
          { status: 409 }
        );
      }
      // Reintento: la venta ya se cobró con esos precios; se registra igual y
      // queda anotada la diferencia para revisarla.
      notaPrecio = `Cobrado $${body.total} y la ficha daba $${esperado.total}`;
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

    // La compra propia se le carga al empleado que compra, nunca a la sesión:
    // el teléfono del mostrador lo usan varias personas con la cuenta de
    // quien abrió la caja. Ventas encoladas por una versión anterior de la
    // app llegan sin `staffSellerId` y se registran como antes.
    const sessionName = auth.session.user?.name ?? "POS";
    let buyer: { id: string; name: string } | null = null;
    if (body.isStaffPurchase && body.staffSellerId) {
      const { data: seller, error: sellerErr } = await supabaseServer
        .from("sellers")
        .select("id, name")
        .eq("id", body.staffSellerId)
        .maybeSingle();
      if (sellerErr) throw sellerErr;
      if (!seller) {
        return NextResponse.json(
          { error: "El empleado elegido para la compra propia no existe" },
          { status: 400 }
        );
      }
      buyer = seller as { id: string; name: string };
    }

    // Quien cobró. Si el id no existe (o es de una versión vieja) se ignora y
    // queda como antes: lo resuelve la sesión.
    let attendant: { id: string; name: string } | null = null;
    if (body.attendantSellerId) {
      const { data: s } = await supabaseServer
        .from("sellers")
        .select("id, name")
        .eq("id", body.attendantSellerId)
        .maybeSingle();
      attendant = (s as { id: string; name: string } | null) ?? null;
    }

    const result = await createSale({
      branchId: body.branchId ?? null,
      shiftId,
      total: body.total,
      discount: body.discount ?? 0,
      tax: body.tax ?? 0,
      notes:
        [body.notes,
          buyer && attendant && attendant.id !== buyer.id ? `Atendió: ${attendant.name}` : null,
          notaPrecio, sinPrecio.length > 0 ? `Línea sin precio: ${sinPrecio.map((it) => it.name ?? it.barcode).join(", ")}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      soldAt: horaDeLaVenta(body.soldAt),
      cashReceived: body.cashReceived ?? 0,
      changeGiven: body.changeGiven ?? 0,
      // En una compra propia el "vendedor" es quien compra (lo que liquida
      // fin de mes); si no, quien atiende, y si no se sabe, la sesión.
      sellerName: buyer?.name ?? attendant?.name ?? sessionName,
      sellerId: buyer?.id ?? attendant?.id ?? (await resolveSellerId(auth.userId)),
      sellerNameIsSeller: Boolean(buyer ?? attendant),
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
