import { describe, expect, it } from "vitest";
import { ajustarAuto, calcularCobro, pagosParaServidor, type FilaPago } from "./cobro";

const efectivoAuto = (amount = 0): FilaPago => ({ id: "a", method: "CASH", amount, auto: true });

describe("ajustarAuto", () => {
  it("el monto automático sigue al total al agregar productos", () => {
    let filas = ajustarAuto(1000, [efectivoAuto()]);
    expect(filas[0].amount).toBe(1000);
    filas = ajustarAuto(3500, filas);
    expect(filas[0].amount).toBe(3500);
  });

  it("con compra propia sigue al total con descuento (sin vuelto fantasma)", () => {
    const filas = ajustarAuto(1500, [efectivoAuto()]);
    const conDescuento = ajustarAuto(1125, filas);
    expect(calcularCobro(1125, conDescuento).vuelto).toBe(0);
  });

  it("un monto escrito a mano no se pisa", () => {
    const filas = ajustarAuto(3000, [{ id: "a", method: "CASH", amount: 5000, auto: false }]);
    expect(filas[0].amount).toBe(5000);
  });

  it("pago mixto: la fila automática toma lo que falta después de la fija", () => {
    const filas = ajustarAuto(8070, [
      { id: "a", method: "CASH", amount: 5000, auto: false },
      { id: "b", method: "CARD", amount: 0, auto: true },
    ]);
    expect(filas[1].amount).toBe(3070);
    expect(calcularCobro(8070, filas)).toMatchObject({ ok: true, vuelto: 0, efectivoAplicado: 5000 });
  });
});

describe("calcularCobro", () => {
  it("efectivo con vuelto", () => {
    const c = calcularCobro(3500, [{ id: "a", method: "CASH", amount: 10000, auto: false }]);
    expect(c).toMatchObject({ ok: true, vuelto: 6500, efectivoAplicado: 3500, falta: 0 });
  });

  it("falta plata: no se puede confirmar y dice cuánto", () => {
    const c = calcularCobro(3500, [{ id: "a", method: "CASH", amount: 2000, auto: false }]);
    expect(c.ok).toBe(false);
    expect(c.motivo).toBe("Falta $1.500");
  });

  it("la tarjeta no puede superar el total", () => {
    const c = calcularCobro(3000, [{ id: "a", method: "CARD", amount: 5000, auto: false }]);
    expect(c.ok).toBe(false);
    expect(c.vuelto).toBe(0);
  });

  it("tarjeta exacta: un toque y listo", () => {
    const filas = ajustarAuto(4200, [{ id: "a", method: "CARD", amount: 0, auto: true }]);
    expect(calcularCobro(4200, filas)).toMatchObject({ ok: true, vuelto: 0 });
  });
});

describe("pagosParaServidor", () => {
  it("el efectivo va sin el vuelto y la suma da el total", () => {
    const pagos = pagosParaServidor(8070, [
      { id: "a", method: "CASH", amount: 10000, auto: false },
      { id: "b", method: "CARD", amount: 3070, auto: false },
    ]);
    expect(pagos).toEqual([
      { method: "CARD", amount: 3070 },
      { method: "CASH", amount: 5000 },
    ]);
    expect(pagos.reduce((a, p) => a + p.amount, 0)).toBe(8070);
  });
});
