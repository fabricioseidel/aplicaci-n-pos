import { denominationTotal } from "@/lib/cierre/denominations";
import type { AbonoInput, TransferInput, VoucherInput } from "@/lib/cierre/types";

export interface PreviewCierre {
  contado: number;
  ventasEfectivo: number;
  ventasTransferencia: number;
  ventasTarjeta: number;
  totalVentas: number;
  totalFiado: number;
  totalAbonos: number;
}

/**
 * Adelanto de los totales para mostrarlos mientras se llena el cierre.
 *
 * Repite las fórmulas del RPC `registrar_cierre` a propósito y sólo para eso:
 * el cajero necesita ver el total antes de confirmar. El número que queda
 * guardado es siempre el que devuelve Postgres, no éste — si alguna vez
 * difieren, manda el del servidor.
 */
export function calcularPreview(input: {
  denominations: Record<number, number>;
  cashCounted: number | null;
  transfers: TransferInput[];
  vouchers: VoucherInput[];
  abonos: AbonoInput[];
  fiados: Array<{ amount: number }>;
  sencilloInicial: number;
  ingresos: number;
  egresos: number;
}): PreviewCierre {
  const hayConteo = Object.values(input.denominations).some((q) => q > 0);
  const contado = hayConteo ? denominationTotal(input.denominations) : input.cashCounted ?? 0;

  const abonosPor = (m: AbonoInput["method"]) =>
    input.abonos.filter((a) => a.method === m).reduce((acc, a) => acc + Number(a.amount), 0);

  const brutoTransferencias = input.transfers.reduce((a, t) => a + Number(t.amount), 0);
  const brutoTarjeta = input.vouchers.reduce((a, v) => a + Number(v.total_amount), 0);

  const ventasEfectivo =
    contado - input.sencilloInicial - input.ingresos + input.egresos - abonosPor("CASH");
  const ventasTransferencia = brutoTransferencias - abonosPor("TRANSFER");
  const ventasTarjeta = brutoTarjeta - abonosPor("CARD");

  return {
    contado,
    ventasEfectivo,
    ventasTransferencia,
    ventasTarjeta,
    totalVentas: ventasEfectivo + ventasTransferencia + ventasTarjeta,
    totalFiado: input.fiados.reduce((a, f) => a + Number(f.amount), 0),
    totalAbonos: input.abonos.reduce((a, f) => a + Number(f.amount), 0),
  };
}
