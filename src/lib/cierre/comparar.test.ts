import { describe, expect, it } from "vitest";
import { compararCierre, diferenciaEnPalabras } from "./comparar";

const base = {
  // Turno de la vendedora: abrió con $30.000; efectivo 13.525, tarjeta 3.070.
  pos: { efectivo: 13525, transferencia: 2000, tarjeta: 3070 },
  inicio: 30000,
  ingresos: 0,
  egresos: 0,
  contado: 43525,
  transferencias: 2000,
  vouchers: 3070,
  abonos: { CASH: 0, TRANSFER: 0, CARD: 0 },
};

describe("compararCierre", () => {
  it("todo cuadra", () => {
    const filas = compararCierre(base);
    expect(filas.map((f) => f.estado)).toEqual(["cuadra", "cuadra", "cuadra"]);
    expect(filas[0].registro).toBe(43525);
  });

  it("faltan $2.025 en el cajón", () => {
    const [ef] = compararCierre({ ...base, contado: 41500 });
    expect(ef.diferencia).toBe(-2025);
    expect(ef.texto).toBe("faltan $ 2.025");
  });

  it("movimientos y abonos en efectivo cambian lo que debería haber", () => {
    const [ef, tr] = compararCierre({
      ...base,
      egresos: 15000,
      ingresos: 5000,
      abonos: { CASH: 2000, TRANSFER: 1000, CARD: 0 },
      contado: 43525 - 15000 + 5000 + 2000 + 500,
      transferencias: 3000,
    });
    expect(ef.registro).toBe(35525);
    expect(ef.texto).toBe("sobran $ 500");
    expect(tr.estado).toBe("cuadra");
  });

  it("vouchers sin cargar: falta toda la tarjeta", () => {
    const filas = compararCierre({ ...base, vouchers: 0 });
    expect(filas[2].texto).toBe("faltan $ 3.070");
  });
});

describe("diferenciaEnPalabras", () => {
  it("menos de $1 es redondeo", () => {
    expect(diferenciaEnPalabras(0.4).estado).toBe("cuadra");
    expect(diferenciaEnPalabras(-1).texto).toBe("faltan $ 1");
  });
});
