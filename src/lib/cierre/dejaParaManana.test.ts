import { describe, expect, it } from "vitest";
import { conDejaParaManana, parseDejaParaManana, sinDejaParaManana } from "./dejaParaManana";

describe("deja para mañana", () => {
  it("escribe y vuelve a leer el monto", () => {
    const notas = conDejaParaManana("Faltó cambio de $100", 20000);
    expect(notas).toBe("Faltó cambio de $100\nDeja para mañana: $20.000");
    expect(parseDejaParaManana(notas)).toBe(20000);
    expect(sinDejaParaManana(notas)).toBe("Faltó cambio de $100");
  });

  it("sin observaciones queda sólo la línea", () => {
    expect(conDejaParaManana("", 15000)).toBe("Deja para mañana: $15.000");
  });

  it("reemplaza la línea al re-registrar, no la duplica", () => {
    const una = conDejaParaManana("ok", 10000);
    const dos = conDejaParaManana(una, 30000);
    expect(dos).toBe("ok\nDeja para mañana: $30.000");
    expect(parseDejaParaManana(dos)).toBe(30000);
  });

  it("sin monto no agrega nada", () => {
    expect(conDejaParaManana("ok", null)).toBe("ok");
    expect(parseDejaParaManana("ok")).toBeNull();
    expect(parseDejaParaManana(null)).toBeNull();
  });

  it("acepta $0 (se llevó todo)", () => {
    expect(parseDejaParaManana(conDejaParaManana(null, 0))).toBe(0);
  });
});
