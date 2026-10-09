import { describe, expect, it } from "vitest";
import {
  diffProduct,
  validarCambios,
  validarNuevoCodigo,
  costoNetoDesdeBruto,
  costoBrutoDesdeNeto,
  margenSobreVenta,
  revisarPrecio,
  revisarOferta,
} from "./edicion";

const coca = {
  barcode: "7801610001196",
  name: "Coca-Cola Lata",
  category: "Bebidas",
  sale_price: 1000,
  offer_price: null,
  purchase_price: 571.43,
  min_stock: 5,
  optimum_stock: 20,
  stock: 17,
  is_active: true,
  by_weight: false,
  image_url: null,
  description: null,
};

describe("diffProduct", () => {
  it("cambiar sólo el precio manda sólo el precio, con el valor original como expected", () => {
    const r = diffProduct(coca, { ...coca, sale_price: 1100 });
    expect(r.changes).toEqual({ sale_price: 1100 });
    expect(r.expected).toEqual({ sale_price: 1000 });
  });

  it("nunca incluye el stock, aunque cambie", () => {
    const r = diffProduct(coca, { ...coca, stock: 15 });
    expect(r.changes).toEqual({});
  });

  it("no toca costo ni mínimos que no se editaron", () => {
    const r = diffProduct(coca, { name: "Coca-Cola Lata 350", sale_price: 1000 });
    expect(r.changes).toEqual({ name: "Coca-Cola Lata 350" });
    expect(r.changes).not.toHaveProperty("purchase_price");
    expect(r.changes).not.toHaveProperty("min_stock");
  });

  it("quitar la oferta manda null; vacío y null valen lo mismo", () => {
    const conOferta = { ...coca, offer_price: 900 };
    expect(diffProduct(conOferta, { offer_price: null }).changes).toEqual({ offer_price: null });
    expect(diffProduct(coca, { offer_price: null, image_url: "", category: " Bebidas " }).changes).toEqual({});
  });

  it("un número igual no cuenta como cambio aunque venga con decimales flotantes", () => {
    expect(diffProduct(coca, { purchase_price: 571.4300000001 }).changes).toEqual({});
  });
});

describe("validarCambios", () => {
  it("rechaza el stock con un mensaje que manda a Ajustar stock", () => {
    const r = validarCambios({ stock: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Ajustar stock/);
  });

  it("rechaza campos desconocidos y precios no enteros o en cero", () => {
    expect(validarCambios({ tax_rate: 19 }).ok).toBe(false);
    expect(validarCambios({ sale_price: 3.5 }).ok).toBe(false);
    expect(validarCambios({ sale_price: 0 }).ok).toBe(false);
    expect(validarCambios({}).ok).toBe(false);
  });

  it("acepta un precio, quitar oferta y un costo neto con decimales", () => {
    const r = validarCambios({ sale_price: 1100, offer_price: null, purchase_price: 571.428 });
    expect(r).toEqual({ ok: true, changes: { sale_price: 1100, offer_price: null, purchase_price: 571.43 } });
  });

  it("el nombre no puede quedar vacío", () => {
    expect(validarCambios({ name: "  " }).ok).toBe(false);
  });
});

describe("costo con IVA y margen", () => {
  it("convierte entre lo que se paga y lo que se guarda", () => {
    expect(costoNetoDesdeBruto(680)).toBe(571.43);
    expect(costoBrutoDesdeNeto(571.43)).toBe(680);
  });

  it("el margen es sobre la venta, con el costo con IVA", () => {
    expect(margenSobreVenta(1000, 650)).toBeCloseTo(0.35);
    expect(margenSobreVenta(1000, null)).toBeNull();
    expect(margenSobreVenta(0, 650)).toBeNull();
  });
});

describe("revisarPrecio", () => {
  it("un cambio normal no pide confirmar", () => {
    expect(revisarPrecio(1000, 1100)).toEqual([]);
  });

  it("3.500 → 4 (precio con punto mal leído) pide confirmar por bajo y por cambio", () => {
    expect(revisarPrecio(3500, 4)).toHaveLength(2);
  });

  it("un código de barras escrito como precio pide confirmar aunque el producto sea nuevo", () => {
    expect(revisarPrecio(null, 7801610001196).length).toBeGreaterThan(0);
    expect(revisarPrecio(0, 150_000)).toHaveLength(1);
  });

  it("más de 50 % de cambio pide confirmar", () => {
    expect(revisarPrecio(1000, 1600)).toHaveLength(1);
    expect(revisarPrecio(1000, 1500)).toEqual([]);
  });
});

describe("revisarOferta", () => {
  it("una oferta igual o mayor al precio pide confirmar", () => {
    expect(revisarOferta(1000, 1000)).toHaveLength(1);
    expect(revisarOferta(1000, 900)).toEqual([]);
    expect(revisarOferta(1000, null)).toEqual([]);
  });
});

describe("oferta hasta (offer_ends_at)", () => {
  it("acepta una fecha y la normaliza a ISO, o null para quitarla", () => {
    expect(validarCambios({ offer_ends_at: "2026-10-15T23:59:59-03:00" })).toEqual({
      ok: true,
      changes: { offer_ends_at: "2026-10-16T02:59:59.000Z" },
    });
    expect(validarCambios({ offer_ends_at: null })).toEqual({ ok: true, changes: { offer_ends_at: null } });
  });

  it("rechaza lo que no es fecha", () => {
    expect(validarCambios({ offer_ends_at: "mañana" }).ok).toBe(false);
    expect(validarCambios({ offer_ends_at: 5 }).ok).toBe(false);
  });

  it("la misma fecha con otro formato no cuenta como cambio si se pasa el original", () => {
    const fila = { offer_ends_at: "2026-10-16T02:59:59+00:00" };
    expect(diffProduct(fila, { offer_ends_at: fila.offer_ends_at }).changes).toEqual({});
    expect(diffProduct(fila, { offer_ends_at: null }).changes).toEqual({ offer_ends_at: null });
  });
});

describe("validarNuevoCodigo", () => {
  it("acepta un código distinto, sin espacios alrededor", () => {
    expect(validarNuevoCodigo("123", " 7801610001196 ")).toEqual({ ok: true, codigo: "7801610001196" });
  });
  it("rechaza vacío, igual o con espacios adentro", () => {
    expect(validarNuevoCodigo("123", "").ok).toBe(false);
    expect(validarNuevoCodigo("123", "123").ok).toBe(false);
    expect(validarNuevoCodigo("123", "78 01").ok).toBe(false);
    expect(validarNuevoCodigo("123", 5).ok).toBe(false);
  });
});
