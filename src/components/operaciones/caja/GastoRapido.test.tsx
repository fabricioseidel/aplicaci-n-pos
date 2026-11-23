// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GastoRapido, { motivoDeGasto } from "./GastoRapido";

afterEach(cleanup);

describe("motivoDeGasto", () => {
  it("junta el tipo y el detalle", () => {
    expect(motivoDeGasto("Bolsas", "rollo grande")).toBe("Gasto: Bolsas · rollo grande");
    expect(motivoDeGasto("Otro", "tijeras")).toBe("Gasto: tijeras");
    expect(motivoDeGasto(null, "")).toBe("Gasto: varios");
  });
});

describe("GastoRapido", () => {
  it("registra un egreso en efectivo con el motivo, tras confirmar", async () => {
    const onRegistrar = vi.fn(async () => true);
    render(<GastoRapido onRegistrar={onRegistrar} />);

    expect((screen.getByText("Registrar gasto") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Monto del gasto"), { target: { value: "3500" } });
    fireEvent.click(screen.getByText("Aseo"));
    fireEvent.click(screen.getByText("Registrar gasto"));

    expect(onRegistrar).not.toHaveBeenCalled(); // pide confirmar antes
    fireEvent.click(await screen.findByText("Registrar"));
    await waitFor(() => expect(onRegistrar).toHaveBeenCalled());
    expect(onRegistrar).toHaveBeenCalledWith({ amount: 3500, type: "OUT", method: "CASH", reason: "Gasto: Aseo" });
  });
});
