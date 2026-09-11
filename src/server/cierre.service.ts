import { supabaseServer } from "@/lib/supabase-server";
import type { CierrePayload, CierreResumen, CustomerBalance } from "@/lib/cierre/types";

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
  return data as CierreResumen;
}

export async function obtenerResumen(shiftId: string): Promise<CierreResumen | null> {
  const { data, error } = await supabaseServer.rpc("resumen_cierre", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
  return (data as CierreResumen) ?? null;
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
    .order("business_date", { ascending: false })
    .limit(opts.limite ?? 60);

  if (opts.branchId) query = query.eq("branch_id", opts.branchId);
  if (opts.desde) query = query.gte("business_date", opts.desde);
  if (opts.hasta) query = query.lte("business_date", opts.hasta);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
