import { supabaseServer } from "@/lib/supabase-server";

/**
 * Conteo físico de inventario (toma de inventario).
 *
 * La diferencia con Recepción es la que hacía falta y no existía: Recepción
 * SUMA (`stock = stock + qty`) y el conteo FIJA (`stock = qty`). Contar con
 * Recepción sumaba lo contado sobre lo que el sistema ya creía tener, y no
 * había forma de decir "hay 5" ni "no hay ninguno".
 *
 * Todo pasa por `apply_stock_absolute`, que:
 *  - escribe `branch_stock` (la fuente de verdad) y deja que el trigger
 *    `branch_stock_sync_products` recalcule `products.stock`;
 *  - registra el delta en `inventory_movements` con motivo `STOCK_COUNT`;
 *  - es idempotente por `opId`, así que un reintento del outbox no puede
 *    volver a mover el stock.
 *
 * El cierre del conteo es lo que responde "qué hay disponible a la fecha":
 * lo que nunca se escaneó queda en 0 y se desactiva.
 */

export interface CountItem {
  barcode: string;
  /** Cantidad contada. 0 es válido y significa "no hay ninguno". */
  qty: number;
}

export interface CountProgress {
  ok: boolean;
  sessionId: string;
  status: "OPEN" | "CLOSED";
  branchId: string;
  openedAt: string;
  openedBy: string | null;
  /** Productos con cantidad contada en esta sesión. */
  contados: number;
  /** Unidades contadas en total. */
  unidades: number;
  /** Productos donde lo contado no coincide con lo que decía el sistema. */
  conDiferencia: number;
  /** Suma de (contado − sistema): negativo es merma. */
  diferenciaNeta: number;
  /** Contados en 0. */
  enCero: number;
  /** Activos que todavía no se escanearon: los que el cierre apagaría. */
  pendientes: number;
  totalCatalogo: number;
}

type Fallo = { ok: false; error: string };

/** Abre el conteo de la sucursal, o devuelve el que ya estaba abierto. */
export async function openCount({
  branchId,
  openedBy,
  zeroNow = false,
}: {
  branchId?: string | null;
  openedBy?: string | null;
  zeroNow?: boolean;
}): Promise<
  | { ok: true; sessionId: string; yaAbierta: boolean; puestosEnCero: number }
  | Fallo
> {
  const { data, error } = await supabaseServer.rpc("open_stock_count", {
    p_branch_id: branchId ?? null,
    p_opened_by: openedBy ?? null,
    p_zero_now: zeroNow,
  });

  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    return { ok: false, error: String(res.error ?? "No se pudo abrir el conteo") };
  }

  return {
    ok: true,
    sessionId: String(res.sessionId),
    yaAbierta: Boolean(res.yaAbierta),
    puestosEnCero: Number(res.puestosEnCero ?? 0),
  };
}

/** Sesión de conteo abierta de una sucursal, si hay alguna. */
export async function findOpenSession(
  branchId?: string | null
): Promise<{ ok: true; sessionId: string | null } | Fallo> {
  let query = supabaseServer
    .from("stock_count_sessions")
    .select("id, branch_id")
    .eq("status", "OPEN")
    .limit(1);

  // Sin sucursal explícita se busca la de la matriz, que es la que usa el RPC.
  if (branchId) {
    query = query.eq("branch_id", branchId);
  } else {
    const { data: def } = await supabaseServer
      .from("branches")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();
    if (def?.id) query = query.eq("branch_id", def.id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessionId: data?.id ? String(data.id) : null };
}

export async function countProgress(
  sessionId: string
): Promise<{ ok: true; progress: CountProgress } | Fallo> {
  const { data, error } = await supabaseServer.rpc("stock_count_progress", {
    p_session_id: sessionId,
  });

  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    return { ok: false, error: String(res.error ?? "No se pudo leer el conteo") };
  }

  return { ok: true, progress: res as unknown as CountProgress };
}

/**
 * Registra las cantidades contadas. `qty` es absoluto: reenviar el mismo lote
 * deja el stock igual, no lo duplica.
 */
export async function applyCount({
  items,
  branchId,
  sessionId,
  opId,
  countedBy,
  reason,
}: {
  items: CountItem[];
  branchId?: string | null;
  sessionId?: string | null;
  opId?: string | null;
  countedBy?: string | null;
  reason?: string | null;
}): Promise<
  | { ok: true; aplicados: number; ajustados: number; desconocidos: string[]; yaAplicada: boolean }
  | Fallo
> {
  // `qty` puede ser 0 ("no hay ninguno"), así que el filtro es por negativos
  // y por código vacío, nunca por "cantidad falsy".
  const payload = (items ?? [])
    .filter((i) => i?.barcode && Number.isFinite(Number(i.qty)) && Number(i.qty) >= 0)
    .map((i) => ({ barcode: String(i.barcode), qty: Number(i.qty) }));

  if (payload.length === 0) return { ok: false, error: "Ningún ítem válido" };

  const { data, error } = await supabaseServer.rpc("apply_stock_absolute", {
    p_items: payload,
    p_branch_id: branchId ?? null,
    p_op_id: opId ?? null,
    p_reason: reason ?? "STOCK_COUNT",
    p_session_id: sessionId ?? null,
    p_counted_by: countedBy ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    return { ok: false, error: String(res.error ?? "No se pudo registrar el conteo") };
  }

  return {
    ok: true,
    aplicados: Number(res.aplicados ?? 0),
    ajustados: Number(res.ajustados ?? 0),
    desconocidos: Array.isArray(res.desconocidos) ? (res.desconocidos as string[]) : [],
    yaAplicada: Boolean(res.yaAplicada),
  };
}

/**
 * Cierra el conteo: lo que nunca se contó queda en 0 y sale del catálogo
 * disponible. Es la operación que define "esto es lo que hay hoy".
 */
export async function closeCount({
  sessionId,
  closedBy,
  zeroUncounted = true,
  deactivateUncounted = true,
}: {
  sessionId: string;
  closedBy?: string | null;
  zeroUncounted?: boolean;
  deactivateUncounted?: boolean;
}): Promise<
  { ok: true; contados: number; puestosEnCero: number; desactivados: number } | Fallo
> {
  const { data, error } = await supabaseServer.rpc("close_stock_count", {
    p_session_id: sessionId,
    p_closed_by: closedBy ?? null,
    p_zero_uncounted: zeroUncounted,
    p_deactivate_uncounted: deactivateUncounted,
  });

  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    return { ok: false, error: String(res.error ?? "No se pudo cerrar el conteo") };
  }

  return {
    ok: true,
    contados: Number(res.contados ?? 0),
    puestosEnCero: Number(res.puestosEnCero ?? 0),
    desactivados: Number(res.desactivados ?? 0),
  };
}
