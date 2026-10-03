import type { PosPaymentMethod } from "./payments";

/**
 * Cobro de una venta: filas de pago, vuelto y si se puede confirmar.
 *
 * Lógica pura (la pantalla sólo la dibuja) porque acá estaban los errores que
 * más plata costaban: el monto se quedaba en el precio del primer producto
 * ("Falta $X" con el cliente esperando) y, con la compra propia, el monto sin
 * descuento mostraba un vuelto que no correspondía.
 */

export interface FilaPago {
  id: string;
  method: PosPaymentMethod;
  amount: number;
  /**
   * Mientras es `true`, el monto sigue solo a lo que falta pagar: agregar un
   * producto lo actualiza. Escribir un monto o tocar un billete lo apaga;
   * "Exacto" lo vuelve a prender.
   */
  auto: boolean;
  reference?: string;
}

export interface Cobro {
  /** Suma de lo recibido (efectivo incluido el que se devuelve). */
  pagado: number;
  falta: number;
  vuelto: number;
  /** Efectivo que queda en la caja: lo recibido menos el vuelto. */
  efectivoAplicado: number;
  ok: boolean;
  /** Por qué no se puede confirmar, en palabras de mostrador. */
  motivo: string | null;
}

/** Efectivo recibido por encima de esto pide confirmar ("¿Recibiste $200.000?"). */
export const EXCESO_EFECTIVO_CONFIRMAR = 20000;

const sum = (filas: FilaPago[], pred: (f: FilaPago) => boolean) =>
  filas.filter(pred).reduce((a, f) => a + (Number(f.amount) || 0), 0);

/**
 * Recalcula los montos automáticos: cada fila `auto` toma lo que falta
 * después de las filas fijas y de las automáticas anteriores.
 */
export function ajustarAuto(total: number, filas: FilaPago[]): FilaPago[] {
  let restante = Math.max(0, total - sum(filas, (f) => !f.auto));
  let cambio = false;
  const next = filas.map((f) => {
    if (!f.auto) return f;
    const amount = restante;
    restante = 0;
    if (amount === f.amount) return f;
    cambio = true;
    return { ...f, amount };
  });
  return cambio ? next : filas;
}

export function calcularCobro(total: number, filas: FilaPago[]): Cobro {
  const efectivo = sum(filas, (f) => f.method === "CASH");
  const otros = sum(filas, (f) => f.method !== "CASH");
  const pagado = efectivo + otros;

  if (otros > total) {
    return {
      pagado,
      falta: 0,
      vuelto: 0,
      efectivoAplicado: 0,
      ok: false,
      motivo: "La tarjeta o transferencia no puede ser mayor que el total",
    };
  }

  const efectivoDebido = total - otros;
  const vuelto = Math.max(0, efectivo - efectivoDebido);
  const falta = Math.max(0, total - pagado);
  const ok = total > 0 && falta === 0;

  return {
    pagado,
    falta,
    vuelto,
    efectivoAplicado: Math.min(efectivo, efectivoDebido),
    ok,
    motivo: ok ? null : total <= 0 ? "El carrito está vacío" : `Falta $${falta.toLocaleString("es-CL")}`,
  };
}

/**
 * Pagos para el servidor: las filas que no son efectivo tal cual, y una sola
 * fila de efectivo con lo que queda en la caja (sin el vuelto). Así la suma
 * da exacto el total, que es lo que valida `createSale`.
 */
export function pagosParaServidor(total: number, filas: FilaPago[]) {
  const { efectivoAplicado } = calcularCobro(total, filas);
  const pagos: { method: PosPaymentMethod; amount: number; reference?: string }[] = filas
    .filter((f) => f.method !== "CASH" && f.amount > 0)
    .map((f) => ({ method: f.method, amount: f.amount, ...(f.reference ? { reference: f.reference } : {}) }));
  if (efectivoAplicado > 0) pagos.push({ method: "CASH", amount: efectivoAplicado });
  return pagos;
}
