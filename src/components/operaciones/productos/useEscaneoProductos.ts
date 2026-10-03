"use client";

import { useScan } from "@/components/scanner/ScanProvider";

/**
 * Punto de enganche del lector láser en Productos.
 *
 * Escanear en la lista abre la ficha; con una ficha abierta, abre la del otro
 * producto (preguntando si había cambios sin guardar); en "Lista de precios",
 * carga el siguiente. Ninguna lectura queda escrita como precio: el
 * `ScanProvider` cancela el Enter y devuelve al campo su valor previo (salvo
 * los campos `data-scan-accept`, como el código de barras de un alta).
 *
 * Con una hoja abierta (ajustar stock, confirmar) no se registra handler: la
 * lectura se descarta con el aviso "Lectura ignorada".
 */
export function useEscaneoProductos({
  enabled,
  onScan,
}: {
  enabled: boolean;
  onScan: (code: string) => void;
}) {
  useScan(onScan, enabled);
}
