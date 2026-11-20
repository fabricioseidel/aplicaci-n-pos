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

vi.mock("@/hooks/useAttendant", () => ({ useAttendant: () => ({ attendant: { id: "m", name: "Mariana" }, ready: true }) }));

import ConteoMode from "./ConteoMode";
import { apiWrite } from "@/lib/offline/apiWrite";

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
        const params = new URL(u, "http://x").searchParams;
        const q = (params.get("q") ?? "").toLowerCase();
        const base = params.get("inactivos") === "1" ? inactivos : [...inactivos, ...activos];
        return json({ productos: base.filter((p) => q.split(" ").every((w) => p.name.toLowerCase().includes(w))) });
      }
      if (u.startsWith("/api/inventario/conteo/producto")) return json({});
      return json({ session: sesion, extras: true });
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

  it("pide al servidor sólo inactivos (los activos llenaban el límite de 25)", async () => {
    render(<ConteoMode />);
    await escribir("harina");
    await screen.findByText("HARINA DE MAÍZ PAN BLANCA");
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/api/inventario/buscar?q=harina&inactivos=1"))).toBe(true);
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

describe("Inventario · lote", () => {
  it("guarda el lote a nombre de quien cuenta, con el vencimiento anotado", async () => {
    (apiWrite as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { aplicados: 1 } });
    render(<ConteoMode />);
    await escribir("arroz");
    fireEvent.click(await screen.findByText("Arroz"));
    fireEvent.change(await screen.findByLabelText("Vencimiento de Arroz"), { target: { value: "2027-01-31" } });
    fireEvent.click(screen.getByText("Guardar lote (1)"));

    await waitFor(() => expect(apiWrite).toHaveBeenCalled());
    const llamada = (apiWrite as unknown as { mock: { calls: Array<[{ url: string; payload: Record<string, unknown> }]> } })
      .mock.calls[0][0];
    expect(llamada.url).toBe("/api/inventario/conteo/items");
    expect(llamada.payload.countedBy).toBe("Mariana");
    expect(llamada.payload.sessionId).toBe("s1");
    expect(llamada.payload.items).toEqual([{ barcode: "333", qty: 1, replace: false, expiry: "2027-01-31" }]);
  });

  it("muestra quién contó cuánto cuando el producto ya se contó en otro teléfono", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (u.startsWith("/api/inventario/conteo/producto"))
        return json({ contado: 8, porPersona: [{ por: "Alfredo", qty: 5 }, { por: "Mariana", qty: 3 }] });
      if (u.startsWith("/api/inventario/buscar")) return json({ productos: [] });
      return json({ session: sesion, extras: true });
    });
    render(<ConteoMode />);
    await escribir("arroz");
    fireEvent.click(await screen.findByText("Arroz"));
    expect(await screen.findByText(/Alfredo 5 \+ Mariana 3 · total 9/)).toBeTruthy();
  });
});

describe("Inventario · dos teléfonos", () => {
  it("si otro teléfono cerró el inventario, el lote se guarda en el que está abierto", async () => {
    let abierta = sesion;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (u.startsWith("/api/inventario/buscar")) return json({ productos: [] });
      if (u.startsWith("/api/inventario/conteo/producto")) return json({});
      return json({ session: abierta, extras: true });
    });
    const write = apiWrite as unknown as ReturnType<typeof vi.fn>;
    write
      .mockImplementationOnce(async () => {
        abierta = { ...sesion, sessionId: "s2" };
        return { ok: false, error: "El conteo ya está cerrado" };
      })
      .mockResolvedValueOnce({ ok: true, data: { aplicados: 1 } });

    render(<ConteoMode />);
    await escribir("arroz");
    fireEvent.click(await screen.findByText("Arroz"));
    fireEvent.click(await screen.findByText("Guardar lote (1)"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    const sesiones = write.mock.calls.map((c) => (c[0] as { payload: { sessionId: string } }).payload.sessionId);
    expect(sesiones).toEqual(["s1", "s2"]);
    await waitFor(() => expect(screen.getByText(/Sin guardar \(0\)/i)).toBeTruthy());
  });
});

describe("Inventario · base sin migrar", () => {
  it("no muestra el vencimiento si la base todavía no lo guarda", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (u.startsWith("/api/inventario/buscar")) return json({ productos: [] });
      if (u.startsWith("/api/inventario/conteo/producto")) return json({ contado: 4, marcas: 1 });
      return json({ session: sesion, extras: false });
    });
    render(<ConteoMode />);
    await escribir("arroz");
    fireEvent.click(await screen.findByText("Arroz"));
    expect(await screen.findByText(/Ya contado 4 · total 5/)).toBeTruthy();
    expect(screen.queryByLabelText("Vencimiento de Arroz")).toBeNull();
    expect(screen.queryByText(/Historial de lotes/)).toBeNull();
  });
});

describe("Inventario · ya escaneados", () => {
  it("avisa al instante que el producto ya se contó y lo muestra en la lista", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, json: async () => b });
      if (u.startsWith("/api/inventario/buscar")) return json({ productos: [] });
      if (u.startsWith("/api/inventario/conteo/contados"))
        return json({
          productos: [
            { barcode: "333", name: "Arroz", total: 8, marcas: 2, porPersona: [{ por: "Ingrid", qty: 8 }], ultimo: new Date().toISOString() },
          ],
        });
      if (u.startsWith("/api/inventario/conteo/producto")) return json({});
      return json({ session: { ...sesion, marcas: 2 }, extras: false });
    });
    render(<ConteoMode />);
    expect(await screen.findByText(/Ya escaneados \(1 productos · 8 u\.\)/)).toBeTruthy();
    await escribir("arroz");
    expect(await screen.findByText(/ya contado 8/)).toBeTruthy();
    fireEvent.click(screen.getByText("Arroz"));
    expect(await screen.findByText(/Ingrid 8 · total 9/)).toBeTruthy();
  });
});
