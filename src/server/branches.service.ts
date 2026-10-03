import { supabaseServer } from "@/lib/supabase-server";
import type { Branch } from "@/types";

export async function getBranches(): Promise<Branch[]> {
  const { data, error } = await supabaseServer
    .from("branches")
    .select("*")
    .eq("is_active", true)
    .order("is_default", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Branch[];
}

export async function getDefaultBranch(): Promise<Branch | null> {
  const { data, error } = await supabaseServer
    .from("branches")
    .select("*")
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Branch) ?? null;
}

/**
 * No hay ninguna sucursal activa a la cual asignar la operación. Las rutas lo
 * devuelven como 409 con el mensaje tal cual: es un problema de datos que
 * tiene que arreglar el dueño, no algo que se resuelva reintentando.
 */
export class SinSucursalError extends Error {
  readonly status = 409;
  constructor() {
    super("No hay una sucursal activa configurada. Pídele al administrador que revise las sucursales.");
    this.name = "SinSucursalError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sucursal a la que va una operación de caja o una venta.
 *
 * El POS mandaba `branchId: null` cuando el selector de sucursal todavía no
 * había cargado (justo después del login, en un teléfono nuevo), y el
 * servidor abría el turno con `branch_id NULL`: un turno que ninguna pantalla
 * de "Principal" veía, así que al recargar se abría otro. Desde acá nunca más
 * se usa una sucursal nula: si la pedida no existe o no está activa, se usa la
 * sucursal por defecto.
 *
 * Lanza `SinSucursalError` (409) si no hay ninguna sucursal activa.
 */
export async function resolveBranchId(pedida?: string | null): Promise<string> {
  if (pedida && UUID_RE.test(pedida)) {
    const { data, error } = await supabaseServer
      .from("branches")
      .select("id")
      .eq("id", pedida)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data.id as string;
  }

  // La por defecto, y si nadie la marcó como tal, la primera activa: una
  // instalación con una sola sucursal no siempre tiene `is_default`.
  const { data, error } = await supabaseServer
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new SinSucursalError();
  return data.id as string;
}
