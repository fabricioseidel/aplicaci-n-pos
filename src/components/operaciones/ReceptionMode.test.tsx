// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductUI } from "@/types";

const producto = (id: string, name: string) => ({ id, barcode: id, name, stock: 5, price: 1000 }) as ProductUI;
const activos = [producto("222", "Harina de trigo"), producto("333", "Arroz")];
const inactivos = [producto("111", "HARINA DE MAÍZ PAN BLANCA")];
const addProduct = vi.fn();

vi.mock("@/hooks/useQuickInventory", () => ({
  useQuickInventory: () => ({
    items: [], addItem: vi.fn(), addProduct, updateQuantity: vi.fn(), updateLine: vi.fn(), confirm: vi.fn(),
    clear: vi.fn(), recuperados: 0, descartarAvisoRecuperados: vi.fn(), isScanning: false, isSaving: false,
    error: null, success: null, totalItems: 0,
  }),
}));
vi.mock("@/hooks/useProductCatalog", () => ({ useProductCatalog: () => ({ products: activos, upsertLocal: vi.fn() }) }));
vi.mock("@/contexts/BranchContext", () => ({ useBranch: () => ({ currentBranch: { id: "b1", is_default: true } }) }));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/components/scanner/UnifiedScanner", () => ({ default: () => null }));
vi.mock("@/components/operaciones/QuickCreateReceptionModal", () => ({ default: () => <div>modal-crear</div> }));

import ReceptionMode from "./ReceptionMode";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(String(url), "http://x");
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const base = u.searchParams.get("inactivos") === "1" ? inactivos : [...inactivos, ...activos];
      return { ok: true, json: async () => ({ productos: base.filter((p) => q.split(" ").every((w) => p.name.toLowerCase().includes(w))) }) };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const escribir = (t: string) =>
  fireEvent.change(screen.getByPlaceholderText(/Buscar producto por nombre/), { target: { value: t } });

describe("ReceptionMode · buscador", () => {
  it("muestra el inactivo junto a los activos y pide sólo inactivos", async () => {
    render(<ReceptionMode />);
    escribir("harina");
    expect(await screen.findByText("Harina de trigo")).toBeTruthy();
    expect(await screen.findByText("HARINA DE MAÍZ PAN BLANCA")).toBeTruthy();
    expect(screen.getByText(/recibirlo lo reactiva/)).toBeTruthy();
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/inventario/buscar?q=harina&inactivos=1"))).toBe(true);
  });

  it("el botón Crear está siempre, con o sin coincidencias", async () => {
    render(<ReceptionMode />);
    escribir("harina");
    await screen.findByText("Harina de trigo");
    expect(screen.getByText(/Crear "harina"/)).toBeTruthy();
    escribir("zzzz");
    await waitFor(() => expect(screen.getByText("Sin coincidencias.")).toBeTruthy());
    expect(screen.getByText(/Crear "zzzz"/)).toBeTruthy();
  });

  it("elegir el inactivo lo agrega a la recepción", async () => {
    render(<ReceptionMode />);
    escribir("pan harina");
    fireEvent.click(await screen.findByText("HARINA DE MAÍZ PAN BLANCA"));
    expect(addProduct).toHaveBeenCalledWith(expect.objectContaining({ id: "111" }), 1);
  });
});
