import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { medidasReducidas, nombreArchivoFoto, textoAFirmarCloudinary } from "./foto";

describe("foto del producto", () => {
  it("achica al lado mayor de 1000 px sin deformar", () => {
    expect(medidasReducidas(4000, 3000)).toEqual({ ancho: 1000, alto: 750 });
    expect(medidasReducidas(3000, 4000)).toEqual({ ancho: 750, alto: 1000 });
  });

  it("no agranda una foto chica", () => {
    expect(medidasReducidas(640, 480)).toEqual({ ancho: 640, alto: 480 });
  });

  it("firma de Cloudinary: parámetros ordenados + secreto (ejemplo de su documentación)", () => {
    const texto = textoAFirmarCloudinary(
      { timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", api_key: "x", file: "y" },
      "abcd"
    );
    expect(texto).toBe("eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510abcd");
    expect(createHash("sha1").update(texto).digest("hex")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("nombre de archivo sin caracteres raros", () => {
    expect(nombreArchivoFoto("78/01 61", 1700000000000, 0.123456789)).toMatch(/^product-780161-1700000000000-[a-z0-9]+\.jpg$/);
  });
});
