"use client";

import { useScan } from "./ScanProvider";

interface UseLaserScannerOptions {
  onDetected: (code: string) => void;
  enabled?: boolean;
}

/**
 * Lecturas del lector láser (HID que teclea el código y Enter).
 *
 * La detección vive en `ScanProvider`, una sola para toda la app; esto es
 * sólo la forma de suscribirse que ya usaba `UnifiedScanner`.
 */
export function useLaserScanner({ onDetected, enabled = true }: UseLaserScannerOptions) {
  useScan(onDetected, enabled);
}
