import { supabaseServer } from "@/lib/supabase-server";

export interface ShiftHistoryRow {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  started_at: string;
  ended_at: string | null;
  starting_cash: number;
  expected_cash: number;
  actual_cash: number | null;
  difference: number | null;
  status: "OPEN" | "CLOSED";
  notes: string | null;
  closed_by_method: Record<string, { expected: number; actual: number; difference: number }> | null;
  hours_open: number;
}

/** Historial de turnos con cuadre por método, desde la vista v_shifts_history. */
export async function getShiftsHistory(opts: {
  from?: string;
  to?: string;
  branchId?: string | null;
  limit?: number;
}): Promise<ShiftHistoryRow[]> {
  let q = supabaseServer
    .from("v_shifts_history")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.from) q = q.gte("started_at", opts.from);
  if (opts.to) q = q.lte("started_at", opts.to);
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);

  const { data, error } = await q;
  if (error) throw new Error(`getShiftsHistory falló: ${error.message}`);
  return (data as ShiftHistoryRow[]) ?? [];
}
