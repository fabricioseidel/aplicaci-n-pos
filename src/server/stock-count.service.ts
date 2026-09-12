import { supabaseServer } from "@/lib/supabase-server";

/**
 * Conteo físico de inventario (toma de inventario).
 *
 * La diferencia con Recepción es la que hacía falta y no existía: Recepción
 * SUMA (`stock = stock + qty`) y el conteo FIJA (`stock = qty`). Contar con
 * Recepción sumaba lo contado sobre lo que el sistema ya creía tener, y no
 * había forma de decir "hay 5" ni "no hay ninguno".
 *
 * Hay dos modos, y el que importa es el primero:
 *
 * - **`ON_CLOSE` (por defecto): el conteo es independiente de las ventas.**
 *   Escanear sólo ANOTA; el stock no se toca. La tienda sigue vendiendo con
 *   sus números durante todo el conteo. Al cerrar se aplica todo junto y se
 *   corrige lo que se movió en el medio:
 *
 *       final = contado + (stock_de_ahora − stock_cuando_se_contó)
 *
 *   Contaste 8 a las 10:00 (el sistema decía 6), se vendieron 3 durante el
 *   día: al cerrar queda 5. Sin esa corrección quedaría 8 y las tres ventas
 *   del día desaparecerían del inventario.
 *
 * - `LIVE`: fija el stock en cada lote. Para recontar un par de productos con
 *   la tienda cerrada y verlos corregidos al instante.
 *
 * Todo pasa por `apply_stock_absolute`, que además es idempotente por `opId`:
 * un reintento del outbox no puede volver a mover el stock.
 *
 * El cierre es lo que responde "qué hay disponible a la fecha": lo que nunca
 * se escaneó queda en 0 y se desactiva.
 */

/** Cómo se aplica lo contado. Ver el comentario de arriba. */
export type CountApplyMode = "ON_CLOSE" | "LIVE";

export interface CountItem {
  barcode: string;
  /**
   * Cantidad vista en ESTE lugar. 0 es válido y significa "acá no hay".
   * Se suma a lo que ya se haya contado del producto en la sesión.
   */
  qty: number;
  /**
   * Reinicia lo contado de este producto en la sesión y deja sólo `qty`. Es
   * para corregir un error de tipeo, no para contar otro lugar.
   */
  replace?: boolean;
}

export interface CountProgress {
  ok: boolean;
  sessionId: string;
  status: "OPEN" | "CLOSED";
  applyMode: CountApplyMode;
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
  /** Escaneos guardados (un producto puede tener varios, uno por lugar). */
  marcas: number;
  /** Productos vistos en más de un lugar: los que antes se sobreescribían. */
  enVariosLugares: number;
  /**
   * Productos que se vendieron o recibieron después de haberse contado. Es la
   * vista previa de la corrección del cierre, no una alerta: en un conteo con
   * la tienda abierta es normal que crezca durante el día.
   */
  movidosDesdeElConteo: number;
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
  applyMode = "ON_CLOSE",
}: {
  branchId?: string | null;
  openedBy?: string | null;
  zeroNow?: boolean;
  applyMode?: CountApplyMode;
}): Promise<
  | {
      ok: true;
      sessionId: string;
      yaAbierta: boolean;
      puestosEnCero: number;
      applyMode: CountApplyMode;
    }
  | Fallo
> {
  const { data, error } = await supabaseServer.rpc("open_stock_count", {
    p_branch_id: branchId ?? null,
    p_opened_by: openedBy ?? null,
    p_zero_now: zeroNow,
    p_apply_mode: applyMode,
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
    applyMode: (res.applyMode === "LIVE" ? "LIVE" : "ON_CLOSE") as CountApplyMode,
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
  | {
      ok: true;
      aplicados: number;
      ajustados: number;
      desconocidos: string[];
      yaAplicada: boolean;
      /** true si sólo se anotó: el stock se aplica al cerrar el conteo. */
      soloAnotado: boolean;
      /** De los aplicados, cuántos se sumaron a un conteo previo del producto. */
      sumados: number;
    }
  | Fallo
> {
  // `qty` puede ser 0 ("no hay ninguno"), así que el filtro es por negativos
  // y por código vacío, nunca por "cantidad falsy".
  const payload = (items ?? [])
    .filter((i) => i?.barcode && Number.isFinite(Number(i.qty)) && Number(i.qty) >= 0)
    .map((i) => ({
      barcode: String(i.barcode),
      qty: Number(i.qty),
      replace: i.replace === true,
    }));

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
    soloAnotado: Boolean(res.soloAnotado),
    sumados: Number(res.sumados ?? 0),
  };
}

/**
 * Cuánto lleva contado un producto en la sesión abierta.
 *
 * Es sólo informativo —sumar no necesita saber el total previo, y por eso el
 * conteo sigue siendo correcto sin conexión—, pero en pantalla evita la duda
 * de "¿esto ya lo conté?" cuando el mismo producto está en dos lugares.
 */
export async function countedProduct({
  sessionId,
  barcode,
}: {
  sessionId: string;
  barcode: string;
}): Promise<{ ok: true; contado: number; marcas: number } | Fallo> {
  const { data, error } = await supabaseServer.rpc("stock_count_product", {
    p_session_id: sessionId,
    p_barcode: barcode,
  });

  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    contado: Number(res.contado ?? 0),
    marcas: Number(res.marcas ?? 0),
  };
}

/**
 * Cierra el conteo.
 *
 * En modo `ON_CLOSE` es acá donde se escribe el stock, corrigiendo producto por
 * producto lo que se vendió o recibió después de contarlo. Lo que nunca se
 * contó queda en 0 y sale del catálogo disponible. Es la operación que define
 * "esto es lo que hay hoy".
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
  | {
      ok: true;
      applyMode: CountApplyMode;
      contados: number;
      /** Productos cuyo stock se escribió al cerrar (modo borrador). */
      aplicados: number;
      /** De esos, cuántos se corrigieron por ventas o recepciones del medio. */
      corregidos: number;
      /** Se vendió más de lo contado: quedaron en 0. Vale revisarlos. */
      enNegativo: number;
      puestosEnCero: number;
      desactivados: number;
    }
  | Fallo
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
    applyMode: (res.applyMode === "LIVE" ? "LIVE" : "ON_CLOSE") as CountApplyMode,
    contados: Number(res.contados ?? 0),
    aplicados: Number(res.aplicados ?? 0),
    corregidos: Number(res.corregidos ?? 0),
    enNegativo: Number(res.enNegativo ?? 0),
    puestosEnCero: Number(res.puestosEnCero ?? 0),
    desactivados: Number(res.desactivados ?? 0),
  };
}
