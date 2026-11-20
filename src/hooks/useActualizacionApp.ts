"use client";

import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";

/** Cada cuánto se pregunta si hay versión nueva con la app abierta. */
const INTERVALO_MS = 60_000;
const RECARGA_KEY = "olivo-pos.recargado-para";

async function versionPublicada(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null; // sin red: se sigue con lo que hay
  }
}

/**
 * Mantiene la app en la última versión publicada.
 *
 * La app del teléfono carga la web en vivo, pero una vez abierta sigue con el
 * código que bajó: un arreglo publicado a mitad del día no llegaba hasta
 * cerrarla y abrirla. Ahora:
 *
 * - al volver a la app (estaba en segundo plano) con versión nueva, recarga
 *   sola: en ese momento nadie está escribiendo y lo sin guardar del
 *   inventario vive en el teléfono, así que no se pierde;
 * - con la app en uso, avisa con un botón "Actualizar" en vez de recargar en
 *   medio de una venta o de un número a medio escribir.
 *
 * Recarga una sola vez por versión: si después de recargar el servidor sigue
 * diciendo otra cosa (caché, despliegue a medias), queda el botón.
 */
export function useActualizacionApp(): { hayNueva: boolean; actualizar: () => void } {
  const [nueva, setNueva] = useState<string | null>(null);

  const actualizar = useCallback(() => {
    try {
      if (nueva) sessionStorage.setItem(RECARGA_KEY, nueva);
    } catch {
      /* noop */
    }
    window.location.reload();
  }, [nueva]);

  useEffect(() => {
    if (APP_VERSION === "dev") return;
    let cancelado = false;

    const revisar = async (puedeRecargar: boolean) => {
      const v = await versionPublicada();
      if (cancelado || !v || v === APP_VERSION) {
        if (!cancelado && v === APP_VERSION) setNueva(null);
        return;
      }
      let yaRecargado = false;
      try {
        yaRecargado = sessionStorage.getItem(RECARGA_KEY) === v;
      } catch {
        /* noop */
      }
      if (puedeRecargar && !yaRecargado) {
        try {
          sessionStorage.setItem(RECARGA_KEY, v);
        } catch {
          /* noop */
        }
        window.location.reload();
        return;
      }
      setNueva(v);
    };

    void revisar(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void revisar(false);
    }, INTERVALO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void revisar(true);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  return { hayNueva: nueva !== null, actualizar };
}
