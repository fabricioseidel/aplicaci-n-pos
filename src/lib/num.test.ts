import { describe, expect, it } from "vitest";
import { parseCLP, parseGramos, parseCantidad, formatMiles } from "./num";

describe("parseCLP", () => {
  it.each([
    ["3.500", 3500],
    ["$ 1.990", 1990],
    ["30.000", 30000],
    ["30000", 30000],
    ["1990,6", 1991],
    ["0", 0],
  ])("%s → %s", (texto, esperado) => {
    expect(parseCLP(texto)).toBe(esperado);
  });

  it.each(["", "abc", "12a", "-5"])("%s → null", (texto) => {
    expect(parseCLP(texto)).toBeNull();
  });
});

describe("parseGramos", () => {
  it.each([
    ["350", 350],
    ["0.35", 350],
    ["0,35", 350],
    ["1.2", 1200],
    ["1.200", 1200],
    ["1200", 1200],
    ["2,5", 2500],
  ])("%s → %s g", (texto, esperado) => {
    expect(parseGramos(texto)).toBe(esperado);
  });

  it("vacío o basura → null", () => {
    expect(parseGramos("")).toBeNull();
    expect(parseGramos("7.801.610.001.196")).toBeNull();
  });
});

describe("parseCantidad / formatMiles", () => {
  it("acepta coma y punto decimal", () => {
    expect(parseCantidad("1,5")).toBe(1.5);
    expect(parseCantidad("24")).toBe(24);
    expect(parseCantidad("x")).toBeNull();
  });

  it("formatea con punto de miles", () => {
    expect(formatMiles(30000)).toBe("30.000");
    expect(formatMiles(1990.4)).toBe("1.990");
  });
});
