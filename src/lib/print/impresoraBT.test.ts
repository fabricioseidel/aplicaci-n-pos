import { describe, expect, it } from "vitest";
import { elegirImpresora, type DispositivoBT } from "./impresoraBT";

const mpt: DispositivoBT = { nombre: "MPT-II", direccion: "66:22:AA:01:02:03" };
const audifonos: DispositivoBT = { nombre: "Galaxy Buds", direccion: "11:11:11:11:11:11" };
const auto: DispositivoBT = { nombre: "MI AUTO", direccion: "22:22:22:22:22:22" };
const otra: DispositivoBT = { nombre: "XP-58 Printer", direccion: "33:33:33:33:33:33" };

describe("elegirImpresora", () => {
  it("usa la guardada si sigue vinculada", () => {
    expect(elegirImpresora([mpt, otra], otra)).toBe(otra);
  });

  it("si la guardada ya no está, busca otra vez", () => {
    expect(elegirImpresora([mpt, audifonos], otra)).toBe(mpt);
  });

  it("toma la única que parece impresora aunque haya otros aparatos", () => {
    expect(elegirImpresora([audifonos, mpt, auto], null)).toBe(mpt);
  });

  it("con un solo aparato vinculado, lo usa", () => {
    expect(elegirImpresora([auto], null)).toBe(auto);
  });

  it("pregunta si hay dos impresoras o ninguna reconocible", () => {
    expect(elegirImpresora([mpt, otra], null)).toBeNull();
    expect(elegirImpresora([audifonos, auto], null)).toBeNull();
    expect(elegirImpresora([], null)).toBeNull();
  });
});
