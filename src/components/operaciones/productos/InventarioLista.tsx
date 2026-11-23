"use client";

import React, { useMemo, useState } from "react";
import { ArrowLeftIcon, MagnifyingGlassIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import AjustarStock from "./AjustarStock";
import type { ProductUI } from "@/types";

const num = (x: number) => Number(x).toLocaleString("es-CL", { maximumFractionDigits: 3 });
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Inventario de la sede, a la vista: solo el nombre del producto y su stock.
 * Para mirar qué hay sin entrar a la ficha de cada uno. El stock es el de la
 * sede elegida arriba (el catálogo ya viene por sede).
 *
 * Tocar una fila abre "Ajustar stock" para corregir un error: se escribe
 * cuántas hay ahora y el motivo. El ajuste queda registrado como movimiento
 * (no se pisa el número en silencio) y solo se aplica si el stock sigue siendo
 * el que se veía, así no revierte una venta hecha en el medio.
 */
export default function InventarioLista({
  productos,
  sede,
  branchId = null,
  onAjustado,
  onVolver,
}: {
  productos: ProductUI[];
  sede: string;
  branchId?: string | null;
  /** Se ajustó el stock de un producto: `stock` es el valor que quedó. */
  onAjustado?: (producto: ProductUI, stock: number) => void;
  onVolver: () => void;
}) {
  const [ajustando, setAjustando] = useState<ProductUI | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [soloConStock, setSoloConStock] = useState(true);

  const filas = useMemo(() => {
    const palabras = sinTildes(query.trim()).split(/\s+/).filter(Boolean);
    return productos
      .filter((p) => p.isActive !== false)
      .filter((p) => !soloConStock || Number(p.stock ?? 0) > 0)
      .filter((p) => {
        if (palabras.length === 0) return true;
        const nombre = sinTildes(p.name);
        return palabras.every((w) => nombre.includes(w));
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [productos, query, soloConStock]);

  const unidades = filas.reduce((a, p) => a + Math.max(0, Number(p.stock ?? 0)), 0);

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="p-3 space-y-2 border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onVolver}
            className="flex items-center gap-1.5 h-11 px-3 -ml-3 text-xs font-black uppercase tracking-widest text-white/60"
          >
            <ArrowLeftIcon className="w-5 h-5" /> Volver
          </button>
          <h1 className="flex-1 text-right text-sm font-black uppercase tracking-widest text-emerald-400">
            Inventario · {sede}
          </h1>
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            className="w-full bg-white/5 border border-white/10 rounded-xl h-12 pl-10 pr-10 text-white text-base outline-none focus:border-emerald-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-white/50 p-2"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 min-h-11 text-xs font-black uppercase tracking-widest text-white/60">
            <input
              type="checkbox"
              checked={soloConStock}
              onChange={(e) => setSoloConStock(e.target.checked)}
              className="w-5 h-5 accent-emerald-500"
            />
            Solo con stock
          </label>
          <p className="text-xs text-white/50 tabular-nums">
            {num(filas.length)} {filas.length === 1 ? "producto" : "productos"} · {num(unidades)} u.
          </p>
        </div>
      </div>

      {aviso && (
        <p
          role="status"
          className="mx-3 mt-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-2 text-sm font-black text-emerald-100"
        >
          {aviso}
        </p>
      )}

      <ul className="p-3 space-y-1.5">
        {filas.length === 0 && (
          <li className="py-12 text-center text-xs font-black uppercase tracking-widest text-white/30">
            Sin resultados
          </li>
        )}
        {filas.map((p) => {
          const stock = Number(p.stock ?? 0);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setAjustando(p)}
                aria-label={`Corregir stock de ${p.name}`}
                className="w-full flex items-center justify-between gap-3 bg-white/5 active:bg-white/10 border border-white/5 rounded-xl px-3 min-h-12 py-2 text-left"
              >
                <span className="min-w-0 truncate text-sm font-bold text-white">{p.name}</span>
                <span className="shrink-0 flex items-center gap-2">
                  <span
                    className={`text-base font-black tabular-nums ${
                      stock <= 0 ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {num(stock)}
                    {p.byWeight ? " kg" : ""}
                  </span>
                  <PencilSquareIcon className="w-4 h-4 text-white/30" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {ajustando && (
        <AjustarStock
          barcode={ajustando.barcode || ajustando.id}
          nombre={ajustando.name}
          porPeso={Boolean(ajustando.byWeight)}
          stockVisto={Number(ajustando.stock ?? 0)}
          branchId={branchId}
          onCancel={() => setAjustando(null)}
          onDone={(stock) => {
            onAjustado?.(ajustando, stock);
            setAviso(`✓ ${ajustando.name}: ahora ${num(stock)}${ajustando.byWeight ? " kg" : ""}`);
            setAjustando(null);
          }}
        />
      )}
    </div>
  );
}
