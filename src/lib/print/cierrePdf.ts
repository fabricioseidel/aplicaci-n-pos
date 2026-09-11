import { jsPDF } from "jspdf";
import { Capacitor } from "@capacitor/core";
import { buildCierreLines, TICKET_COLS } from "@/lib/print/cierreLines";
import type { CierreResumen } from "@/lib/cierre/types";

/** Ancho del rollo de la térmica. */
const TICKET_WIDTH_MM = 58;
const MARGIN_MM = 3;
const LINE_HEIGHT_MM = 3.1;

/**
 * El cierre como PDF de 58 mm de ancho.
 *
 * No se imprime directo desde la app: se genera el PDF y se entrega al share
 * de Android para que lo tome la app de la impresora. Es una toma de decisión
 * deliberada — imprimir por Bluetooth desde Capacitor obliga a un plugin
 * nativo y permisos nuevos, y el mismo PDF sirve además para archivar.
 */
export function cierreToPdf(resumen: CierreResumen): jsPDF {
  const lines = buildCierreLines(resumen);
  const height = MARGIN_MM * 2 + lines.length * LINE_HEIGHT_MM;

  const doc = new jsPDF({
    unit: "mm",
    format: [TICKET_WIDTH_MM, height],
    orientation: "portrait",
  });

  // Courier es monoespaciada: es lo que hace que los montos queden alineados
  // al borde derecho igual que en una térmica.
  doc.setFont("courier", "normal");

  // El tamaño se deriva del ancho disponible en vez de fijarse a ojo, para que
  // las 32 columnas entren exactas aunque se cambie el margen.
  const usableMm = TICKET_WIDTH_MM - MARGIN_MM * 2;
  const charWidthMm = usableMm / TICKET_COLS;
  doc.setFontSize((charWidthMm / 0.6) * 2.8346); // 0.6em por carácter en Courier; mm → pt

  lines.forEach((line, i) => {
    doc.text(line, MARGIN_MM, MARGIN_MM + LINE_HEIGHT_MM * (i + 1));
  });

  return doc;
}

export function cierreFileName(resumen: CierreResumen): string {
  const branch = (resumen.branch ?? "local").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `cierre-${resumen.shift.business_date}-${branch}.pdf`;
}

export type SalidaCierre = "shared" | "downloaded" | "sin-plugins";

/**
 * Entrega el PDF al sistema: share sheet en el celular, descarga en el resto.
 *
 * La app Android es un cascarón que sirve el sitio en vivo desde Vercel
 * (`server.url` en capacitor.config.ts), así que el código web llega al
 * celular con cada deploy pero los plugins nativos sólo existen si se
 * reconstruyó el APK. Un APK viejo corriendo el sitio nuevo tiene
 * `isNativePlatform() === true` y los plugins sin registrar: por eso el share
 * se intenta y se cae a la descarga, en vez de dar un error genérico.
 */
export async function compartirCierre(resumen: CierreResumen): Promise<SalidaCierre> {
  const doc = cierreToPdf(resumen);
  const fileName = cierreFileName(resumen);

  if (Capacitor.isNativePlatform()) {
    try {
      // Import dinámico: en el navegador estos plugins no existen y un import
      // estático arrastraría código muerto al bundle web.
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
      ]);

      const base64 = doc.output("datauristring").split(",")[1];

      const written = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });

      await Share.share({
        title: "Cierre de caja",
        text: `Cierre ${resumen.shift.business_date}`,
        url: written.uri,
        dialogTitle: "Imprimir o guardar el cierre",
      });

      return "shared";
    } catch {
      doc.save(fileName);
      return "sin-plugins";
    }
  }

  doc.save(fileName);
  return "downloaded";
}
