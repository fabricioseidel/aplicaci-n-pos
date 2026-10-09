import { describe, expect, it } from "vitest";
import { crearAntirebote, numeroConfirmado, parametrosCierre } from "./conteo";

describe("anti-rebote del Conteo", () => {
  it("3 lecturas del láser en 300 ms son 3 unidades", () => {
    const ignorar = crearAntirebote(600);
    const leidas = [0, 150, 300].filter((t) => !ignorar("780", "laser", t));
    expect(leidas).toHaveLength(3);
  });

  it("la cámara leyendo el mismo código en el mismo destello cuenta 1", () => {
    const ignorar = crearAntirebote(600);
    const leidas = [0, 100, 300].filter((t) => !ignorar("780", "camera", t));
    expect(leidas).toHaveLength(1);
  });

  it("la cámara vuelve a contar pasado el tiempo o con otro código", () => {
    const ignorar = crearAntirebote(600);
    expect(ignorar("780", "camera", 0)).toBe(false);
    expect(ignorar("781", "camera", 100)).toBe(false);
    expect(ignorar("780", "camera", 200)).toBe(false);
    expect(ignorar("780", "camera", 900)).toBe(false);
  });

  it("una lectura de láser no se bloquea por una de cámara", () => {
    const ignorar = crearAntirebote(600);
    ignorar("780", "camera", 0);
    expect(ignorar("780", "laser", 50)).toBe(false);
  });
});

describe("cierre del conteo", () => {
  it("solo lo escaneado no pone en 0 ni apaga nada", () => {
    expect(parametrosCierre("escaneado")).toEqual({ zeroUncounted: false, deactivateUncounted: false });
    expect(parametrosCierre("todo")).toEqual({ zeroUncounted: true, deactivateUncounted: true });
  });

  it("hay que escribir exactamente el número", () => {
    expect(numeroConfirmado("57", 57)).toBe(true);
    expect(numeroConfirmado(" 1.234 ", 1234)).toBe(true);
    expect(numeroConfirmado("", 57)).toBe(false);
    expect(numeroConfirmado("56", 57)).toBe(false);
    expect(numeroConfirmado("57 productos", 57)).toBe(false);
    expect(numeroConfirmado("0", 0)).toBe(true);
  });
});
