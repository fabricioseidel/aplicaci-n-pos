"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ChevronDownIcon } from "@heroicons/react/24/outline";

interface Lote {
  lote: string;
  por: string;
  guardado: string;
  productos: number;
  unidades: number;
  items: Array<{ barcode: string; name: string; qty: number; expiry: string | null; price: number | null }>;
}

interface Historial {
  totalLotes: number;
  lotes: Lote[];
  porPersona: Array<{ por: string; lotes: number; productos: number; unidades: number }>;
  anuladas: number;
}

const num = (x: number) =>
  Number(x).toLocaleString("es-CL", { maximumFractionDigits: 3 });

const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const fecha = (ymd: string) => ymd.split("-").reverse().join("-");

/**
 * Historial de un inventario: cada lote guardado es una subida con nombre y
 * hora, y arriba el total de cada persona. Es lo que responde "¿de dónde
 * salieron estas 10 Coca-Cola?": 3 de Mariana, 5 de Alfredo, 2 de Fabricio.
 *
 * `refrescar` cambia cada vez que la pantalla sabe que hay algo nuevo (un lote
 * propio guardado o el sondeo que trae lo de los otros teléfonos).
 */
export default function HistorialInventario({
  sessionId,
  refrescar = 0,
  abiertoAlInicio = false,
}: {
  sessionId: string;
  refrescar?: number;
  abiertoAlInicio?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoAlInicio);
  const [datos, setDatos] = useState<Historial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [loteAbierto, setLoteAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(
        `/api/inventario/conteo/historial?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo leer el historial");
      setDatos(data as Historial);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el historial");
    } finally {
      setCargando(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar, refrescar]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full min-h-12 px-4 flex items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-black text-white">
          Historial de lotes{datos ? ` (${datos.totalLotes})` : ""}
        </span>
        <span className="flex items-center gap-2 text-white/40">
          {cargando && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
          <ChevronDownIcon className={`w-4 h-4 transition-transform ${abierto ? "rotate-180" : ""}`} />
        </span>
      </button>

      {abierto && (
        <div className="px-4 pb-4 space-y-3">
          {error && <p className="text-xs text-amber-300">{error}</p>}

          {datos && datos.porPersona.length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {datos.porPersona.map((p) => (
                <li key={p.por} className="rounded-xl bg-black/30 border border-white/10 p-3">
                  <p className="text-xs font-black text-white truncate">{p.por}</p>
                  <p className="text-lg font-black text-emerald-400 tabular-nums leading-tight">
                    {num(p.unidades)}
                  </p>
                  <p className="text-[10px] text-white/40">
                    {p.productos} {p.productos === 1 ? "producto" : "productos"} · {p.lotes}{" "}
                    {p.lotes === 1 ? "lote" : "lotes"}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {datos && datos.lotes.length === 0 && !error && (
            <p className="text-xs text-white/30 text-center py-3">Todavía no se guardó ningún lote.</p>
          )}

          <ul className="space-y-1.5">
            {datos?.lotes.map((l) => {
              const ver = loteAbierto === l.lote;
              return (
                <li key={l.lote} className="rounded-xl bg-black/30 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setLoteAbierto(ver ? null : l.lote)}
                    aria-expanded={ver}
                    className="w-full min-h-12 px-3 py-2 flex items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-white truncate">{l.por}</span>
                      <span className="block text-[10px] text-white/40">{hora(l.guardado)}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-xs font-black text-white tabular-nums">
                        {num(l.unidades)} u.
                      </span>
                      <span className="block text-[10px] text-white/40">
                        {l.productos} {l.productos === 1 ? "producto" : "productos"}
                      </span>
                    </span>
                  </button>
                  {ver && (
                    <ul className="px-3 pb-3 space-y-1 border-t border-white/5 pt-2">
                      {l.items.map((it, i) => (
                        <li key={`${it.barcode}-${i}`} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="min-w-0 text-white/70 truncate">
                            {it.name}
                            {it.expiry && <span className="text-amber-300/80"> · vence {fecha(it.expiry)}</span>}
                          </span>
                          <span className="font-black text-white tabular-nums shrink-0">{num(it.qty)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {datos && datos.anuladas > 0 && (
            <p className="text-[10px] text-white/40 leading-relaxed">
              {datos.anuladas} {datos.anuladas === 1 ? "marca corregida" : "marcas corregidas"}: lo que
              se reemplazó al corregir un producto queda guardado aparte.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
