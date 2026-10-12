// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CierreResumen } from "@/lib/cierre/types";

const bt = vi.hoisted(() => ({
  hay: true,
  vinculadas: [] as Array<{ nombre: string | null; direccion: string }>,
  imprimir: vi.fn(),
  guardar: vi.fn(),
}));
const compartirCierre = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("@/lib/print/cierrePdf", () => ({ compartirCierre }));
vi.mock("@/lib/print/cierreLines", () => ({ buildCierreLines: () => ["CIERRE"] }));
vi.mock("@/lib/print/impresoraBT", async (original) => ({
  ...(await original<typeof import("@/lib/print/impresoraBT")>()),
  hayImpresoraBT: () => bt.hay,
  listarVinculadas: async () => bt.vinculadas,
  imprimirLineas: bt.imprimir,
  impresoraGuardada: () => null,
  guardarImpresora: bt.guardar,
}));

import { useImprimirCierre } from "./useImprimirCierre";

const resumen = { shift: { business_date: "2026-10-11" } } as CierreResumen;

function Pantalla() {
  const { imprimir, selector } = useImprimirCierre();
  return (
    <>
      <button type="button" onClick={() => imprimir(resumen)}>imprimir</button>
      {selector}
    </>
  );
}

beforeEach(() => {
  bt.hay = true;
  bt.vinculadas = [];
  bt.imprimir.mockReset().mockResolvedValue(undefined);
  bt.guardar.mockReset();
  compartirCierre.mockReset().mockResolvedValue("shared");
  showToast.mockReset();
});
afterEach(cleanup);

describe("useImprimirCierre", () => {
  it("sin el plugin en el APK, comparte el PDF como antes", async () => {
    bt.hay = false;
    render(<Pantalla />);
    fireEvent.click(screen.getByText("imprimir"));
    await waitFor(() => expect(compartirCierre).toHaveBeenCalledWith(resumen));
    expect(bt.imprimir).not.toHaveBeenCalled();
  });

  it("con la MPT-II vinculada imprime directo y la recuerda", async () => {
    const mpt = { nombre: "MPT-II", direccion: "66:22:AA:01:02:03" };
    bt.vinculadas = [{ nombre: "Galaxy Buds", direccion: "11:11:11:11:11:11" }, mpt];
    render(<Pantalla />);
    fireEvent.click(screen.getByText("imprimir"));
    await waitFor(() => expect(bt.imprimir).toHaveBeenCalledWith(mpt.direccion, ["CIERRE"]));
    expect(bt.guardar).toHaveBeenCalledWith(mpt);
    expect(showToast).toHaveBeenCalledWith("Impreso en MPT-II ✓", "success");
  });

  it("con dos impresoras pregunta en cuál", async () => {
    bt.vinculadas = [
      { nombre: "MPT-II", direccion: "66:22:AA:01:02:03" },
      { nombre: "XP-58 Printer", direccion: "33:33:33:33:33:33" },
    ];
    render(<Pantalla />);
    fireEvent.click(screen.getByText("imprimir"));
    fireEvent.click(await screen.findByText("XP-58 Printer"));
    await waitFor(() => expect(bt.imprimir).toHaveBeenCalledWith("33:33:33:33:33:33", ["CIERRE"]));
  });

  it("si la impresora está apagada avisa y no se olvida de ella", async () => {
    bt.vinculadas = [{ nombre: "MPT-II", direccion: "66:22:AA:01:02:03" }];
    bt.imprimir.mockRejectedValue(Object.assign(new Error("x"), { code: "conexion" }));
    render(<Pantalla />);
    fireEvent.click(screen.getByText("imprimir"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "No se pudo conectar con la impresora. Revisa que esté encendida y cerca.",
        "error"
      )
    );
    expect(bt.guardar).not.toHaveBeenCalled();
  });
});
