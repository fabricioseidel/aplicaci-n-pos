"use client";

import { useState } from "react";
import { BoltIcon, XMarkIcon, ArrowPathIcon, ScaleIcon } from "@heroicons/react/24/outline";
import { saveProduct, ProductExistsError, usarProductoExistente, DEFAULT_IMAGE } from "@/services/products";
import { useToast } from "@/contexts/ToastContext";
import MoneyInput from "@/components/ui/MoneyInput";
import { revisarPrecio } from "@/lib/products/edicion";
import Confirmar from "@/components/operaciones/productos/Confirmar";
import type { ProductUI } from "@/types";

interface QuickCreateProductModalProps {
  /** Lo que se escaneó o se buscó: si parece código va al código; si no, al nombre. */
  initialBarcode: string;
  onClose: () => void;
  onCreated: (product: ProductUI) => void;
}

/** Un texto que es código de barras y no un nombre ("pan amasado"). */
const pareceCodigo = (t: string) => /^[0-9]{4,}$|^INT-/i.test(t.trim());

/** Código interno para productos sin código de barras propio (pan, fruta…). */
const codigoInterno = () => `INT-${Date.now().toString(36).toUpperCase()}`;

/**
 * Creación mínima de un producto desde el mostrador, para vender algo que
 * todavía no existe en el catálogo: código, nombre y precio. El stock no se
 * pide (lo llevan Recepción y Conteo) y el resto se completa en Productos.
 */
export default function QuickCreateProductModal({
  initialBarcode,
  onClose,
  onCreated,
}: QuickCreateProductModalProps) {
  const { showToast } = useToast();
  const inicioEsCodigo = pareceCodigo(initialBarcode);
  const [barcode, setBarcode] = useState(inicioEsCodigo ? initialBarcode.trim() : "");
  const [name, setName] = useState(inicioEsCodigo ? "" : initialBarcode.trim());
  const [price, setPrice] = useState<number | null>(null);
  const [byWeight, setByWeight] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avisos, setAvisos] = useState<string[] | null>(null);

  const crear = async () => {
    const trimmedBarcode = barcode.trim() || codigoInterno();
    const trimmedName = name.trim();
    setAvisos(null);
    setSaving(true);
    try {
      await saveProduct(
        {
          barcode: trimmedBarcode,
          name: trimmedName,
          sale_price: price as number,
          by_weight: byWeight,
          measurement_unit: byWeight ? "kg" : null,
          is_active: true,
        },
        { crear: true }
      );

      const product: ProductUI = {
        id: trimmedBarcode,
        barcode: trimmedBarcode,
        name: trimmedName,
        price: price as number,
        image: DEFAULT_IMAGE,
        slug: trimmedName.toLowerCase().trim().replace(/\s+/g, "-"),
        description: "",
        categories: [],
        stock: 0,
        featured: false,
        byWeight,
        measurementUnit: byWeight ? "kg" : undefined,
        isActive: true,
      };

      showToast(`Producto creado: ${trimmedName}`, "success");
      onCreated(product);
    } catch (err) {
      if (err instanceof ProductExistsError) {
        const existente = await usarProductoExistente(err.existente.barcode).catch(() => null);
        if (existente) {
          showToast(
            `${err.message}${err.existente.isActive ? "" : ": lo reactivé"} y lo agregué`,
            "warning",
            5000
          );
          onCreated(existente);
          return;
        }
      }
      showToast(err instanceof Error ? err.message : "Error al crear el producto", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!name.trim()) return showToast("Falta el nombre", "error");
    if (!price || price <= 0) return showToast("Falta el precio", "error");
    const a = revisarPrecio(null, price);
    if (a.length > 0) {
      setAvisos(a);
      return;
    }
    void crear();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-emerald-400">
            <BoltIcon className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">Producto nuevo</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-2 -mr-2 text-white/50">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        <p className="text-sm text-white/45 mb-4">
          No está en el catálogo. Con nombre y precio ya se puede vender; lo demás se completa en Productos.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-white/45 mb-1">Nombre *</label>
            <input
              autoFocus={!name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black border border-white/15 rounded-xl px-3 h-12 text-white text-base outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-white/45 mb-1">
              {byWeight ? "Precio por kg *" : "Precio *"}
            </label>
            <MoneyInput
              aria-label="Precio"
              value={price}
              onChange={setPrice}
              onEnter={() => handleSubmit()}
              autoFocus={Boolean(name)}
              className="w-full bg-black border-2 border-emerald-500/50 rounded-xl px-3 h-14 text-2xl font-black text-white outline-none focus:border-emerald-400"
            />
          </div>

          <button
            type="button"
            aria-pressed={byWeight}
            onClick={() => setByWeight((v) => !v)}
            className={`w-full h-12 rounded-xl border text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
              byWeight ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "bg-white/5 border-white/10 text-white/50"
            }`}
          >
            <ScaleIcon className="w-5 h-5" /> {byWeight ? "Se vende por peso ✓" : "Se vende por peso"}
          </button>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-widest text-white/45 mb-1">
              Código de barras
            </label>
            <input
              value={barcode}
              data-scan-accept
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Sin código (pan, fruta…): se genera uno"
              className="w-full bg-black border border-white/15 rounded-xl px-3 h-12 text-white font-mono text-sm outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-14 rounded-xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-[2] h-14 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 active:bg-emerald-600"
            >
              {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
              Crear y agregar
            </button>
          </div>
        </form>
      </div>

      {avisos && (
        <Confirmar
          titulo="¿Seguro?"
          avisos={avisos}
          acciones={[
            { label: "Sí, crear", tono: "primario", onClick: () => void crear() },
            { label: "Corregir", tono: "neutro", onClick: () => setAvisos(null) },
          ]}
        />
      )}
    </div>
  );
}
