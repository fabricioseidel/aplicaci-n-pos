import { supabaseServer } from "@/lib/supabase-server";

/**
 * Traduce un `users.id` (el que trae la sesión) al `sellers.id` correspondiente.
 *
 * Hace falta porque `sales.seller_id` tiene FK contra `sellers(id)`, no contra
 * `users(id)`: guardar ahí el id de sesión viola la FK y el UPDATE se pierde
 * (es lo que le pasa hoy a OlivoWeb, que lo escribe directo y sólo loguea el
 * error). Si el usuario no tiene fila en `sellers`, se devuelve null y la
 * venta queda identificada por `seller_name`.
 */
export async function resolveSellerId(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await supabaseServer
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[sales] no se pudo resolver el vendedor:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Métodos aceptados por la base (enum payment_method).
 * CARD unifica débito/crédito/prepago. DEBIT/CREDIT/WALLET se conservan sólo
 * porque existen en registros históricos.
 */
export type SalePaymentMethod =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "STAFF_CREDIT"
  | "DEBIT"
  | "CREDIT"
  | "WALLET"
  | "OTHER";

export interface SalePaymentInput {
  method: SalePaymentMethod;
  amount: number;
  reference?: string | null;
}

export interface SaleItemInput {
  barcode: string;
  name?: string;
  /** Decimal cuando el producto se vende por peso (kg). */
  qty: number;
  unit_price: number;
  subtotal: number;
  discount?: number;
}

export interface CreateSaleInput {
  branchId?: string | null;
  shiftId?: string | null;
  total: number;
  discount?: number;
  tax?: number;
  notes?: string | null;
  cashReceived?: number;
  changeGiven?: number;
  sellerName?: string | null;
  /** Debe ser un `sellers.id` (ver resolveSellerId), no un `users.id`. */
  sellerId?: string | null;
  transferReceiptUri?: string | null;
  transferReceiptName?: string | null;
  /** Compra de personal (descuento fijo, asociada al vendedor). */
  isStaffPurchase?: boolean;
  /** Tasa de descuento del personal vigente al registrar la venta. */
  staffDiscountRate?: number;
  /** Clave de idempotencia. Es LA pieza que hace segura la cola offline. */
  clientSaleId?: string;
  payments: SalePaymentInput[];
  items: SaleItemInput[];
}

/**
 * Crea una venta usando el RPC apply_sale: una sola transacción que inserta
 * sales + sale_items + sale_payments, decrementa branch_stock, mantiene
 * products.stock en sync y registra inventory_movements (OUT) por ítem.
 *
 * Idempotente vía `p_client_sale_id`: reintentar el mismo POST (lo que hace
 * el drenaje del outbox tras recuperar la red) no duplica la venta.
 *
 * `qty` viaja tal cual, decimales incluidos: las columnas de cantidad ya son
 * numeric en la base, así que un 0.350 kg no se trunca a 0.
 */
export async function createSale(input: CreateSaleInput): Promise<{ id: number }> {
  const clientSaleId =
    input.clientSaleId ?? `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (!input.items?.length) {
    throw new Error("La venta no tiene ítems");
  }

  // La suma de pagos debe coincidir con el total (tolerancia de 1 centavo).
  const paymentSum = input.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  if (Math.abs(paymentSum - input.total) > 0.01) {
    throw new Error(
      `Suma de pagos ($${paymentSum}) no coincide con el total ($${input.total})`
    );
  }

  // payment_method principal, para la columna legacy de `sales`.
  const primary = input.payments[0]?.method?.toLowerCase() ?? "cash";

  const { data, error } = await supabaseServer.rpc("apply_sale", {
    p_total: input.total,
    p_payment_method: primary,
    p_cash_received: input.cashReceived ?? 0,
    p_change_given: input.changeGiven ?? 0,
    p_discount: input.discount ?? 0,
    p_tax: input.tax ?? 0,
    p_notes: input.notes ?? null,
    p_device_id: "pos-web",
    p_client_sale_id: clientSaleId,
    p_items: input.items.map((it) => ({
      barcode: it.barcode,
      name: it.name ?? "Producto",
      qty: it.qty,
      unit_price: it.unit_price,
      subtotal: it.subtotal,
      discount: it.discount ?? 0,
    })),
    p_seller_name: input.sellerName ?? null,
    p_transfer_receipt_uri: input.transferReceiptUri ?? null,
    p_transfer_receipt_name: input.transferReceiptName ?? null,
    p_branch_id: input.branchId ?? null,
    p_payments: input.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      reference: p.reference ?? null,
    })),
    p_shift_id: input.shiftId ?? null,
  });

  if (error) throw new Error(`apply_sale falló: ${error.message}`);

  const saleId = Number(data);
  if (!Number.isFinite(saleId) || saleId <= 0) {
    throw new Error("apply_sale no devolvió un id válido");
  }

  // seller_id y la marca de compra de personal se escriben aparte: apply_sale
  // es un RPC compartido con otras apps y no se toca su firma sólo por esto.
  // Si este UPDATE falla no se revierte la venta — ya quedó registrada y el
  // stock descontado; se registra el error y sigue.
  if (input.sellerId || input.isStaffPurchase) {
    const { error: markErr } = await supabaseServer
      .from("sales")
      .update({
        ...(input.sellerId ? { seller_id: input.sellerId } : {}),
        ...(input.isStaffPurchase ? { is_staff_purchase: true } : {}),
        ...(input.staffDiscountRate !== undefined
          ? { staff_discount_rate: input.staffDiscountRate }
          : {}),
      })
      .eq("id", saleId);
    if (markErr) {
      console.error("[sales] no se pudo marcar seller_id/compra propia:", markErr.message);
    }
  }

  return { id: saleId };
}
