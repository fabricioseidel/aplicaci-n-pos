/** Billetes y monedas en circulación en Chile, de mayor a menor. */
export const CLP_DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10] as const;

/** Hasta 1.000 es moneda; de 1.000 para arriba, billete. */
export const BILL_THRESHOLD = 1000;

export function denominationTotal(counts: Record<number, number>): number {
  return CLP_DENOMINATIONS.reduce((acc, d) => acc + d * (counts[d] || 0), 0);
}

/** Formato de peso chileno: sin decimales y con punto de miles. */
export function clp(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$ 0";
  return `$ ${Math.round(n).toLocaleString("es-CL")}`;
}

/** Fecha operativa de hoy en hora de Chile, como YYYY-MM-DD. */
export function businessDateToday(): string {
  // `en-CA` da directamente YYYY-MM-DD, que es lo que espera Postgres.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}
