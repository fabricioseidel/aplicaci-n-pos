import { describe, expect, it } from "vitest";
import { esCodigoGenerico } from "./codigos";

describe("esCodigoGenerico", () => {
  it("reconoce los códigos inventados de la base", () => {
    for (const c of ["INT-MT6BGZ4R", "SINCOD-ATUN-MOLINOVA", "900000000113", "12355", "", "  "]) {
      expect(esCodigoGenerico(c)).toBe(true);
    }
  });

  it("no confunde un EAN/UPC real", () => {
    for (const c of ["7802000016448", "7702090031942", "745314559355", "78020000"]) {
      expect(esCodigoGenerico(c)).toBe(false);
    }
  });
});
