import { describe, expect, it } from "vitest";
import { fechaChile, fechaCorta, finDelDiaChile } from "./oferta";
import { mapSupaToUI } from "@/services/products";
import { unitPriceOf } from "@/contexts/POSContext";
import type { SupaProduct } from "@/types";

describe("Oferta hasta: fin del día en Chile", () => {
  it("en horario de verano (-03)", () => {
    expect(finDelDiaChile("2026-12-15")).toBe("2026-12-16T02:59:59.000Z");
  });

  it("en horario de invierno (-04)", () => {
    expect(finDelDiaChile("2026-07-15")).toBe("2026-07-16T03:59:59.000Z");
  });

  it("ida y vuelta da el mismo día", () => {
    for (const d of ["2026-10-15", "2026-04-04", "2026-09-05", "2027-01-01"]) {
      expect(fechaChile(finDelDiaChile(d))).toBe(d);
    }
  });

  it("rechaza fechas que no existen", () => {
    expect(finDelDiaChile("2026-02-30")).toBeNull();
    expect(finDelDiaChile("15-10-2026")).toBeNull();
    expect(finDelDiaChile("")).toBeNull();
  });

  it("lee un timestamptz como lo devuelve PostgREST", () => {
    expect(fechaChile("2026-10-16T02:59:59+00:00")).toBe("2026-10-15");
    expect(fechaChile(null)).toBe("");
  });

  it("fecha corta", () => {
    expect(fechaCorta("2026-10-15", "2026-10-09")).toBe("15-10");
    expect(fechaCorta("2027-01-02", "2026-10-09")).toBe("02-01-2027");
  });
});

describe("precio vigente en el catálogo y el carrito", () => {
  const base: SupaProduct = {
    barcode: "pan", name: "Pan", category: null, purchase_price: null,
    sale_price: 330, stock: 10, offer_price: 300,
  };

  it("oferta vencida: el catálogo no la muestra y se cobra el normal", () => {
    const p = mapSupaToUI({ ...base, offer_ends_at: "2020-01-01T00:00:00Z" });
    expect(p.offerPrice).toBeUndefined();
    expect(p.offerEndsAt).toBeNull();
    expect(unitPriceOf(p)).toBe(330);
  });

  it("oferta vigente: viaja con su fecha", () => {
    const p = mapSupaToUI({ ...base, offer_ends_at: "2099-01-01T00:00:00Z" });
    expect(p.offerPrice).toBe(300);
    expect(p.offerEndsAt).toBe("2099-01-01T00:00:00Z");
    expect(unitPriceOf(p)).toBe(300);
  });

  it("sin fecha, como antes", () => {
    expect(unitPriceOf(mapSupaToUI(base))).toBe(300);
  });

  it("un carrito guardado con la oferta que venció después se cobra al precio normal", () => {
    const p = mapSupaToUI({ ...base, offer_ends_at: "2099-01-01T00:00:00Z" });
    expect(unitPriceOf({ ...p, offerEndsAt: "2020-01-01T00:00:00Z" })).toBe(330);
  });
});
