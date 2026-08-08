"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  TrashIcon, PlusIcon, MinusIcon, ArchiveBoxIcon,
  CheckCircleIcon, ExclamationCircleIcon, BoltIcon,
  MagnifyingGlassIcon, XMarkIcon, PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { useQuickInventory } from "@/hooks/useQuickInventory";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { useBranch } from "@/contexts/BranchContext";
import { searchProducts } from "@/lib/pos/search";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import QuickCreateReceptionModal from "@/components/operaciones/QuickCreateReceptionModal";
import type { ProductUI } from "@/types";

const SEARCH_RESULTS_LIMIT = 8;

/**
 * Suma stock a un producto: en la casa matriz es Recepción de un proveedor
 * externo (apply_reception, entra stock nuevo); en una sucursal es Traspaso
 * desde la matriz (apply_transfer, resta allá y suma acá — la matriz sigue
 * siendo la única que compra afuera). El escaneo/búsqueda y la lista son
 * iguales en los dos modos, sólo cambia contra qué RPC confirma.
 *
 * Lo que no existe en el catálogo se puede crear al vuelo: con el código del
 * escaneo, o desde cero cuando la búsqueda por nombre no encuentra nada.
 */
export default function ReceptionMode() {
  const { currentBranch } = useBranch();
  const isTransfer = Boolean(currentBranch && !currentBranch.is_default);

  const {
    items, addItem, addProduct, updateQuantity, confirm, clear,
    isScanning, isSaving, error, success, totalItems,
  } = useQuickInventory(isTransfer ? "transfer" : "reception");
  const { products: allProducts, upsertLocal } = useProductCatalog();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<{ barcode: string; name: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => (query.trim() ? searchProducts(allProducts, query).slice(0, SEARCH_RESULTS_LIMIT) : []),
    [query, allProducts]
  );

  const addByName = (product: ProductUI) => {
    addProduct(product, 1);
    setQuery("");
    searchRef.current?.focus();
  };

  // El escáner ya resuelve contra el catálogo; si no encuentra nada, en vez
  // de sólo mostrar el error se ofrece crear el producto con ese código.
  const handleScan = useCallback(
    async (barcode: string) => {
      const found = await addItem(barcode);
      if (!found) setCreating({ barcode, name: "" });
    },
    [addItem]
  );

  const closeCreating = () => setCreating(null);

  const handleCreated = (product: ProductUI, quantity: number) => {
    upsertLocal(product);
    addProduct(product, quantity);
    closeCreating();
    setQuery("");
  };

  const handleMerge = (product: ProductUI, quantity: number) => {
    addProduct(product, quantity);
    closeCreating();
    setQuery("");
  };

  return (
    <div className="flex flex-col bg-[#0a0a0a] text-white relative">
      <div className="p-5 sm:p-6 bg-emerald-950/20 border-b border-white/5 relative shrink-0">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />
        <div className="flex justify-between items-start relative z-10 max-w-3xl mx-auto w-full">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-1 uppercase italic">
              {isTransfer ? "Traspaso" : "Recepción"}
            </h1>
            <p className="text-sm text-white/40 font-medium italic">
              {isTransfer
                ? `Resta stock de la matriz y suma en ${currentBranch?.name ?? "esta sucursal"}.`
                : "Suma stock de los nuevos ingresos."}
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

        {error && !creating && (
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

        <div className="space-y-2 shrink-0">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar producto por nombre…"
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-9 text-white text-sm outline-none focus:border-emerald-500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>

          {query.trim() && (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => addByName(p)}
                    className="w-full flex items-center gap-3 text-left bg-white/5 hover:bg-white/10 rounded-xl p-3 border border-white/10 transition-colors"
                  >
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-white/10">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas
                        <img src={p.image} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ArchiveBoxIcon className="w-5 h-5 text-white/20" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-white/40 font-mono mt-0.5">
                        {p.barcode || p.id} · stock {p.stock}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="py-3 text-center">
                  <p className="text-xs text-white/30 mb-2">Sin coincidencias.</p>
                  <button
                    onClick={() => setCreating({ barcode: "", name: query.trim() })}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-[10px] font-black uppercase tracking-widest"
                  >
                    <PlusCircleIcon className="h-4 w-4" /> Crear &quot;{query.trim()}&quot;
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        <UnifiedScanner onDetected={handleScan} isProcessing={isScanning} />

        <div className="flex-1 flex flex-col space-y-3">
          <div className="flex justify-between items-center px-1 shrink-0">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 italic">
              {isTransfer ? "Lista de traspaso" : "Lista de recepción"}
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
              <><ArchiveBoxIcon className="w-5 h-5" /> {isTransfer ? "Confirmar Traspaso" : "Confirmar Recepción"}</>
            )}
          </button>
        </div>
      </div>

      {creating && (
        <QuickCreateReceptionModal
          initialBarcode={creating.barcode}
          initialName={creating.name}
          products={allProducts}
          onClose={closeCreating}
          onCreated={handleCreated}
          onMerge={handleMerge}
        />
      )}
    </div>
  );
}
