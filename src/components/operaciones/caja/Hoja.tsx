"use client";

import React, { useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

/**
 * Hoja que sube desde abajo, para confirmar o ver un detalle sin salir de la
 * pantalla de caja. Abajo porque el pulgar llega ahí con el teléfono en una
 * mano; el botón principal siempre va al final.
 */
export default function Hoja({
  titulo,
  onClose,
  children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Escape cierra (teclado físico o lector conectado al teléfono).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-[#111] border-t border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[#111] border-b border-white/5 px-4 py-2 flex items-center gap-3">
          <p className="flex-1 min-w-0 text-sm font-black text-white truncate">{titulo}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-12 h-12 shrink-0 rounded-xl bg-white/5 text-white/50 flex items-center justify-center active:bg-white/10"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}
