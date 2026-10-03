import { describe, expect, it } from "vitest";
import { parseDraft, refreshPrices, type CartLine } from "./cartStorage";
import type { ProductUI } from "@/types";

const prod = (id: string, price: number, extra: Partial<ProductUI> = {}): ProductUI => ({
  id,
  barcode: id,
  name: `P${id}`,
  price,
  image: "",
  slug: id,
  description: "",
  categories: [],
  stock: 10,
  ...extra,
});

describe("parseDraft", () => {
  it("restaura una venta guardada", () => {
    const raw = JSON.stringify({
      items: [{ ...prod("1", 1000), quantity: 2 }],
      compraPropia: true,
      porCobrar: false,
      comprador: { id: "s1", name: "MARIANA" },
      savedAt: 5,
    });
    expect(parseDraft(raw)).toMatchObject({
      items: [{ id: "1", quantity: 2 }],
      compraPropia: true,
      comprador: { id: "s1", name: "MARIANA" },
    });
  });

  it("descarta basura y líneas inválidas", () => {
    expect(parseDraft("{no es json")).toBeNull();
    expect(parseDraft(JSON.stringify({ items: "x" }))).toBeNull();
    const d = parseDraft(JSON.stringify({ items: [{ id: "1", quantity: 0 }, { quantity: 2 }] }));
    expect(d?.items).toEqual([]);
  });
});

describe("refreshPrices", () => {
  it("toma el precio de hoy, conserva la cantidad y avisa qué cambió", () => {
    const items: CartLine[] = [
      { ...prod("1", 1000), quantity: 3 },
      { ...prod("2", 500), quantity: 0.35 },
    ];
    const { items: next, changed } = refreshPrices(items, [prod("1", 1100), prod("2", 500)]);
    expect(next[0]).toMatchObject({ price: 1100, quantity: 3 });
    expect(next[1]).toMatchObject({ price: 500, quantity: 0.35 });
    expect(changed).toEqual(["P1"]);
  });

  it("un producto que ya no está en el catálogo queda como estaba", () => {
    const items: CartLine[] = [{ ...prod("9", 700), quantity: 1 }];
    expect(refreshPrices(items, []).items[0].price).toBe(700);
  });
});
