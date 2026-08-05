"use client";

import React, { useMemo, useState } from "react";
import {
  MagnifyingGlassIcon, XMarkIcon, PlusIcon, ArrowPathIcon, ScaleIcon,
  CameraIcon, ArrowLeftIcon, CheckIcon, MinusIcon, ArchiveBoxIcon,
} from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { saveProduct, DEFAULT_IMAGE } from "@/services/products";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import type { ProductUI } from "@/types";
import { searchProducts } from "@/lib/pos/search";

const PAGE_SIZE = 40;

interface FormState {
  barcode: string;
  name: string;
  category: string;
  price: string;
  offerPrice: string;
  stock: string;
  byWeight: boolean;
  measurementUnit: string;
  imageUrl: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  barcode: "",
  name: "",
  category: "",
  price: "",
  offerPrice: "",
  stock: "0",
  byWeight: false,
  measurementUnit: "kg",
  imageUrl: "",
  isActive: true,
};

function toForm(p: ProductUI): FormState {
  return {
    barcode: p.barcode || p.id,
    name: p.name,
    category: p.categories.join(", "),
    price: String(p.price ?? ""),
    offerPrice: p.offerPrice ? String(p.offerPrice) : "",
    stock: String(p.stock ?? 0),
    byWeight: Boolean(p.byWeight),
    measurementUnit: p.measurementUnit || "kg",
    imageUrl: p.image && p.image !== DEFAULT_IMAGE ? p.image : "",
    isActive: p.isActive !== false,
  };
}

/**
 * Alta y edición de productos desde el mostrador.
 *
 * Es la pantalla nueva que OlivoWeb no tiene: allá los productos sólo se
 * crean con el modal rápido (código, nombre, precio) y todo lo demás se
 * edita fuera del módulo de operaciones.
 */
export default function ProductosMode() {
  const { showToast } = useToast();
  const { products, loading, fromCache, refresh, upsertLocal } = useProductCatalog();

  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState<FormState | null>(null);
  /** true cuando se está creando: el código de barras aún se puede escribir. */
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const filtered = useMemo(() => searchProducts(products, query), [query, products]);

  const startNew = () => {
    setEditing({ ...EMPTY_FORM, barcode: query.trim() });
    setIsNew(true);
  };

  const startEdit = (p: ProductUI) => {
    setEditing(toForm(p));
    setIsNew(false);
  };

  const patch = (p: Partial<FormState>) =>
    setEditing((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async () => {
    if (!editing || saving) return;

    const barcode = editing.barcode.trim();
    const name = editing.name.trim();
    const price = Number(editing.price);

    if (!barcode) return showToast("El código de barras es obligatorio", "error");
    if (!name) return showToast("El nombre es obligatorio", "error");
    if (!Number.isFinite(price) || price <= 0) return showToast("Precio inválido", "error");

    const offerPrice = editing.offerPrice.trim() === "" ? null : Number(editing.offerPrice);
    if (offerPrice !== null && (!Number.isFinite(offerPrice) || offerPrice <= 0)) {
      return showToast("Precio de oferta inválido", "error");
    }

    const stock = Number(editing.stock);
    if (!Number.isFinite(stock) || stock < 0) return showToast("Stock inválido", "error");

    setSaving(true);
    try {
      // Guardar producto NO se encola offline: el catálogo es dato compartido
      // y resolver conflictos de dos ediciones diferidas no vale la pena. Sin
      // red, el guardado falla y avisa.
      await saveProduct({
        barcode,
        name,
        category: editing.category.trim() || null,
        sale_price: price,
        offer_price: offerPrice,
        stock,
        by_weight: editing.byWeight,
        measurement_unit: editing.byWeight ? editing.measurementUnit || "kg" : null,
        image_url: editing.imageUrl.trim() || null,
        is_active: editing.isActive,
      });

      upsertLocal({
        id: barcode,
        barcode,
        name,
        price: Math.round(price),
        offerPrice: offerPrice ? Math.round(offerPrice) : undefined,
        image: editing.imageUrl.trim() || DEFAULT_IMAGE,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        description: "",
        categories: editing.category
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        stock,
        byWeight: editing.byWeight,
        measurementUnit: editing.byWeight ? editing.measurementUnit || "kg" : undefined,
        isActive: editing.isActive,
      });

      showToast(isNew ? `Producto creado: ${name}` : `Producto actualizado: ${name}`, "success");
      setEditing(null);
      void refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Formulario ────────────────────────────────────────────────────────
  if (editing) {
    const stockStep = editing.byWeight ? 0.1 : 1;
    return (
      <div className="max-w-xl mx-auto w-full p-4 space-y-4 pb-28">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(null)}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"
          >
            <ArrowLeftIcon className="w-4 h-4" /> Volver
          </button>
          <span className="flex-1 text-center text-[10px] font-black uppercase tracking-widest text-emerald-400">
            {isNew ? "Nuevo producto" : "Editar producto"}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Código de barras *
            </label>
            <div className="flex gap-2">
              <input
                value={editing.barcode}
                onChange={(e) => patch({ barcode: e.target.value })}
                disabled={!isNew}
                data-laser-passthrough
                className="flex-1 bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              {isNew && (
                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  aria-label="Escanear código"
                  className="px-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400"
                >
                  <CameraIcon className="w-5 h-5" />
                </button>
              )}
            </div>
            {!isNew && (
              // Renombrar el barcode crearía una fila nueva en vez de renombrar
              // la existente, porque el upsert va por onConflict:'barcode'.
              <p className="mt-1 text-[10px] text-white/30">
                El código no se puede cambiar: identifica al producto en toda la base.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Nombre *
            </label>
            <input
              value={editing.name}
              onChange={(e) => patch({ name: e.target.value })}
              data-laser-passthrough
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Categoría
            </label>
            <input
              value={editing.category}
              onChange={(e) => patch({ category: e.target.value })}
              placeholder="Abarrotes, Bebidas"
              data-laser-passthrough
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
            />
            <p className="mt-1 text-[10px] text-white/30">Separa varias con comas.</p>
          </div>

          {/* Venta por peso */}
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={editing.byWeight}
              onChange={(e) =>
                patch({
                  byWeight: e.target.checked,
                  measurementUnit: e.target.checked ? "kg" : editing.measurementUnit,
                })
              }
              className="h-4 w-4 accent-emerald-500"
            />
            <ScaleIcon className="w-4 h-4 text-emerald-400" />
            <span className="text-[11px] font-black uppercase tracking-widest text-white/70">
              Se vende por peso
            </span>
          </label>

          {editing.byWeight && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-3">
              <p className="text-[11px] text-emerald-200 leading-relaxed">
                El precio se interpreta <strong>por {editing.measurementUnit || "kg"}</strong>. Al
                vender, el POS pedirá el peso y calculará el subtotal.
              </p>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                  Unidad de medida
                </label>
                <select
                  value={editing.measurementUnit}
                  onChange={(e) => patch({ measurementUnit: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                {editing.byWeight ? `Precio / ${editing.measurementUnit || "kg"} *` : "Precio *"}
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={editing.price}
                onChange={(e) => patch({ price: e.target.value })}
                data-laser-passthrough
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                Precio oferta
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="—"
                value={editing.offerPrice}
                onChange={(e) => patch({ offerPrice: e.target.value })}
                data-laser-passthrough
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              {editing.byWeight ? `Stock (${editing.measurementUnit || "kg"} en existencia)` : "Stock"}
            </label>
            {editing.byWeight ? (
              /* Por peso el stock es decimal: el stepper de enteros no sirve
                 para registrar 3.4 kg de queso. */
              <input
                type="number"
                inputMode="decimal"
                step={0.001}
                min={0}
                value={editing.stock}
                onChange={(e) => patch({ stock: e.target.value })}
                data-laser-passthrough
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-base font-black outline-none focus:border-emerald-500"
              />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => patch({ stock: String(Math.max(0, Number(editing.stock) - stockStep)) })}
                  aria-label="Restar stock"
                  className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:scale-90"
                >
                  <MinusIcon className="w-5 h-5" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  value={editing.stock}
                  onChange={(e) => patch({ stock: e.target.value })}
                  data-laser-passthrough
                  className="flex-1 bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-base font-black text-center outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => patch({ stock: String(Number(editing.stock) + stockStep) })}
                  aria-label="Sumar stock"
                  className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center active:scale-90"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              URL de la imagen
            </label>
            <input
              value={editing.imageUrl}
              onChange={(e) => patch({ imageUrl: e.target.value })}
              placeholder="https://…"
              data-laser-passthrough
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
            />
            <p className="mt-1 text-[10px] text-white/30">Opcional. Puede quedar en blanco.</p>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={editing.isActive}
              onChange={(e) => patch({ isActive: e.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
            <span className="text-[11px] font-black uppercase tracking-widest text-white/70">
              Producto activo
            </span>
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="flex-1 h-13 min-h-[3.25rem] rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-[2] h-13 min-h-[3.25rem] rounded-2xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 active:bg-emerald-600 transition-colors"
          >
            {saving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
            Guardar
          </button>
        </div>

        {scanning && (
          <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-md relative">
              <button
                onClick={() => setScanning(false)}
                aria-label="Cerrar escáner"
                className="absolute -top-12 right-0 p-2 bg-white/10 rounded-xl text-white hover:bg-red-500 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
              <UnifiedScanner
                onDetected={(code) => {
                  patch({ barcode: code });
                  setScanning(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Listado ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="p-3 flex gap-2 items-center border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-20">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            type="text"
            placeholder="Buscar por nombre o código…"
            data-laser-passthrough
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE_SIZE);
            }}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-9 text-white text-sm outline-none focus:border-emerald-500"
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
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 px-3 h-11 bg-emerald-500 text-black rounded-xl text-[10px] font-black uppercase tracking-widest active:bg-emerald-600"
        >
          <PlusIcon className="w-4 h-4" /> Nuevo
        </button>
      </div>

      {fromCache && (
        <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
          Catálogo sin conexión — no se puede guardar hasta recuperar la red
        </p>
      )}

      <div className="p-3 space-y-2">
        {loading && (
          <p className="py-10 text-center text-white/30 text-xs font-black uppercase tracking-widest animate-pulse">
            Cargando…
          </p>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center text-white/30">
            <ArchiveBoxIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-xs font-black uppercase tracking-widest">Sin resultados</p>
          </div>
        )}

        {filtered.slice(0, visible).map((p) => (
          <button
            key={p.id}
            onClick={() => startEdit(p)}
            className="w-full flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl p-3 text-left transition-colors"
          >
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas */}
              <img src={p.image} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{p.name}</p>
              <p className="text-[10px] font-mono text-white/40 truncate">
                {p.id} · stock {p.stock}
                {p.byWeight ? " kg" : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-black text-emerald-400">
                $ {(p.offerPrice || p.price).toLocaleString()}
              </p>
              {p.byWeight && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase text-emerald-300/70">
                  <ScaleIcon className="w-3 h-3" /> por kg
                </span>
              )}
            </div>
          </button>
        ))}

        {!loading && visible < filtered.length && (
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-emerald-500"
          >
            + {filtered.length - visible} más
          </button>
        )}
      </div>
    </div>
  );
}
