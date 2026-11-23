// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AyudaGuia, { urlGuia } from "./AyudaGuia";

afterEach(cleanup);

describe("AyudaGuia", () => {
  it("cada pestaña abre su sección de la guía", () => {
    expect(urlGuia("VENTA")).toBe("/guia/index.html#venta");
    expect(urlGuia("CONTEO")).toBe("/guia/index.html#inventario");
    expect(urlGuia("CAJA")).toBe("/guia/index.html#caja");
    expect(urlGuia(null)).toBe("/guia/index.html");
  });

  it("el botón ? abre la guía encima de la app y Cerrar la cierra", () => {
    render(<AyudaGuia pestana="CAJA" />);
    expect(screen.queryByTitle("Guía de uso de la app")).toBeNull();

    fireEvent.click(screen.getByLabelText("Ayuda: guía de uso"));
    const iframe = screen.getByTitle("Guía de uso de la app") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe("/guia/index.html#caja");

    fireEvent.click(screen.getByText("Cerrar"));
    expect(screen.queryByTitle("Guía de uso de la app")).toBeNull();
  });

  it("Escape también la cierra", () => {
    render(<AyudaGuia pestana="VENTA" />);
    fireEvent.click(screen.getByLabelText("Ayuda: guía de uso"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTitle("Guía de uso de la app")).toBeNull();
  });
});
