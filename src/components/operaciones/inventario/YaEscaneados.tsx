"use client";

import React, { useMemo, useState } from "react";
import { ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export interface ProductoContado {
  barcode: string;
  name: string;
  total: number;
  marcas: number;
  porPersona: Array<{ por: string; qty: number }>;
  ultimo: string;
}

const num = (x: number) => Number(x).toLocaleString("es-CL", { maximumFractionDigits: 3 });
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Todo lo ya guardado en este inventario, de todos los teléfonos, por
 * producto. Es para mirar ANTES de contar un estante: si el producto ya
 * aparece acá, contarlo de nuevo en el mismo lugar lo duplica.
 *
 * "Corregir" lleva el producto a la lista con lo contado hasta ahora y marcado
 * para reemplazar: se ajusta al número real y se guarda.
 */
export default function YaEscaneados({
  productos,
  onCorregir,
}: {
  productos: ProductoContado[];
  onCorregir: (p: ProductoContado) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState("");

  const unidades = useMemo(() => productos.reduce((a, p) => a + p.total, 0), [productos]);
  const visibles = useMemo(() => {
    const f = sinTildes(filtro.trim());
    if (!f) return productos;
    const palabras = f.split(/\s+/);
    return productos.filter((p) => {
      const texto = sinTildes(`${p.name} ${p.barcode}`);
      return palabras.every((w) => texto.includes(w));
    });
  }, [productos, filtro]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full min-h-12 px-4 flex items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-black text-white">
          Ya escaneados ({num(productos.length)} productos · {num(unidades)} u.)
        </span>
        <ChevronDownIcon className={`w-4 h-4 text-white/40 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && (
        <div className="px-4 pb-4 space-y-2">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar en lo ya escaneado…"
              aria-label="Buscar en lo ya escaneado"
              className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm outline-none focus:border-emerald-500"
            />
          </div>

          {visibles.length === 0 && (
            <p className="text-xs text-white/30 text-center py-3">
              {productos.length === 0 ? "Todavía no se guardó nada." : "No está entre lo escaneado."}
            </p>
          )}

          <ul className="space-y-1.5 max-h-[60dvh] overflow-y-auto">
            {visibles.map((p) => (
              <li
                key={p.barcode}
                className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-white truncate">{p.name}</p>
                  <p className="text-[10px] text-white/40 truncate">
                    {p.porPersona.map((x) => `${x.por} ${num(x.qty)}`).join(" + ")}
                    {p.marcas > 1 ? ` · ${p.marcas} veces` : ""} · {hora(p.ultimo)}
                  </p>
                </div>
                <span className="text-base font-black text-emerald-400 tabular-nums shrink-0">{num(p.total)}</span>
                <button
                  type="button"
                  onClick={() => onCorregir(p)}
                  className="min-h-11 px-3 rounded-lg border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-white/60 shrink-0"
                >
                  Corregir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
