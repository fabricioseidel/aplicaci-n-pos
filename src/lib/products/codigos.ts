/**
 * Códigos de barras genéricos: los que se inventaron porque el producto
 * entró sin escáner. En la base hay de varias formas:
 *
 *   INT-MT6BGZ4R          alta rápida del POS
 *   SINCOD-ATUN-MOLINOVA  carga a mano "sin código"
 *   900000000113          internos de OlivoWeb
 *   12355                 cortos tipeados a mano
 *
 * Un producto con código genérico que se escanea con su código real tiene
 * que QUEDARSE con el real: si no, la próxima pasada del lector tampoco lo
 * encuentra y se termina creando un duplicado.
 */
export function esCodigoGenerico(codigo: string | null | undefined): boolean {
  const c = (codigo ?? "").trim();
  if (!c) return true;
  if (/^(INT|SINCOD)-/i.test(c)) return true;
  if (/^9000000\d*$/.test(c)) return true;
  if (!/^\d+$/.test(c)) return true;
  return c.length < 8;
}
