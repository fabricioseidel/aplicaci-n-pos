"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ArrowRightIcon, ChevronDownIcon } from "@heroicons/react/24/outline";

interface Traspaso {
  transferId: string;
  fecha: string;
  actor: string | null;
  desde: { id: string; name: string };
  hacia: { id: string; name: string };
  unidades: number;
  items: Array<{ barcode: string; name: string; qty: number }>;
}

const num = (x: number) => Number(x).toLocaleString("es-CL", { maximumFractionDigits: 3 });
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** "Mariana (POS · caja@…)" → "Mariana". */
const persona = (actor: string | null) => (actor ?? "").replace(/\s*\(POS.*\)$/, "").replace(/^POS · /, "") || "—";

/**
 * Últimos traspasos de la sede (entrantes y salientes): quién, cuándo, desde
 * dónde, hacia dónde y qué productos. `refrescar` cambia al confirmar uno.
 */
export default function HistorialTraspasos({ branchId, refrescar }: { branchId: string | null; refrescar?: unknown }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Traspaso[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ver, setVer] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const res = await fetch(`/api/transfers${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { traspasos?: Traspaso[] };
      setLista(data.traspasos ?? []);
    } catch {
      /* sin red queda lo último */
    } finally {
      setCargando(false);
    }
  }, [branchId]);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar, refrescar]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full min-h-12 px-4 flex items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-black text-white">Últimos traspasos</span>
        <span className="flex items-center gap-2 text-white/40">
          {cargando && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
          <ChevronDownIcon className={`w-4 h-4 transition-transform ${abierto ? "rotate-180" : ""}`} />
        </span>
      </button>
      {abierto && (
        <ul className="px-4 pb-4 space-y-1.5">
          {lista?.length === 0 && <li className="text-xs text-white/30 text-center py-3">Todavía no hay traspasos.</li>}
          {lista?.map((t) => (
            <li key={t.transferId} className="rounded-xl bg-black/30 border border-white/10">
              <button
                type="button"
                onClick={() => setVer(ver === t.transferId ? null : t.transferId)}
                aria-expanded={ver === t.transferId}
                className="w-full min-h-12 px-3 py-2 flex items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-black text-white truncate">
                    {t.desde.name} <ArrowRightIcon className="w-3 h-3 shrink-0" /> {t.hacia.name}
                  </span>
                  <span className="block text-[10px] text-white/40">
                    {fecha(t.fecha)} · {persona(t.actor)}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-xs font-black text-white tabular-nums">{num(t.unidades)} u.</span>
                  <span className="block text-[10px] text-white/40">
                    {t.items.length} {t.items.length === 1 ? "producto" : "productos"}
                  </span>
                </span>
              </button>
              {ver === t.transferId && (
                <ul className="px-3 pb-3 pt-2 space-y-1 border-t border-white/5">
                  {t.items.map((it) => (
                    <li key={it.barcode} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-white/70 truncate">{it.name}</span>
                      <span className="font-black text-white tabular-nums shrink-0">{num(it.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
