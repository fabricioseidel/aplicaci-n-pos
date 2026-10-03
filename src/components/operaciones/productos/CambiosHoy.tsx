"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeftIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import type { CambioDePrecioHoy } from "@/lib/products/edicion";

const clp = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });

/**
 * "Precios cambiados hoy": qué precio cambió, de cuánto a cuánto y quién.
 * Para que el dueño revise lo que se tocó desde el mostrador (y desde la web).
 */
export default function CambiosHoy({ onVolver }: { onVolver: () => void }) {
  const [cambios, setCambios] = useState<CambioDePrecioHoy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setError(null);
    setCambios(null);
    fetch("/api/products/cambios", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "No se pudo cargar");
        setCambios(d.cambios ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Sin conexión"));
  };
  useEffect(cargar, []);

  return (
    <div className="max-w-xl mx-auto w-full p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="flex items-center gap-1.5 h-11 px-3 -ml-3 text-xs font-black uppercase tracking-widest text-white/60">
          <ArrowLeftIcon className="w-5 h-5" /> Volver
        </button>
        <h1 className="flex-1 text-right text-sm font-black uppercase tracking-widest text-emerald-400">
          Precios cambiados hoy
        </h1>
      </div>

      {error && (
        <div className="text-center space-y-3 py-6">
          <p className="text-amber-300 font-bold">{error}</p>
          <button onClick={cargar} className="h-12 px-5 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest">
            Reintentar
          </button>
        </div>
      )}
      {!error && cambios === null && <ArrowPathIcon className="w-8 h-8 mx-auto text-white/40 animate-spin" />}
      {cambios?.length === 0 && <p className="py-10 text-center text-white/40 font-bold">Hoy no se cambió ningún precio.</p>}

      <ul className="space-y-2">
        {cambios?.map((c, i) => (
          <li key={`${c.barcode}-${c.cuando}-${i}`} className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-bold truncate">{c.nombre ?? c.barcode}</p>
              <p className="shrink-0 tabular-nums">
                {clp(c.antes)} → <strong className="text-emerald-300">{clp(c.despues)}</strong>
              </p>
            </div>
            <p className="text-xs text-white/45 mt-0.5">
              {hora(c.cuando)} · {c.campo === "offer_price" ? "Oferta" : "Precio"} · {c.quien}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
