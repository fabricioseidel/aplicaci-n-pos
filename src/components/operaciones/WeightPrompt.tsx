"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScaleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ProductUI } from "@/types";
import { unitPriceOf } from "@/contexts/POSContext";

interface WeightPromptProps {
  product: ProductUI;
  /** Peso inicial en kg, al editar una línea que ya está en el carrito. */
  initialKg?: number;
  onCancel: () => void;
  onConfirm: (kg: number) => void;
}

/** Pesos frecuentes en el mostrador, en gramos. */
const QUICK_GRAMS = [100, 250, 500, 750, 1000];

/**
 * Pide el peso al agregar un producto que se vende por kilo.
 *
 * El precio del producto es POR KILO, así que el subtotal es
 * `precio_kg × kg` redondeado a peso — el mismo redondeo por línea que usa
 * el carrito, para que lo mostrado y lo cobrado coincidan exactamente.
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
  const kg = useMemo(() => {
    const g = Number(grams);
    return Number.isFinite(g) && g > 0 ? g / 1000 : 0;
  }, [grams]);
  const subtotal = useMemo(() => Math.round(pricePerKg * kg), [pricePerKg, kg]);

  const confirm = () => {
    if (kg <= 0) return;
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
              <p className="text-[10px] text-white/40 font-bold">
                $ {pricePerKg.toLocaleString()} por kg
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
            Peso en gramos
          </label>
          {/* Se pide en gramos y no en kilos a propósito: la balanza del local
              muestra gramos y teclear "350" es menos propenso a error que
              "0.350" con el teclado numérico del teléfono. */}
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            placeholder="350"
            data-laser-passthrough
            className="w-full bg-black border-2 border-white/10 rounded-2xl px-4 py-3 text-2xl font-black text-white text-center outline-none focus:border-emerald-500"
          />

          <div className="grid grid-cols-5 gap-1.5 mt-3">
            {QUICK_GRAMS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrams(String(g))}
                className={`py-2 rounded-xl border text-[10px] font-black transition-all ${
                  Number(grams) === g
                    ? "bg-emerald-500 border-emerald-400 text-black"
                    : "bg-white/5 border-white/10 text-white/60"
                }`}
              >
                {g >= 1000 ? `${g / 1000}kg` : `${g}g`}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-between items-center rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
              {kg > 0 ? `${kg.toFixed(3)} kg` : "Subtotal"}
            </span>
            <span className="text-2xl font-black text-emerald-400">
              $ {subtotal.toLocaleString()}
            </span>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-12 rounded-xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={kg <= 0}
              className="flex-[2] h-12 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-30 active:bg-emerald-600 transition-colors"
            >
              Agregar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
