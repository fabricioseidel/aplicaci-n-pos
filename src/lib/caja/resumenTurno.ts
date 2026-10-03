import { normalizePaymentMethod } from "@/lib/pos/payments";

/**
 * Totales del turno abierto (Caja → Turno) a partir de lo que registró el POS.
 *
 * Antes la pantalla sumaba `sales.total` de las ventas cuyo método principal
 * era efectivo: una venta mixta ($5.000 efectivo + $3.070 tarjeta) contaba
 * entera como efectivo, las compras del personal por cobrar inflaban "Total
 * ventas" y las ventas anuladas seguían sumando. Acá se usa la misma regla que
 * `close_shift` y `registrar_cierre` en Postgres: cada pago de
 * `sale_payments` cuenta en su método, sólo de ventas no anuladas, y el
 * esperado en caja es inicio + efectivo + ingresos − egresos en efectivo.
 */

export interface PagoVenta {
  method: string;
  amount: number | string;
  reference?: string | null;
}

export interface VentaTurno {
  id: number;
  total: number | string;
  payment_method?: string | null;
  ts?: string;
  voided?: boolean | null;
  is_staff_purchase?: boolean | null;
  sale_payments?: PagoVenta[] | null;
}

export interface MovimientoTurno {
  amount: number | string;
  type: "IN" | "OUT";
  method?: string | null;
}

export type GrupoMetodo = "efectivo" | "tarjeta" | "transferencia" | "porCobrar" | "otro";

export interface ResumenTurno {
  inicio: number;
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  otro: number;
  /** Compras del personal: no entra plata, se descuenta del sueldo. */
  porCobrar: number;
  /** Efectivo + tarjeta + transferencia + otro. Sin lo por cobrar. */
  totalVentas: number;
  cantidadVentas: number;
  anuladas: { cantidad: number; total: number };
  ingresos: number;
  egresos: number;
  /** Billetes que debería haber en el cajón. */
  esperado: number;
}

/** A qué columna del turno va un método de pago de la base. */
export function grupoDeMetodo(method?: string | null): GrupoMetodo {
  const m = (method ?? "").toUpperCase();
  if (m === "CASH") return "efectivo";
  if (m === "CARD" || m === "DEBIT" || m === "CREDIT" || m === "WALLET") return "tarjeta";
  if (m === "TRANSFER") return "transferencia";
  if (m === "STAFF_CREDIT") return "porCobrar";
  if (m === "OTHER") return "otro";
  // Texto libre de registros viejos ("efectivo", "Tarjeta débito"…).
  const n = normalizePaymentMethod(method);
  return n === "CASH" ? "efectivo" : n === "CARD" ? "tarjeta" : n === "TRANSFER" ? "transferencia" : "porCobrar";
}

/**
 * Pagos de una venta por grupo. Una venta sin filas en `sale_payments`
 * (anteriores al pago mixto) cuenta su total en su método principal.
 */
export function pagosPorGrupo(v: VentaTurno): Record<GrupoMetodo, number> {
  const out: Record<GrupoMetodo, number> = {
    efectivo: 0, tarjeta: 0, transferencia: 0, porCobrar: 0, otro: 0,
  };
  const pagos = v.sale_payments ?? [];
  if (pagos.length === 0) {
    const g = v.is_staff_purchase ? "porCobrar" : grupoDeMetodo(v.payment_method);
    out[g] += Number(v.total) || 0;
    return out;
  }
  for (const p of pagos) out[grupoDeMetodo(p.method)] += Number(p.amount) || 0;
  return out;
}

export function resumenTurno(input: {
  inicio: number | string;
  ventas: VentaTurno[];
  movimientos: MovimientoTurno[];
}): ResumenTurno {
  const inicio = Number(input.inicio) || 0;
  const suma: Record<GrupoMetodo, number> = {
    efectivo: 0, tarjeta: 0, transferencia: 0, porCobrar: 0, otro: 0,
  };
  let cantidadVentas = 0;
  const anuladas = { cantidad: 0, total: 0 };

  for (const v of input.ventas) {
    if (v.voided) {
      anuladas.cantidad += 1;
      anuladas.total += Number(v.total) || 0;
      continue;
    }
    const p = pagosPorGrupo(v);
    for (const g of Object.keys(suma) as GrupoMetodo[]) suma[g] += p[g];
    if (!v.is_staff_purchase) cantidadVentas += 1;
  }

  // Sólo los movimientos en efectivo mueven billetes en el cajón: uno por
  // transferencia no cambia lo que se cuenta al cerrar.
  let ingresos = 0;
  let egresos = 0;
  for (const m of input.movimientos) {
    if ((m.method ?? "CASH").toUpperCase() !== "CASH") continue;
    if (m.type === "IN") ingresos += Number(m.amount) || 0;
    else egresos += Number(m.amount) || 0;
  }

  return {
    inicio,
    efectivo: suma.efectivo,
    tarjeta: suma.tarjeta,
    transferencia: suma.transferencia,
    otro: suma.otro,
    porCobrar: suma.porCobrar,
    totalVentas: suma.efectivo + suma.tarjeta + suma.transferencia + suma.otro,
    cantidadVentas,
    anuladas,
    ingresos,
    egresos,
    esperado: inicio + suma.efectivo + ingresos - egresos,
  };
}
