"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

/** Sección de la guía que corresponde a cada pestaña de la app. */
export const SECCION_GUIA: Record<string, string> = {
  VENTA: "venta",
  RECEPCION: "recepcion",
  CONTEO: "inventario",
  CAJA: "caja",
  PRODUCTOS: "productos",
};

export function urlGuia(pestana?: string | null): string {
  const seccion = pestana ? SECCION_GUIA[pestana] : undefined;
  return `/guia/index.html${seccion ? `#${seccion}` : ""}`;
}

/**
 * Botón "?" de la barra de arriba: abre la guía de uso (public/guia) a
 * pantalla completa, en la sección de la pestaña donde se está.
 *
 * Se abre encima de la app, sin navegar: el carrito, la lista de recepción o
 * el conteo a medio hacer siguen ahí al cerrarla. El botón "atrás" de Android
 * también la cierra, en vez de salir de la app.
 */
export default function AyudaGuia({ pestana }: { pestana?: string | null }) {
  const [abierta, setAbierta] = useState(false);
  const conHistorial = useRef(false);

  const cerrar = useCallback(() => {
    setAbierta(false);
    if (conHistorial.current) {
      conHistorial.current = false;
      try {
        window.history.back();
      } catch {
        /* noop */
      }
    }
  }, []);

  const abrir = () => {
    setAbierta(true);
    try {
      window.history.pushState({ guia: true }, "");
      conHistorial.current = true;
    } catch {
      conHistorial.current = false;
    }
  };

  useEffect(() => {
    if (!abierta) return;
    const alVolver = () => {
      // "Atrás" del teléfono: la entrada que agregamos ya se consumió.
      conHistorial.current = false;
      setAbierta(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("popstate", alVolver);
    window.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("popstate", alVolver);
      window.removeEventListener("keydown", alTeclear);
    };
  }, [abierta, cerrar]);

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Ayuda: guía de uso"
        title="Guía de uso"
        className="flex items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/5 text-white/70 hover:text-white active:bg-white/10"
      >
        <QuestionMarkCircleIcon className="w-5 h-5" />
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Guía de uso"
          className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0a]"
        >
          <div className="flex items-center justify-between gap-3 px-3 h-12 border-b border-white/10 shrink-0">
            <p className="text-xs font-black uppercase tracking-widest text-emerald-400">Guía de uso</p>
            <button
              type="button"
              onClick={cerrar}
              className="flex items-center gap-1.5 h-10 px-3 -mr-1 rounded-xl bg-white/5 text-white text-xs font-black uppercase tracking-widest active:bg-white/10"
            >
              <XMarkIcon className="w-5 h-5" /> Cerrar
            </button>
          </div>
          <iframe title="Guía de uso de la app" src={urlGuia(pestana)} className="flex-1 w-full border-0 bg-white" />
        </div>
      )}
    </>
  );
}
