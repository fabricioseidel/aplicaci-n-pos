import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ supabaseServer: {} }));

import { conColumnasDeProducto, sinColumnasNuevas } from "./productos.service";

describe("columnas nuevas de products antes de la migración", () => {
  it("quita offer_ends_at de la lista", () => {
    expect(sinColumnasNuevas("barcode, sale_price, offer_price, offer_ends_at")).toBe(
      "barcode, sale_price, offer_price"
    );
  });

  it("si la base no tiene la columna, repite sin ella y lo recuerda", async () => {
    const pedidas: string[] = [];
    const consulta = async (cols: string) => {
      pedidas.push(cols);
      return cols.includes("offer_ends_at")
        ? { data: null, error: { code: "42703", message: "column products.offer_ends_at does not exist" } }
        : { data: [{ barcode: "x" }], error: null };
    };
    const r = await conColumnasDeProducto(consulta, "barcode, offer_ends_at");
    expect(r.data).toEqual([{ barcode: "x" }]);
    expect(pedidas).toEqual(["barcode, offer_ends_at", "barcode"]);
    await conColumnasDeProducto(consulta, "barcode, offer_ends_at");
    expect(pedidas.length).toBe(3); // ya no vuelve a probar con la columna
  });

  it("otros errores no se tapan", async () => {
    vi.resetModules();
    const { conColumnasDeProducto: fresco } = await import("./productos.service");
    const r = await fresco(async () => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    expect(r.error?.code).toBe("42501");
  });
});
