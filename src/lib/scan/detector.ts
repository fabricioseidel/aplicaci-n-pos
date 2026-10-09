/**
 * Detector de lecturas del lector láser (que "teclea" el código y Enter).
 *
 * Lógica pura, sin DOM, para poder testearla: recibe cada tecla con su hora y
 * dice qué pasó. Una lectura es una ráfaga de al menos `minLength` caracteres
 * con menos de `maxGapMs` entre uno y otro, terminada en Enter. Una persona
 * no tipea así; un lector Bluetooth en Android sí (a veces a 40-50 ms, por
 * eso el margen no es más chico).
 */

export interface ScanDetectorOptions {
  minLength?: number;
  maxGapMs?: number;
}

export type ScanStep =
  /** Primera tecla de una posible ráfaga: hay que recordar dónde cayó. */
  | { kind: "start" }
  /** Tecla dentro de una ráfaga en curso. */
  | { kind: "char" }
  /** Enter que cierra una ráfaga: es una lectura. */
  | { kind: "scan"; code: string }
  /** Enter suelto (o tras tipeo lento): no es del lector, se deja pasar. */
  | { kind: "enter" }
  /** Tecla que no aporta (Shift, flechas…). */
  | { kind: "ignore" };

export interface ScanDetector {
  feed(key: string, timeMs: number): ScanStep;
  reset(): void;
}

export function createScanDetector({
  minLength = 4,
  maxGapMs = 60,
}: ScanDetectorOptions = {}): ScanDetector {
  let buffer = "";
  let last = -Infinity;
  /** true mientras todas las teclas del buffer llegaron en ráfaga. */
  let rapid = false;

  return {
    feed(key, t) {
      if (key === "Enter") {
        const code = buffer.trim();
        const isScan = rapid && code.length >= minLength && t - last <= maxGapMs * 4;
        buffer = "";
        rapid = false;
        last = -Infinity;
        return isScan ? { kind: "scan", code } : { kind: "enter" };
      }
      if (key.length !== 1) return { kind: "ignore" };

      if (t - last > maxGapMs) {
        buffer = key;
        rapid = false;
        last = t;
        return { kind: "start" };
      }
      buffer += key;
      rapid = true;
      last = t;
      return { kind: "char" };
    },
    reset() {
      buffer = "";
      rapid = false;
      last = -Infinity;
    },
  };
}
