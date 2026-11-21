import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearFakeDb, clienteFake, type FakeDb } from "@/test/fakeSupabase";

const estado: { db: FakeDb } = { db: crearFakeDb() };

vi.mock("@/lib/api-auth", () => ({
  requireApiAdminOrSeller: async () => ({ ok: true, role: "SELLER", userId: "u1", session: { user: { name: "Caja" } } }),
}));
vi.mock("@/lib/supabase-server", () => ({
  get supabaseServer() {
    return clienteFake(estado.db);
  },
}));

const UUID_SUCURSAL = "f638e5a2-b91b-4d78-8dee-2f2efb229ee8";
const UUID_MINIMARKET = "c62cc414-f0f2-45dc-b090-54b8b26311f4";

beforeEach(() => {
  estado.db = crearFakeDb({
    cash_shifts: [
      { id: "turno-minimarket-viejo", status: "OPEN", branch_id: UUID_MINIMARKET, started_at: "2026-10-12" },
      { id: "turno-sucursal-hoy", status: "OPEN", branch_id: UUID_SUCURSAL, started_at: "2026-11-21" },
      { id: "turno-sucursal-cerrado", status: "CLOSED", branch_id: UUID_SUCURSAL, started_at: "2026-11-20" },
    ],
    branches: [
      { id: UUID_MINIMARKET, is_active: true, is_default: true },
      { id: UUID_SUCURSAL, is_active: true, is_default: false },
    ],
    products: [{ barcode: "111", name: "Huevos", sale_price: 6500, offer_price: null }],
    sellers: [],
    sales: [],
  });
  estado.db.rpcs.apply_sale = () => ({ data: 314, error: null });
});

async function vender(shiftId: string) {
  const { POST } = await import("./route");
  await POST(
    new Request("http://x/api/sales", {
      method: "POST",
      body: JSON.stringify({
        clientSaleId: "c1",
        total: 6500,
        branchId: UUID_SUCURSAL,
        shiftId,
        items: [{ barcode: "111", name: "Huevos", qty: 1, unit_price: 6500, subtotal: 6500 }],
      }),
    })
  );
  return estado.db.llamadasRpc.find((c) => c.fn === "apply_sale")?.args.p_shift_id;
}

describe("POST /api/sales · turno de la sede", () => {
  it("un turno guardado de OTRA sede no se respeta: la venta va al turno vigente de la sede", async () => {
    expect(await vender("turno-minimarket-viejo")).toBe("turno-sucursal-hoy");
  });

  it("el turno de la misma sede se respeta, aunque ya esté cerrado (venta offline sincronizada)", async () => {
    expect(await vender("turno-sucursal-cerrado")).toBe("turno-sucursal-cerrado");
  });

  it("un turno que no existe cae al vigente de la sede", async () => {
    expect(await vender("no-existe")).toBe("turno-sucursal-hoy");
  });
});
