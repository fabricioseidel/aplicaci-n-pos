"use client";

import { useLaserScanner } from "@/components/scanner/useLaserScanner";

/**
 * Punto de enganche del lector láser en Productos.
 *
 * Escanear en la lista abre la ficha; con una ficha abierta, abre la del otro
 * producto (preguntando si había cambios sin guardar); en "Lista de precios",
 * carga el siguiente. Ninguna lectura debe quedar escrita como precio: eso lo
 * garantiza `useLaserScanner` con los campos `data-scan-guard`.
 *
 * TODO(merge ccr-8cc05d73-8l31jk): pasar a `useLaserScanner({ enabled, onScan })`.
 */
export function useEscaneoProductos({
  enabled,
  onScan,
}: {
  enabled: boolean;
  onScan: (code: string) => void;
}) {
  useLaserScanner({ enabled, onDetected: onScan });
}
