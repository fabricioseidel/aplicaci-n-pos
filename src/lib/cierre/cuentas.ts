/**
 * Búsqueda de cuentas de fiado por nombre.
 *
 * Antes se buscaba por nombre exacto: "don pedro" no era "Don Pedro (vecino)"
 * y `find_or_create_account` creaba una cuenta nueva, partiendo la deuda en
 * dos (#12). Acá se compara sin mayúsculas, tildes ni signos, y cada palabra
 * escrita tiene que aparecer al comienzo de alguna palabra del nombre.
 */

export interface CuentaBuscable {
  id: string;
  name: string;
  balance: number | string;
}

export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuentas que calzan con lo escrito, las más parecidas primero (máx. `max`). */
export function buscarCuentas<T extends CuentaBuscable>(cuentas: T[], texto: string, max = 5): T[] {
  const q = normalizarNombre(texto);
  if (!q) return [];
  const palabras = q.split(" ");
  const puntaje = (c: T): number => {
    const n = normalizarNombre(c.name);
    if (n === q) return 100;
    const del = n.split(" ");
    const todas = palabras.every((p) => del.some((d) => d.startsWith(p)));
    if (todas) return n.startsWith(q) ? 80 : 60;
    // Alguna palabra larga coincide ("pedro" en "Pedro Pablo"): sugerencia.
    const alguna = palabras.some((p) => p.length >= 3 && del.some((d) => d.startsWith(p)));
    return alguna ? 20 : 0;
  };
  return cuentas
    .map((c) => ({ c, p: puntaje(c) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || Number(b.c.balance) - Number(a.c.balance))
    .slice(0, max)
    .map((x) => x.c);
}

/** La cuenta con el mismo nombre (sin mayúsculas ni tildes), si existe. */
export function cuentaExacta<T extends CuentaBuscable>(cuentas: T[], texto: string): T | null {
  const q = normalizarNombre(texto);
  return cuentas.find((c) => normalizarNombre(c.name) === q) ?? null;
}

/**
 * Si un abono necesita confirmación, el texto de la pregunta. Un abono de
 * quien no debe, o mayor que la deuda, casi siempre es la cuenta equivocada.
 */
export function avisoAbono(deuda: number | null, monto: number, nombre: string, clp: (n: number) => string): string | null {
  if (deuda === null || deuda <= 0) {
    return `${nombre} no debe nada. ¿Registrar igual un abono de ${clp(monto)}?`;
  }
  if (monto > deuda) {
    return `${nombre} debe ${clp(deuda)} y el abono es de ${clp(monto)}. ¿Registrar igual?`;
  }
  return null;
}
