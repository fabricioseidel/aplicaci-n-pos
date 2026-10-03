"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScaleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ProductUI } from "@/types";
import { unitPriceOf } from "@/contexts/POSContext";
import { parseGramos } from "@/lib/num";

interface WeightPromptProps {
  product: ProductUI;
  /** Peso inicial en kg, al editar una línea que ya está en el carrito. */
  initialKg?: number;
  onCancel: () => void;
  onConfirm: (kg: number) => void;
}

/** Pesos frecuentes en el mostrador, en gramos. */
const QUICK_GRAMS = [100, 250, 500, 750, 1000];

/** Más que esto pide confirmar: en un minimarket casi siempre es un error de tipeo. */
const KG_CONFIRMAR = 20;

/**
 * Pide el peso al agregar un producto que se vende por kilo.
 *
 * El precio del producto es POR KILO, así que el subtotal es
 * `precio_kg × kg` redondeado a peso — el mismo redondeo por línea que usa
 * el carrito, para que lo mostrado y lo cobrado coincidan exactamente.
 *
 * El campo es de texto (no `type="number"`): "0,35" se entiende como 350 g y
 * "1.200" como 1.200 g, en vez de 0 o 1,2 g. Una lectura del láser con este
 * cuadro abierto no se escribe acá (ver `ScanProvider`).
 */
export default function WeightPrompt({
  product,
  initialKg,
  onCancel,
  onConfirm,
}: WeightPromptProps) {
  const [grams, setGrams] = useState<string>(initialKg ? String(Math.round(initialKg * 1000)) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const pricePerKg = unitPriceOf(product);
  const parsedGrams = useMemo(() => parseGramos(grams), [grams]);
  const kg = parsedGrams && parsedGrams > 0 ? parsedGrams / 1000 : 0;
  const subtotal = useMemo(() => Math.round(pricePerKg * kg), [pricePerKg, kg]);
  /** "0,35" → se muestra que se entendió 350 g. */
  const interpretado = parsedGrams !== null && String(parsedGrams) !== grams.trim();

  const confirm = () => {
    if (kg <= 0) return;
    if (kg > KG_CONFIRMAR && !window.confirm(`¿Seguro que son ${kg.toLocaleString("es-CL")} kg?`)) return;
    onConfirm(kg);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-400 min-w-0">
            <ScaleIcon className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-widest truncate">
                {product.name}
              </h2>
              <p className="text-[11px] text-white/50 font-bold">
                $ {pricePerKg.toLocaleString("es-CL")} por kg
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar" className="p-2 -m-2 text-white/40 hover:text-white">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <label className="block text-[11px] font-black uppercase tracking-widest text-white/50 mb-1">
            Peso en gramos
          </label>
          {/* Se pide en gramos y no en kilos a propósito: la balanza del local
              muestra gramos y teclear "350" es menos propenso a error que
              "0.350" con el teclado numérico del teléfono. */}
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            placeholder="350"
            aria-label="Peso en gramos"
            className="w-full bg-black border-2 border-white/10 rounded-2xl px-4 py-3 text-2xl font-black text-white text-center outline-none focus:border-emerald-500"
          />
          {interpretado && parsedGrams !== null && (
            <p className="mt-1 text-center text-xs font-bold text-emerald-300">
              = {parsedGrams.toLocaleString("es-CL")} g
            </p>
          )}

          <div className="grid grid-cols-5 gap-1.5 mt-3">
            {QUICK_GRAMS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrams(String(g))}
                className={`h-11 rounded-xl border text-xs font-black transition-all ${
                  parsedGrams === g
                    ? "bg-emerald-500 border-emerald-400 text-black"
                    : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {g >= 1000 ? `${g / 1000}kg` : `${g}g`}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-between items-center rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <span className="text-[11px] font-black uppercase tracking-widest text-white/50">
              {kg > 0 ? `${kg.toFixed(3)} kg` : "Subtotal"}
            </span>
            <span className="text-2xl font-black text-emerald-400">
              $ {subtotal.toLocaleString("es-CL")}
            </span>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-14 rounded-xl bg-white/5 text-white/70 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={kg <= 0}
              className="flex-[2] h-14 rounded-xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest disabled:opacity-30 active:bg-emerald-600 transition-colors"
            >
              Agregar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
