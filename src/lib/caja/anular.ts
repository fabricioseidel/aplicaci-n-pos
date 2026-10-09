import { clp } from "@/lib/cierre/denominations";
import { pagosPorGrupo, type VentaTurno } from "./resumenTurno";

/**
 * Reglas para anular una venta desde el POS.
 *
 * Decisión del dueño (por defecto, pendiente de confirmar): un ADMIN puede
 * anular cualquier venta; una vendedora sólo las del turno abierto y de los
 * últimos 30 minutos, que cubre los errores de mostrador (cobré con tarjeta y
 * era efectivo, se duplicó, me equivoqué en la cantidad). Una devolución en la
 * tarde la pide al admin. La misma función la usan la pantalla (para mostrar
 * el botón) y la ruta (que es la que manda: una pestaña vieja no la salta).
 */
export const MINUTOS_ANULAR_VENDEDORA = 30;

export type PermisoAnular = { ok: true } | { ok: false; motivo: string };

export function puedeAnular(input: {
  rol: "ADMIN" | "SELLER" | "USER";
  venta: { ts: string; shift_id?: string | null; voided?: boolean | null };
  /** Turno abierto de la sucursal de la venta (null si no hay). */
  turnoAbiertoId: string | null;
  ahora?: Date;
}): PermisoAnular {
  if (input.venta.voided) return { ok: false, motivo: "La venta ya está anulada." };
  if (input.rol === "ADMIN") return { ok: true };
  if (input.rol !== "SELLER") return { ok: false, motivo: "Tu cuenta no puede anular ventas." };

  if (!input.venta.shift_id || input.venta.shift_id !== input.turnoAbiertoId) {
    return {
      ok: false,
      motivo: "Es de un turno ya cerrado. Sólo un administrador puede anularla.",
    };
  }
  const ahora = (input.ahora ?? new Date()).getTime();
  const minutos = (ahora - new Date(input.venta.ts).getTime()) / 60000;
  if (!(minutos <= MINUTOS_ANULAR_VENDEDORA)) {
    return {
      ok: false,
      motivo: `Pasaron más de ${MINUTOS_ANULAR_VENDEDORA} minutos. Pídele la anulación a un administrador.`,
    };
  }
  return { ok: true };
}

/**
 * Qué hay que devolverle al cliente al anular, en palabras y por método.
 * La compra propia (por cobrar) no devuelve plata: sólo deja de cobrarse.
 */
export function avisoDevolucion(venta: VentaTurno): string[] {
  const p = pagosPorGrupo(venta);
  const out: string[] = [];
  if (p.efectivo > 0) out.push(`Devuelve ${clp(p.efectivo)} en efectivo al cliente.`);
  if (p.tarjeta > 0) out.push(`Tarjeta ${clp(p.tarjeta)}: hay que reversar el cobro en la máquina.`);
  if (p.transferencia > 0) out.push(`Transferencia ${clp(p.transferencia)}: hay que devolverla desde el banco.`);
  if (p.otro > 0) out.push(`Otro medio ${clp(p.otro)}: devuélvelo por el mismo medio.`);
  if (p.porCobrar > 0) out.push(`Compra del personal ${clp(p.porCobrar)}: ya no se descontará del sueldo.`);
  return out;
}

/** "Coca lata ×3, Papas Lays…" para encontrar una venta sin abrirla. */
export function resumenProductos(
  items: Array<{ product_name?: string | null; quantity: number | string }> | null | undefined,
  max = 2
): string {
  if (!items || items.length === 0) return "";
  const nombre = (i: { product_name?: string | null; quantity: number | string }) => {
    const q = Number(i.quantity);
    const n = (i.product_name ?? "Producto").trim();
    if (!Number.isInteger(q)) return `${n} ${q.toLocaleString("es-CL")} kg`;
    return q === 1 ? n : `${n} ×${q}`;
  };
  const primeros = items.slice(0, max).map(nombre).join(", ");
  return items.length > max ? `${primeros} y ${items.length - max} más` : primeros;
}

/** Marca que deja "Pedir anulación al admin" en `sales.notes`. */
export const MARCA_PEDIDO_ANULACION = "Anulación pedida";

export function tienePedidoAnulacion(notes?: string | null): boolean {
  return !!notes && notes.includes(MARCA_PEDIDO_ANULACION);
}
