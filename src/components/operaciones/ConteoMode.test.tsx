// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductUI } from "@/types";

const producto = (id: string, name: string, extra: Partial<ProductUI> = {}) =>
  ({ id, barcode: id, name, stock: 5, price: 1000, ...extra }) as ProductUI;

const activos = [producto("222", "Harina de trigo"), producto("333", "Arroz")];
const inactivos = [producto("111", "HARINA DE MAÍZ PAN BLANCA")];
const upsertLocal = vi.fn();

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "ADMIN" } } }) }));
vi.mock("@/hooks/useProductCatalog", () => ({
  useProductCatalog: () => ({ products: activos, upsertLocal, refresh: vi.fn() }),
}));
vi.mock("@/contexts/BranchContext", () => ({ useBranch: () => ({ currentBranch: { id: "b1", name: "Principal" } }) }));
vi.mock("@/contexts/SyncContext", () => ({ useSync: () => ({ refreshPending: vi.fn() }) }));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/offline/apiWrite", () => ({ apiWrite: vi.fn() }));
vi.mock("@/components/scanner/UnifiedScanner", () => ({ default: () => null }));
vi.mock("@/components/operaciones/QuickCreateReceptionModal", () => ({
  default: ({ initialName }: { initialName?: string }) => <div>modal-crear {initialName}</div>,
}));
vi.mock("@/components/operaciones/inventario/CierreConteo", () => ({ default: () => null }));

import ConteoMode from "./ConteoMode";

const sesion = {
  sessionId: "s1", status: "OPEN", applyMode: "ON_CLOSE", openedAt: new Date().toISOString(),
  openedBy: "Ingrid", contados: 0, unidades: 0, conDiferencia: 0, diferenciaNeta: 0, enCero: 0,
  marcas: 0, enVariosLugares: 0, movidosDesdeElConteo: 0, pendientes: 398, totalCatalogo: 398,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (u.startsWith("/api/inventario/buscar?q=")) {
        const q = decodeURIComponent(u.split("q=")[1]).toLowerCase();
        return json({ productos: [...inactivos, ...activos].filter((p) => q.split(" ").every((w) => p.name.toLowerCase().includes(w))) });
      }
      if (u.startsWith("/api/inventario/conteo/producto")) return json({});
      return json({ session: sesion });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function escribir(texto: string) {
  const input = await screen.findByPlaceholderText(/Buscar producto por nombre/);
  fireEvent.change(input, { target: { value: texto } });
}

describe("ConteoMode · buscador", () => {
  it("muestra el inactivo aunque haya coincidencias activas", async () => {
    render(<ConteoMode />);
    await escribir("harina");
    expect(await screen.findByText("Harina de trigo")).toBeTruthy();
    expect(await screen.findByText("HARINA DE MAÍZ PAN BLANCA")).toBeTruthy();
    expect(screen.getByText(/fuera del catálogo/)).toBeTruthy();
  });

  it("no repite como inactivo lo que ya está en el catálogo", async () => {
    render(<ConteoMode />);
    await escribir("harina");
    await screen.findByText("HARINA DE MAÍZ PAN BLANCA");
    expect(screen.getAllByText("Harina de trigo")).toHaveLength(1);
  });

  it("el botón Crear está siempre, con o sin coincidencias", async () => {
    render(<ConteoMode />);
    await escribir("harina");
    await screen.findByText("HARINA DE MAÍZ PAN BLANCA");
    expect(screen.getByText(/Crear/)).toBeTruthy();
    expect(screen.getByText("¿Ninguno es el que buscas?")).toBeTruthy();

    await escribir("zzzzz");
    await waitFor(() => expect(screen.getByText("Sin coincidencias.")).toBeTruthy());
    expect(screen.getByText(/Crear/)).toBeTruthy();
  });

  it("elegir el inactivo lo agrega a la lista y lo guarda en el catálogo local", async () => {
    render(<ConteoMode />);
    await escribir("harina pan");
    fireEvent.click(await screen.findByText("HARINA DE MAÍZ PAN BLANCA"));
    expect(upsertLocal).toHaveBeenCalledWith(expect.objectContaining({ id: "111" }));
    await waitFor(() => expect(screen.getByText(/Sin guardar \(1\)/i)).toBeTruthy());
  });
});
