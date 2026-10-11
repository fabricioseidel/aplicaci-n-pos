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

const ENTRY = "6f1c2a3b-1111-4222-8333-944455556666";

beforeEach(() => {
  estado.db = crearFakeDb({
    cash_shifts: [{ id: "t1", status: "OPEN", branch_id: "b1" }],
    branches: [{ id: "b1", is_active: true, is_default: true }],
    products: [{ barcode: "111", name: "Score Gorilla", sale_price: 1300, offer_price: null }],
    sellers: [],
    sales: [],
    account_entries: [],
  });
  estado.db.rpcs.apply_sale = () => ({ data: 77, error: null });
});

async function vender(extra: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://x/api/sales", {
      method: "POST",
      body: JSON.stringify({
        clientSaleId: "c1",
        total: 2600,
        branchId: "b1",
        shiftId: "t1",
        items: [{ barcode: "111", name: "Score Gorilla", qty: 2, unit_price: 1300, subtotal: 2600 }],
        ...extra,
      }),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/sales · fiado", () => {
  it("registra la venta sin pago en caja y carga el total a la cuenta", async () => {
    const r = await vender({ fiado: { entryId: ENTRY, accountId: "cta1", nombre: "Blue" }, cashReceived: 5000 });
    expect(r).toEqual({ status: 200, body: { ok: true, saleId: 77 } });

    const args = estado.db.llamadasRpc.find((c) => c.fn === "apply_sale")!.args;
    expect(args.p_payments).toEqual([{ method: "OTHER", amount: 2600, reference: "FIADO" }]);
    expect(args.p_cash_received).toBe(0);
    expect(String(args.p_notes)).toContain("Fiado: Blue");

    expect(estado.db.tablas.account_entries).toEqual([
      expect.objectContaining({ id: ENTRY, account_id: "cta1", shift_id: "t1", kind: "CHARGE", amount: 2600, method: null }),
    ]);
    expect(String(estado.db.tablas.account_entries[0].note)).toMatch(/^Venta #77 · fiado/);
  });

  it("a una cuenta nueva la crea por nombre", async () => {
    estado.db.rpcs.find_or_create_account = () => ({ data: "nueva1", error: null });
    await vender({ fiado: { entryId: ENTRY, nombreNuevo: "Don Pedro", nombre: "Don Pedro" } });
    expect(estado.db.tablas.account_entries[0]).toMatchObject({ account_id: "nueva1", amount: 2600 });
  });

  it("sin cuenta o sin id no registra nada", async () => {
    expect((await vender({ fiado: { entryId: ENTRY } })).status).toBe(400);
    expect((await vender({ fiado: { entryId: "x", accountId: "cta1" } })).status).toBe(400);
    expect(estado.db.llamadasRpc.some((c) => c.fn === "apply_sale")).toBe(false);
  });

  it("una venta normal no anota fiado", async () => {
    await vender({ payments: [{ method: "CASH", amount: 2600 }], cashReceived: 3000 });
    expect(estado.db.tablas.account_entries).toEqual([]);
  });
});
