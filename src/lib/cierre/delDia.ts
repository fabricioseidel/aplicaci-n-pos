import type { AbonoInput, FiadoInput } from "./types";

export interface MovimientoAnotado {
  id: string;
  account_id: string;
  kind: "CHARGE" | "PAYMENT";
  amount: number;
  method: string | null;
  note: string | null;
  name: string;
}

/**
 * Suma al borrador del cierre los fiados y abonos anotados durante el día.
 *
 * `registrar_cierre` borra los movimientos del turno y escribe los que manda
 * el cierre: si el borrador no los trae, se pierden. Por eso entran acá con
 * su `entry_id`, una sola vez aunque se cargue varias veces.
 */
export function sumarDelDia(
  borrador: { fiados: FiadoInput[]; abonos: AbonoInput[] },
  movimientos: MovimientoAnotado[]
): { fiados: FiadoInput[]; abonos: AbonoInput[]; agregados: number } {
  const ya = new Set(
    [...borrador.fiados, ...borrador.abonos].map((x) => x.entry_id).filter(Boolean) as string[]
  );
  const fiados = [...borrador.fiados];
  const abonos = [...borrador.abonos];
  let agregados = 0;
  for (const m of movimientos) {
    if (ya.has(m.id)) continue;
    agregados++;
    if (m.kind === "CHARGE") {
      fiados.push({ entry_id: m.id, account_id: m.account_id, name: m.name, amount: m.amount, note: m.note ?? undefined });
    } else {
      const method = m.method === "TRANSFER" || m.method === "CARD" ? m.method : "CASH";
      abonos.push({ entry_id: m.id, account_id: m.account_id, name: m.name, amount: m.amount, method, note: m.note ?? undefined });
    }
  }
  return { fiados, abonos, agregados };
}
