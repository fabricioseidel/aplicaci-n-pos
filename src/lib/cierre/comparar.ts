import { clp } from "@/lib/cierre/denominations";

/**
 * "El POS registró $X, contaste $Y" por método, para el Resumen del cierre.
 *
 * Es sólo informativo: el cierre sigue siendo declarado (lo contado es la
 * verdad del día, ver `registrar_cierre`). Mientras no todas las ventas pasen
 * por el POS puede no cuadrar, pero cuando sí pasan, un descuadre visible
 * ANTES de registrar es la oportunidad de volver a contar.
 *
 * Cada fila compara lo mismo que el cajero tiene en la mano:
 *  - Efectivo: billetes en el cajón. El POS espera inicio + ventas en efectivo
 *    + ingresos − egresos (en efectivo) + abonos de fiado en efectivo.
 *  - Transferencias: lo cargado una por una contra las ventas por
 *    transferencia + abonos por transferencia.
 *  - Tarjeta: el total de los vouchers contra las ventas con tarjeta + abonos.
 */

export type MetodoComparado = "efectivo" | "transferencia" | "tarjeta";

export interface FilaComparacion {
  metodo: MetodoComparado;
  etiqueta: string;
  /** Lo que según el POS debería haber. */
  registro: number;
  /** Lo que contó o cargó el cajero. */
  declarado: number;
  /** declarado − registro: negativo = falta plata. */
  diferencia: number;
  estado: "cuadra" | "faltan" | "sobran";
  /** "faltan $ 2.025", "sobran $ 500" o "cuadra". */
  texto: string;
}

export interface EntradaComparacion {
  pos: { efectivo: number; transferencia: number; tarjeta: number };
  inicio: number;
  ingresos: number;
  egresos: number;
  contado: number;
  transferencias: number;
  vouchers: number;
  abonos: { CASH: number; TRANSFER: number; CARD: number };
}

/** Diferencias de menos de un peso son redondeo, no plata. */
const TOLERANCIA = 1;

export function diferenciaEnPalabras(diferencia: number): Pick<FilaComparacion, "estado" | "texto"> {
  if (Math.abs(diferencia) < TOLERANCIA) return { estado: "cuadra", texto: "cuadra" };
  return diferencia < 0
    ? { estado: "faltan", texto: `faltan ${clp(-diferencia)}` }
    : { estado: "sobran", texto: `sobran ${clp(diferencia)}` };
}

export function compararCierre(e: EntradaComparacion): FilaComparacion[] {
  const fila = (
    metodo: MetodoComparado,
    etiqueta: string,
    registro: number,
    declarado: number
  ): FilaComparacion => {
    const r = Math.round(registro);
    const d = Math.round(declarado);
    return { metodo, etiqueta, registro: r, declarado: d, diferencia: d - r, ...diferenciaEnPalabras(d - r) };
  };

  return [
    fila(
      "efectivo",
      "Efectivo en caja",
      e.inicio + e.pos.efectivo + e.ingresos - e.egresos + e.abonos.CASH,
      e.contado
    ),
    fila("transferencia", "Transferencias", e.pos.transferencia + e.abonos.TRANSFER, e.transferencias),
    fila("tarjeta", "Tarjeta", e.pos.tarjeta + e.abonos.CARD, e.vouchers),
  ];
}
