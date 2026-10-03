import { describe, expect, it } from "vitest";
import { createScanDetector, type ScanStep } from "./detector";

/** Teclea `text` + Enter con `gap` ms entre teclas, desde `t0`. */
function teclear(text: string, gap: number, t0 = 1000) {
  const d = createScanDetector();
  const pasos: ScanStep[] = [];
  let t = t0;
  for (const ch of text) {
    pasos.push(d.feed(ch, t));
    t += gap;
  }
  pasos.push(d.feed("Enter", t));
  return pasos;
}

describe("createScanDetector", () => {
  it("una ráfaga rápida terminada en Enter es una lectura", () => {
    const pasos = teclear("7801610001196", 8);
    expect(pasos[0]).toEqual({ kind: "start" });
    expect(pasos.at(-1)).toEqual({ kind: "scan", code: "7801610001196" });
  });

  it("un lector Bluetooth lento (45 ms) sigue siendo lectura", () => {
    expect(teclear("7801610001196", 45).at(-1)).toEqual({ kind: "scan", code: "7801610001196" });
  });

  it("el tipeo de una persona no es lectura", () => {
    expect(teclear("12345", 180).at(-1)).toEqual({ kind: "enter" });
  });

  it("un código corto no es lectura", () => {
    expect(teclear("123", 5).at(-1)).toEqual({ kind: "enter" });
  });

  it("un Enter suelto no es lectura", () => {
    const d = createScanDetector();
    expect(d.feed("Enter", 0)).toEqual({ kind: "enter" });
  });

  it("una pausa larga corta la ráfaga y empieza otra", () => {
    const d = createScanDetector();
    d.feed("9", 0);
    d.feed("9", 5);
    expect(d.feed("7", 1000)).toEqual({ kind: "start" });
    for (const [i, ch] of [..."801610001196"].entries()) d.feed(ch, 1005 + i * 5);
    expect(d.feed("Enter", 1100)).toEqual({ kind: "scan", code: "7801610001196" });
  });

  it("teclas especiales no rompen la ráfaga", () => {
    const d = createScanDetector();
    d.feed("A", 0);
    expect(d.feed("Shift", 3)).toEqual({ kind: "ignore" });
    d.feed("B", 6);
    d.feed("C", 9);
    d.feed("1", 12);
    expect(d.feed("Enter", 15)).toEqual({ kind: "scan", code: "ABC1" });
  });
});
