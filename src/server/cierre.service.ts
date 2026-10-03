import { supabaseServer } from "@/lib/supabase-server";
import type {
  CierrePayload,
  CierreResumen,
  CompraPersonal,
  CustomerBalance,
} from "@/lib/cierre/types";

/**
 * Cliente del cierre declarado.
 *
 * El cálculo vive completo en el RPC `registrar_cierre` de Postgres, no acá:
 * el POS y OlivoWeb son repos distintos contra la misma base, y cuando la
 * lógica de caja se escribió en TypeScript en los dos terminó divergiendo.
 * Este archivo sólo traduce llamadas.
 */

export async function registrarCierre(
  shiftId: string,
  payload: CierrePayload
): Promise<CierreResumen> {
  const { data, error } = await supabaseServer.rpc("registrar_cierre", {
    p_shift_id: shiftId,
    p_payload: payload,
  });

  if (error) throw new Error(`No se pudo registrar el cierre: ${error.message}`);
  return conComprasPersonal(data as CierreResumen);
}

export async function obtenerResumen(shiftId: string): Promise<CierreResumen | null> {
  const { data, error } = await supabaseServer.rpc("resumen_cierre", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
  return data ? conComprasPersonal(data as CierreResumen) : null;
}

/** Compras del personal por cobrar del turno, para el resumen y el PDF. */
export async function comprasPersonalDelTurno(shiftId: string): Promise<CompraPersonal[]> {
  const { data, error } = await supabaseServer
    .from("sales")
    .select("id, ts, total, seller_name, staff_settled_at")
    .eq("shift_id", shiftId)
    .eq("is_staff_purchase", true)
    .eq("voided", false)
    .order("ts", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CompraPersonal[];
}

async function conComprasPersonal(r: CierreResumen): Promise<CierreResumen> {
  return { ...r, compras_personal: await comprasPersonalDelTurno(r.shift.id) };
}

/** Estado de un turno, para no dejar que una vendedora reescriba un cierre. */
export async function estadoTurno(shiftId: string): Promise<"OPEN" | "CLOSED" | null> {
  const { data, error } = await supabaseServer
    .from("cash_shifts")
    .select("status")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.status as "OPEN" | "CLOSED" | undefined) ?? null;
}

/** Saldos de fiado. Por defecto sólo los que deben algo. */
export async function listarCuentas(opts?: { soloConDeuda?: boolean }): Promise<CustomerBalance[]> {
  let query = supabaseServer
    .from("v_customer_balances")
    .select("*")
    .order("balance", { ascending: false });

  if (opts?.soloConDeuda !== false) query = query.gt("balance", 0);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerBalance[];
}

/** Movimientos de una cuenta de fiado, del más reciente al más antiguo. */
export async function movimientosDeCuenta(accountId: string) {
  const { data, error } = await supabaseServer
    .from("account_entries")
    .select("id, kind, amount, occurred_on, method, note, shift_id")
    .eq("account_id", accountId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Cierres ya registrados, para el historial y el consolidado mensual. */
export async function listarCierres(opts: {
  branchId?: string | null;
  desde?: string;
  hasta?: string;
  limite?: number;
}) {
  let query = supabaseServer
    .from("cash_shifts")
    .select("id, business_date, branch_id, started_at, ended_at, starting_cash, actual_cash, status, is_declared, declared_totals, pos_totals, notes")
    .eq("status", "CLOSED")
    // Sólo cierres declarados: los turnos anteriores a este sistema se
    // cerraron sin desglose y aparecerían como días de $0 junto a los reales,
    // inflando la cuenta de "días con cierre" del mes.
    .eq("is_declared", true)
    .order("business_date", { ascending: false })
    .limit(opts.limite ?? 60);

  if (opts.branchId) query = query.eq("branch_id", opts.branchId);
  if (opts.desde) query = query.gte("business_date", opts.desde);
  if (opts.hasta) query = query.lte("business_date", opts.hasta);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
