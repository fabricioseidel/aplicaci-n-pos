import { supabaseServer } from "@/lib/supabase-server";

export type ShiftStatus = "OPEN" | "CLOSED";

export type ShiftPaymentMethod =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "STAFF_CREDIT"
  | "DEBIT"
  | "CREDIT"
  | "WALLET"
  | "OTHER";

export interface ShiftMethodBreakdown {
  expected: number;
  actual: number;
  difference: number;
}

export interface CashShift {
  id: string;
  seller_id?: string | null;
  user_id?: string | null;
  branch_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  starting_cash: number;
  expected_cash: number;
  actual_cash?: number | null;
  difference?: number | null;
  status: ShiftStatus;
  notes?: string | null;
  closed_by_method?: Record<string, ShiftMethodBreakdown> | null;
}

export async function openShift(data: {
  starting_cash: number;
  seller_id?: string | null;
  user_id?: string | null;
  branch_id?: string | null;
  notes?: string | null;
}): Promise<CashShift> {
  const { data: shift, error } = await supabaseServer
    .from("cash_shifts")
    .insert({
      starting_cash: data.starting_cash,
      expected_cash: data.starting_cash,
      ...(data.seller_id ? { seller_id: data.seller_id } : {}),
      ...(data.user_id ? { user_id: data.user_id } : {}),
      ...(data.branch_id ? { branch_id: data.branch_id } : {}),
      status: "OPEN",
      notes: data.notes ?? null,
    })
    .select("*")
    .single();

  // 23503 = foreign_key_violation. El único FK que puede fallar acá viniendo
  // de una sesión viva es user_id: el token trae un uuid que ya no está en
  // `users`. Al cajero no le sirve ver el SQL crudo en el toast.
  if (error?.code === "23503") {
    throw new Error("Tu sesión quedó desactualizada. Cierra sesión y vuelve a entrar.");
  }
  if (error) throw new Error(error.message);
  return shift as CashShift;
}

/**
 * Cierra un turno con el RPC `close_shift`, que calcula el cuadre por método
 * comparando sale_payments + cash_movements contra el conteo físico.
 *
 * `counts` es el monto contado por método: { CASH: 50000, CARD: 12000 }.
 */
export async function closeShift(
  shiftId: string,
  counts: Partial<Record<ShiftPaymentMethod, number>> | number,
  notes?: string | null
): Promise<CashShift & { breakdown?: Record<string, ShiftMethodBreakdown> }> {
  // Compatibilidad: un número suelto se interpreta como conteo de efectivo.
  const countsObj: Partial<Record<ShiftPaymentMethod, number>> =
    typeof counts === "number" ? { CASH: counts } : counts;

  const { data: breakdown, error: rpcError } = await supabaseServer.rpc("close_shift", {
    p_shift_id: shiftId,
    p_counts: countsObj,
  });

  if (rpcError) throw new Error(`close_shift falló: ${rpcError.message}`);

  if (notes) {
    await supabaseServer.from("cash_shifts").update({ notes }).eq("id", shiftId);
  }

  const { data: closed, error: fetchError } = await supabaseServer
    .from("cash_shifts")
    .select("*")
    .eq("id", shiftId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  return {
    ...(closed as CashShift),
    breakdown: (breakdown ?? undefined) as Record<string, ShiftMethodBreakdown> | undefined,
  };
}

/**
 * Turno abierto vigente.
 *
 * `branchId` es la clave de que la caja sea independiente por sucursal: cada
 * una puede tener su propio turno abierto en simultáneo. Sin `branchId` se
 * cae al comportamiento histórico (cualquier turno abierto, sin filtrar) —
 * lo usan llamadas viejas o de un solo local que todavía no mandan sucursal.
 */
export async function getCurrentShift(
  opts?: { branchId?: string | null; sellerId?: string | null } | string | null
): Promise<CashShift | null> {
  // Compatibilidad: la firma anterior recibía sólo `sellerId` como string.
  const { branchId, sellerId } =
    typeof opts === "string" || opts === null || opts === undefined
      ? { branchId: undefined, sellerId: opts }
      : opts;

  let query = supabaseServer
    .from("cash_shifts")
    .select("*")
    .eq("status", "OPEN")
    .order("started_at", { ascending: false })
    .limit(1);

  if (branchId) query = query.eq("branch_id", branchId);
  if (sellerId) query = query.eq("seller_id", sellerId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CashShift) ?? null;
}

export async function addCashMovement(data: {
  shift_id: string;
  amount: number;
  type: "IN" | "OUT";
  reason: string;
  method?: ShiftPaymentMethod;
}) {
  const { error } = await supabaseServer.from("cash_movements").insert(data);
  if (error) throw new Error(error.message);
}
