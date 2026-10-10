/**
 * Reglas puras del Conteo de góndola.
 */

export type FuenteEscaneo = "camera" | "laser" | string;

/**
 * Anti-rebote del escáner, SOLO para la cámara: la cámara lee el mismo código
 * varias veces en el mismo destello. El láser no rebota: cada lectura es un
 * gatillazo, y contar una góndola es pasar el mismo código muchas veces
 * seguidas (antes 3 lecturas en 300 ms contaban 1).
 *
 * Devuelve una función que responde `true` si la lectura hay que ignorarla.
 */
export function crearAntirebote(ms = 600) {
  let ultimo = "";
  let hasta = 0;
  return (codigo: string, fuente: FuenteEscaneo, ahora: number = Date.now()): boolean => {
    if (fuente !== "camera") return false;
    if (codigo === ultimo && ahora < hasta) return true;
    ultimo = codigo;
    hasta = ahora + ms;
    return false;
  };
}

/** Cómo se cierra un conteo. */
export type ModoCierre = "escaneado" | "todo";

/** Parámetros de `close_stock_count` para cada modo. */
export function parametrosCierre(modo: ModoCierre): { zeroUncounted: boolean; deactivateUncounted: boolean } {
  return modo === "todo"
    ? { zeroUncounted: true, deactivateUncounted: true }
    : { zeroUncounted: false, deactivateUncounted: false };
}

/**
 * Confirmación escribiendo el número de productos que se van a poner en 0:
 * obliga a leerlo. Acepta "1.234" o "1234"; nada más.
 */
export function numeroConfirmado(texto: string, esperado: number): boolean {
  const limpio = texto.trim().replace(/\./g, "");
  if (!/^\d+$/.test(limpio)) return false;
  return Number(limpio) === esperado;
}
