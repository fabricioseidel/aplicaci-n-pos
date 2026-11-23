// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ajustarStock = vi.fn();
vi.mock("@/services/products", () => ({ ajustarStock: (...a: unknown[]) => ajustarStock(...a) }));

import InventarioLista from "./InventarioLista";
import type { ProductUI } from "@/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const p = (id: string, name: string, stock: number, extra: Partial<ProductUI> = {}) =>
  ({ id, barcode: id, name, stock, price: 1000, ...extra }) as ProductUI;

const productos = [
  p("1", "Coca-Cola Zero 1.5", 8),
  p("2", "Atún Molinova", 0),
  p("3", "Queso Semiduro Catatumbo", 3.4, { byWeight: true }),
  p("4", "Producto apagado", 5, { isActive: false }),
];

describe("InventarioLista", () => {
  it("muestra solo nombre y stock, por defecto solo lo que tiene stock", () => {
    render(<InventarioLista productos={productos} sede="Sucursal" onVolver={() => {}} />);
    expect(screen.getByText("Coca-Cola Zero 1.5")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("3,4 kg")).toBeTruthy();
    expect(screen.queryByText("Atún Molinova")).toBeNull();
    expect(screen.queryByText("Producto apagado")).toBeNull();
    expect(screen.getByText(/2 productos · 11,4 u\./)).toBeTruthy();
  });

  it("puede mostrar también lo agotado y buscar sin tildes", () => {
    render(<InventarioLista productos={productos} sede="Sucursal" onVolver={() => {}} />);
    fireEvent.click(screen.getByLabelText("Solo con stock"));
    expect(screen.getByText("Atún Molinova")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "atun" } });
    expect(screen.queryByText("Coca-Cola Zero 1.5")).toBeNull();
    expect(screen.getByText("Atún Molinova")).toBeTruthy();
  });

  it("tocar un producto permite corregir su stock con motivo, en la sede elegida", async () => {
    ajustarStock.mockResolvedValue({ ok: true, stock: 6 });
    const onAjustado = vi.fn();
    render(
      <InventarioLista productos={productos} sede="Sucursal" branchId="b-suc" onAjustado={onAjustado} onVolver={() => {}} />
    );

    fireEvent.click(screen.getByLabelText("Corregir stock de Coca-Cola Zero 1.5"));
    await screen.findByText("¿Cuántas hay ahora?");
    fireEvent.change(document.querySelector('input[inputmode="numeric"]') as HTMLInputElement, { target: { value: "6" } });
    fireEvent.click(screen.getByText("Corrección"));
    fireEvent.click(screen.getByText("Ajustar"));

    await waitFor(() => expect(ajustarStock).toHaveBeenCalled());
    expect(ajustarStock.mock.calls[0][0]).toMatchObject({
      barcode: "1",
      stock: 6,
      stockVisto: 8,
      motivo: "Corrección",
      branchId: "b-suc",
    });
    await waitFor(() => expect(onAjustado).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), 6));
    expect(await screen.findByText(/Coca-Cola Zero 1.5: ahora 6/)).toBeTruthy();
  });
});
