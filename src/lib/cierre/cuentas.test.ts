import { describe, expect, it } from "vitest";
import { avisoAbono, buscarCuentas, cuentaExacta, normalizarNombre } from "./cuentas";
import { clp } from "./denominations";

const cuentas = [
  { id: "1", name: "Don Pedro (vecino)", balance: 3500 },
  { id: "2", name: "Señora Rosa", balance: 0 },
  { id: "3", name: "Pedro Pablo", balance: 0 },
  { id: "4", name: "José Muñoz", balance: 1000 },
];

describe("buscarCuentas", () => {
  it('"don pedro" encuentra "Don Pedro (vecino)" primero', () => {
    expect(buscarCuentas(cuentas, "don pedro")[0].id).toBe("1");
  });
  it("sin tildes ni mayúsculas", () => {
    expect(buscarCuentas(cuentas, "jose munoz")[0].id).toBe("4");
    expect(buscarCuentas(cuentas, "SENORA")[0].id).toBe("2");
  });
  it("una palabra parecida sugiere aunque no calcen todas", () => {
    const r = buscarCuentas(cuentas, "pedro gonzalez").map((c) => c.id);
    expect(r).toContain("1");
    expect(r).toContain("3");
  });
  it("vacío o sin parecidas → nada", () => {
    expect(buscarCuentas(cuentas, "  ")).toEqual([]);
    expect(buscarCuentas(cuentas, "xx")).toEqual([]);
  });
});

describe("cuentaExacta y normalizarNombre", () => {
  it("compara sin tildes ni signos", () => {
    expect(normalizarNombre("  Don Pedro (Vecino) ")).toBe("don pedro vecino");
    expect(cuentaExacta(cuentas, "señora rosa")?.id).toBe("2");
    expect(cuentaExacta(cuentas, "don pedro")).toBeNull();
  });
});

describe("avisoAbono", () => {
  it("pide confirmar si no debe o si abona de más", () => {
    expect(avisoAbono(0, 2000, "Señora Rosa", clp)).toContain("no debe nada");
    expect(avisoAbono(null, 2000, "nueva", clp)).toContain("no debe nada");
    expect(avisoAbono(3500, 5000, "Don Pedro", clp)).toContain("debe $ 3.500");
    expect(avisoAbono(3500, 2000, "Don Pedro", clp)).toBeNull();
  });
});
