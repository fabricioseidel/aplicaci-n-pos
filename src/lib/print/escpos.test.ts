import { describe, expect, it } from "vitest";
import { aBase64, ticketEscPos } from "./escpos";

const INICIO = [0x1b, 0x40, 0x1b, 0x74, 0x00];
const FIN = [0x1b, 0x64, 4];

describe("ticketEscPos", () => {
  it("reinicia, fija PC437, una línea por LF y avanza al final", () => {
    const b = Array.from(ticketEscPos(["AB", "", "C"]));
    expect(b).toEqual([...INICIO, 0x41, 0x42, 0x0a, 0x0a, 0x43, 0x0a, ...FIN]);
  });

  it("codifica ñ, tildes y signos del castellano en PC437", () => {
    const b = Array.from(ticketEscPos(["mañana ¿sí? Débito"])).slice(INICIO.length, -FIN.length - 1);
    expect(b).toEqual([
      0x6d, 0x61, 0xa4, 0x61, 0x6e, 0x61, 0x20, // mañana
      0xa8, 0x73, 0xa1, 0x3f, 0x20, // ¿sí?
      0x44, 0x82, 0x62, 0x69, 0x74, 0x6f, // Débito
    ]);
  });

  it("las mayúsculas con tilde que no existen en PC437 salen sin tilde", () => {
    const b = Array.from(ticketEscPos(["ÁÍÓÚ"])).slice(INICIO.length, -FIN.length - 1);
    expect(String.fromCharCode(...b)).toBe("AIOU");
  });

  it("los espacios duros pasan a espacio y lo desconocido a ?", () => {
    const b = Array.from(ticketEscPos(["$ 1.000 ✓"])).slice(INICIO.length, -FIN.length - 1);
    expect(String.fromCharCode(...b)).toBe("$ 1.000 ?");
  });
});

describe("aBase64", () => {
  it("pasa bytes altos sin romperlos", () => {
    expect(atob(aBase64(Uint8Array.from([0x1b, 0xa4, 0xff])))).toBe("\x1b\xa4\xff");
  });
});
