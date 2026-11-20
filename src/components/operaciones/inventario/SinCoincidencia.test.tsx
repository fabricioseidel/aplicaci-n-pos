// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductUI } from "@/types";

const adoptarCodigo = vi.fn(async (_actual: string, nuevo: string) => nuevo);
const cambiarCodigo = vi.fn();
vi.mock("@/services/products", () => ({
  adoptarCodigo: (a: string, b: string) => adoptarCodigo(a, b),
  cambiarCodigo: (...a: unknown[]) => cambiarCodigo(...a),
  saveProduct: vi.fn(),
  usarProductoExistente: vi.fn(),
  DEFAULT_IMAGE: "/x.svg",
  ProductExistsError: class extends Error {},
}));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import SinCoincidencia from "./SinCoincidencia";

const atun = { id: "SINCOD-ATUN", barcode: "SINCOD-ATUN", name: "Atún Molinova", price: 1500, stock: 3 } as ProductUI;
const coca = { id: "7802000016448", barcode: "7802000016448", name: "Coca Cola lata", price: 1000, stock: 9 } as ProductUI;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SinCoincidencia", () => {
  it("al elegir un producto con código genérico, se le guarda el código escaneado", async () => {
    const onListo = vi.fn();
    render(
      <SinCoincidencia initialBarcode="7801234567890" products={[atun, coca]} esAdmin={false} onClose={() => {}} onListo={onListo} />
    );
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "atun" } });
    fireEvent.click(await screen.findByText("Atún Molinova"));
    fireEvent.click(screen.getByText("Contar este producto"));

    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(adoptarCodigo).toHaveBeenCalledWith("SINCOD-ATUN", "7801234567890");
    const [producto, , anterior] = onListo.mock.calls[0];
    expect(producto.barcode).toBe("7801234567890");
    expect(anterior).toBe("SINCOD-ATUN");
  });

  it("un vendedor no le cambia el código a un producto con código real", async () => {
    const onListo = vi.fn();
    render(
      <SinCoincidencia initialBarcode="7801234567890" products={[atun, coca]} esAdmin={false} onClose={() => {}} onListo={onListo} />
    );
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "coca" } });
    fireEvent.click(await screen.findByText("Coca Cola lata"));
    fireEvent.click(screen.getByText("Contar este producto"));

    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(adoptarCodigo).not.toHaveBeenCalled();
    expect(cambiarCodigo).not.toHaveBeenCalled();
    expect(onListo.mock.calls[0][0].barcode).toBe("7802000016448");
  });
});
