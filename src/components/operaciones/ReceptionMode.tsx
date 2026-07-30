"use client";

import React from "react";
import {
  TrashIcon, PlusIcon, MinusIcon, ArchiveBoxIcon,
  CheckCircleIcon, ExclamationCircleIcon, BoltIcon,
} from "@heroicons/react/24/outline";
import { useQuickInventory } from "@/hooks/useQuickInventory";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";

/**
 * Recepción de mercadería: se escanea lo que llega, se ajustan cantidades y
 * se confirma como un único apply_reception.
 */
export default function ReceptionMode() {
  const {
    items, addItem, updateQuantity, confirm, clear,
    isScanning, isSaving, error, success, totalItems,
  } = useQuickInventory();

  return (
    <div className="flex flex-col bg-[#0a0a0a] text-white relative">
      <div className="p-5 sm:p-6 bg-emerald-950/20 border-b border-white/5 relative shrink-0">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex justify-between items-start relative z-10 max-w-3xl mx-auto w-full">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-1 uppercase italic">
              Recepción
            </h1>
            <p className="text-sm text-white/40 font-medium italic">
              Suma stock de los nuevos ingresos.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-1">
              Total
            </div>
            <div className="text-4xl font-black tabular-nums">{totalItems}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-5 flex flex-col max-w-3xl mx-auto w-full">
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/50 p-4 rounded-2xl flex items-center gap-4 shrink-0">
            <div className="p-2.5 bg-emerald-500 rounded-2xl text-black shrink-0">
              <CheckCircleIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-black uppercase tracking-tight text-emerald-400">Éxito</p>
              <p className="text-sm text-emerald-100/70">{success}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-2xl flex items-center gap-4 shrink-0">
            <div className="p-2.5 bg-red-500 rounded-2xl text-white shrink-0">
              <ExclamationCircleIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-black uppercase tracking-tight text-red-400">Atención</p>
              <p className="text-sm text-red-100/70">{error}</p>
            </div>
          </div>
        )}

        <UnifiedScanner onDetected={addItem} isProcessing={isScanning} />

        <div className="flex-1 flex flex-col space-y-3">
          <div className="flex justify-between items-center px-1 shrink-0">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 italic">
              Lista de recepción
            </h2>
            {items.length > 0 && (
              <button
                onClick={clear}
                className="text-[10px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 transition-colors p-2 -mr-2"
              >
                Limpiar todo
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30 text-center p-8 border-2 border-dashed border-white/10 rounded-3xl min-h-[200px]">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                <BoltIcon className="w-8 h-8" />
              </div>
              <p className="text-base font-black uppercase tracking-widest">Lista vacía</p>
            </div>
          ) : (
            <div className="space-y-3 pb-4">
              {items.map((item) => {
                const key = item.product.barcode || item.product.id;
                const step = item.product.byWeight ? 0.5 : 1;
                return (
                  <div
                    key={key}
                    className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 sm:items-center"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 border border-white/10">
                        {item.product.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas
                          <img src={item.product.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ArchiveBoxIcon className="w-6 h-6 text-white/20" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-black text-base leading-tight truncate uppercase tracking-tight">
                          {item.product.name}
                        </h3>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-1">
                          {key} • STOCK: {item.product.stock}
                          {item.product.byWeight ? " kg" : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-2xl border border-white/5">
                        <button
                          onClick={() => updateQuantity(key, item.quantity - step)}
                          aria-label="Restar"
                          className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <MinusIcon className="w-5 h-5" />
                        </button>
                        <span className="w-16 text-center text-lg font-black tabular-nums">
                          {item.product.byWeight ? item.quantity.toFixed(2) : item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(key, item.quantity + step)}
                          aria-label="Sumar"
                          className="w-11 h-11 rounded-xl bg-white text-black flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <PlusIcon className="w-5 h-5" />
                        </button>
                      </div>
                      <button
                        onClick={() => updateQuantity(key, 0)}
                        aria-label="Quitar de la lista"
                        className="w-11 h-11 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center active:scale-90 transition-all"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pt-10 z-40 shrink-0">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={confirm}
            disabled={items.length === 0 || isSaving}
            className={`w-full h-16 rounded-3xl flex items-center justify-center gap-3 text-sm font-black uppercase tracking-widest shadow-2xl transition-all ${
              isSaving ? "bg-white/10 text-white/50" :
              items.length === 0 ? "bg-white/5 text-white/20" :
              "bg-emerald-500 text-black active:bg-emerald-600"
            }`}
          >
            {isSaving ? (
              <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <><ArchiveBoxIcon className="w-5 h-5" /> Confirmar Recepción</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
