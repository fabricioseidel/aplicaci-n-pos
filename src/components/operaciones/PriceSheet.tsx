"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowPathIcon, TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import { saveProduct } from "@/services/products";
import { useToast } from "@/contexts/ToastContext";
import type { ProductUI } from "@/types";

/** Un precio por encima de esto pide confirmar: casi siempre es un código pegado. */
export const PRECIO_ALTO_CONFIRMAR = 100000;

interface PriceSheetProps {
  product: ProductUI;
  onCancel: () => void;
  /** Precio guardado en la ficha: el producto ya se puede vender. */
  onSaved: (product: ProductUI) => void;
}

/**
 * "Este producto no tiene precio": se pide ahí mismo, se guarda en la ficha
 * y recién entonces entra al carrito. Antes un producto a $0 se regalaba
 * junto con el resto de la venta, o la venta fallaba con un error de SQL.
 */
export default function PriceSheet({ product, onCancel, onSaved }: PriceSheetProps) {
  const { showToast } = useToast();
  const [price, setPrice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = async () => {
    if (!price || price <= 0 || saving) return;
    if (
      price > PRECIO_ALTO_CONFIRMAR &&
      !window.confirm(`¿Seguro que ${product.name} cuesta $${price.toLocaleString("es-CL")}?`)
    ) {
      return;
    }
    setSaving(true);
    try {
      await saveProduct({ barcode: product.id, sale_price: price });
      onSaved({ ...product, price, offerPrice: undefined });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo guardar el precio", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#111] border border-amber-500/30 rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 text-amber-400 min-w-0">
            <TagIcon className="h-6 w-6 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-black truncate">{product.name}</h2>
              <p className="text-xs text-amber-200/80 font-bold">Este producto no tiene precio</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar" className="p-2 -m-2 text-white/40">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <label className="block text-xs font-black uppercase tracking-widest text-white/50 mb-1">
          Precio {product.byWeight ? "por kilo" : "de venta"}
        </label>
        <MoneyInput
          ref={inputRef}
          value={price}
          onChange={setPrice}
          onEnter={save}
          aria-label="Precio"
          className="w-full bg-black border-2 border-white/10 rounded-2xl px-4 h-16 text-3xl font-black text-white text-center outline-none focus:border-amber-500"
        />
        <p className="mt-2 text-[11px] text-white/40">Queda guardado en la ficha para las próximas ventas.</p>

        <div className="flex gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-14 rounded-xl bg-white/5 text-white/70 text-xs font-black uppercase tracking-widest"
          >
            No sé el precio
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!price || saving}
            className="flex-[1.4] h-14 rounded-xl bg-amber-500 text-black text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30"
          >
            {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
            Guardar y agregar
          </button>
        </div>
      </div>
    </div>
  );
}
