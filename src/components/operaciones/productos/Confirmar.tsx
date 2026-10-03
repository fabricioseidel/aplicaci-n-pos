"use client";

import React from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

export interface AccionConfirmar {
  label: string;
  onClick: () => void;
  tono?: "primario" | "peligro" | "neutro";
}

/**
 * Pregunta grande y clara antes de algo que conviene revisar (un precio que
 * cambia mucho, un cambio sin guardar). Botones de 52 px: se usa con el
 * cliente esperando.
 */
export default function Confirmar({
  titulo,
  avisos,
  acciones,
}: {
  titulo: string;
  avisos?: string[];
  acciones: AccionConfirmar[];
}) {
  const clase = (t: AccionConfirmar["tono"]) =>
    t === "primario"
      ? "bg-emerald-500 text-black active:bg-emerald-600"
      : t === "peligro"
        ? "bg-red-500/15 border border-red-500/40 text-red-300"
        : "bg-white/5 border border-white/10 text-white/70";

  return (
    <div
      role="alertdialog"
      aria-label={titulo}
      className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-[#111] border border-amber-500/30 rounded-3xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="w-7 h-7 text-amber-400 shrink-0" />
          <h2 className="text-lg font-black text-white leading-snug">{titulo}</h2>
        </div>
        {avisos && avisos.length > 0 && (
          <ul className="space-y-1.5">
            {avisos.map((a) => (
              <li key={a} className="text-base font-bold text-amber-200 leading-snug">
                {a}
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2">
          {acciones.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={`w-full min-h-[3.25rem] rounded-2xl text-sm font-black uppercase tracking-widest ${clase(a.tono)}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
