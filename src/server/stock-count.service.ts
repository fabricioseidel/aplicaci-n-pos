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
 * El cierre aplica lo contado. Solo en un conteo total (ADMIN, ver la ruta
 * `cerrar`) además deja en 0 y desactiva lo que nunca se escaneó.
 */

/** Cómo se aplica lo contado. Ver el comentario de arriba. */
export type CountApplyMode = "ON_CLOSE" | "LIVE";

/**
 * Cómo empieza el inventario. `KEEP`: se mantiene el stock actual y sólo
 * cambia lo escaneado. `ZERO`: parte desde 0, lo que no se cuente queda en 0
 * al cerrar. No toca el stock al abrir: es la regla con la que se cierra.
 */
export type CountStartMode = "KEEP" | "ZERO";

export interface CountItem {
  barcode: string;
  /** Vencimiento visto en este lugar, "YYYY-MM-DD". Opcional. */
  expiry?: string | null;
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
  startMode: CountStartMode;
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

/** "YYYY-MM-DD" de una fecha que existe. */
export function esFecha(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Abre el conteo de la sucursal, o devuelve el que ya estaba abierto. */
export async function openCount({
  branchId,
  openedBy,
  zeroNow = false,
  applyMode = "ON_CLOSE",
  startMode = "KEEP",
}: {
  startMode?: CountStartMode;
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

  // La regla de inicio sólo la fija quien abre: si ya había un inventario
  // abierto, manda la que eligió esa persona.
  if (!res.yaAbierta && startMode === "ZERO") {
    const { error: errModo } = await supabaseServer
      .from("stock_count_sessions")
      .update({ start_mode: "ZERO" })
      .eq("id", String(res.sessionId));
    if (errModo) return { ok: false, error: errModo.message };
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

  // `start_mode` vive en la sesión y no en el RPC de avance. Si la columna
  // todavía no existe en la base, se asume KEEP (el comportamiento de antes).
  const { data: fila } = await supabaseServer
    .from("stock_count_sessions")
    .select("start_mode")
    .eq("id", sessionId)
    .maybeSingle();
  const startMode: CountStartMode =
    (fila as { start_mode?: string } | null)?.start_mode === "ZERO" ? "ZERO" : "KEEP";

  return { ok: true, progress: { ...(res as unknown as CountProgress), startMode } };
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

  // Precio vigente y vencimiento de cada marca del lote. Va aparte del RPC de
  // conteo y es idempotente: si falla, lo contado ya quedó guardado igual.
  if (sessionId && opId) {
    const anotaciones = (items ?? [])
      .filter((i) => i?.barcode && esFecha(i.expiry))
      .map((i) => ({ barcode: String(i.barcode), expiry: String(i.expiry) }));
    const { error: errAnota } = await supabaseServer.rpc("stock_count_annotate", {
      p_session_id: sessionId,
      p_op_id: opId,
      p_items: anotaciones,
    });
    if (errAnota) console.error("[inventario] stock_count_annotate:", errAnota.message);
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
}): Promise<
  | {
      ok: true;
      contado: number;
      marcas: number;
      /** Quién contó cuánto: "Mariana 3 · Alfredo 5 · Fabricio 2". */
      porPersona: Array<{ por: string; qty: number }>;
      vencimiento: string | null;
    }
  | Fallo
> {
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
    porPersona: Array.isArray(res.porPersona)
      ? (res.porPersona as Array<{ por?: unknown; qty?: unknown }>).map((x) => ({
          por: String(x.por ?? "Sin nombre"),
          qty: Number(x.qty ?? 0),
        }))
      : [],
    vencimiento: typeof res.vencimiento === "string" ? res.vencimiento : null,
  };
}

export interface LoteHistorial {
  lote: string;
  por: string;
  guardado: string;
  productos: number;
  unidades: number;
  items: Array<{
    barcode: string;
    name: string;
    qty: number;
    expiry: string | null;
    price: number | null;
  }>;
}

export interface HistorialConteo {
  totalLotes: number;
  lotes: LoteHistorial[];
  porPersona: Array<{ por: string; lotes: number; productos: number; unidades: number; ultimo: string }>;
  /** Marcas borradas al corregir un producto (quedan guardadas aparte). */
  anuladas: number;
}

/**
 * Historial de un inventario: cada lote guardado es una subida (quién, cuándo,
 * qué productos) y el total por persona. Sirve para sesiones abiertas y cerradas.
 */
export async function countHistory(
  sessionId: string,
  limite = 100
): Promise<{ ok: true; historial: HistorialConteo } | Fallo> {
  const { data, error } = await supabaseServer.rpc("stock_count_history", {
    p_session_id: sessionId,
    p_limit: limite,
  });
  if (error) return { ok: false, error: error.message };

  const res = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    historial: {
      totalLotes: Number(res.totalLotes ?? 0),
      lotes: Array.isArray(res.lotes) ? (res.lotes as LoteHistorial[]) : [],
      porPersona: Array.isArray(res.porPersona)
        ? (res.porPersona as HistorialConteo["porPersona"])
        : [],
      anuladas: Number(res.anuladas ?? 0),
    },
  };
}

export interface SesionResumen {
  sessionId: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
}

/** Últimos inventarios de la sucursal, del más nuevo al más viejo. */
export async function recentSessions(
  branchId?: string | null,
  limite = 8
): Promise<{ ok: true; sesiones: SesionResumen[] } | Fallo> {
  let query = supabaseServer
    .from("stock_count_sessions")
    .select("id, status, opened_at, opened_by, closed_at, closed_by")
    .order("opened_at", { ascending: false })
    .limit(limite);
  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    sesiones: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      sessionId: String(r.id),
      status: r.status === "OPEN" ? "OPEN" : "CLOSED",
      openedAt: String(r.opened_at),
      openedBy: (r.opened_by as string | null) ?? null,
      closedAt: (r.closed_at as string | null) ?? null,
      closedBy: (r.closed_by as string | null) ?? null,
    })),
  };
}

/**
 * Cierra el conteo.
 *
 * En modo `ON_CLOSE` es acá donde se escribe el stock, corrigiendo producto por
 * producto lo que se vendió o recibió después de contarlo. Con
 * `zeroUncounted`/`deactivateUncounted` (conteo total) lo que nunca se contó
 * queda en 0 y sale del catálogo; sin ellos (góndola) queda como estaba.
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

/**
 * Productos activos que todavía no se contaron en la sesión: los que un
 * cierre "conteo total" pondría en 0 y sacaría del catálogo. Para revisarlos
 * antes de confirmar.
 */
export async function uncountedProducts(
  sessionId: string,
  limite = 300
): Promise<
  { ok: true; total: number; productos: Array<{ barcode: string; name: string; stock: number }> } | Fallo
> {
  const [entradas, productos] = await Promise.all([
    supabaseServer.from("stock_count_entries").select("product_barcode").eq("session_id", sessionId).limit(50000),
    supabaseServer
      .from("products")
      .select("barcode, name, stock, is_active")
      .or("is_active.is.null,is_active.eq.true")
      .order("name", { ascending: true })
      .limit(50000),
  ]);
  if (entradas.error) return { ok: false, error: entradas.error.message };
  if (productos.error) return { ok: false, error: productos.error.message };

  const contados = new Set(
    ((entradas.data ?? []) as Array<{ product_barcode: string }>).map((e) => e.product_barcode)
  );
  const faltan = ((productos.data ?? []) as Array<{ barcode: string; name: string | null; stock: number | null }>)
    .filter((p) => !contados.has(p.barcode))
    .map((p) => ({ barcode: p.barcode, name: p.name ?? "(sin nombre)", stock: Number(p.stock ?? 0) }));
  // Primero los que tienen stock: son los que el cierre realmente cambia.
  faltan.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));
  return { ok: true, total: faltan.length, productos: faltan.slice(0, limite) };
}
