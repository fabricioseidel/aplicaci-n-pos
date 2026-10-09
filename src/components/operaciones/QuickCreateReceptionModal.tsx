"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoltIcon, XMarkIcon, ArrowPathIcon, ArrowsRightLeftIcon } from "@heroicons/react/24/outline";
import { saveProduct, DEFAULT_IMAGE, ProductExistsError, usarProductoExistente } from "@/services/products";
import { useToast } from "@/contexts/ToastContext";
import { searchProducts } from "@/lib/pos/search";
import MoneyInput from "@/components/ui/MoneyInput";
import Confirmar from "@/components/operaciones/productos/Confirmar";
import { revisarPrecio } from "@/lib/products/edicion";
import { parseCantidad } from "@/lib/num";
import type { ProductUI } from "@/types";

interface QuickCreateReceptionModalProps {
  /** Código ya conocido (vino del escáner); queda editable por si se leyó mal. */
  initialBarcode?: string;
  /** Nombre ya tipeado en el buscador, si se abrió desde ahí. */
  initialName?: string;
  /** Catálogo cargado, para sugerir fusión mientras se tipea el nombre. */
  products: ProductUI[];
  onClose: () => void;
  /** Producto recién creado + cantidad a sumar en esta recepción. */
  onCreated: (product: ProductUI, quantity: number) => void;
  /** El usuario eligió un producto existente en vez de crear uno nuevo. */
  onMerge: (product: ProductUI, quantity: number) => void;
}

/** Código interno para productos sin código de barras propio (sueltos, fraccionados, etc). */
function generateInternalCode(): string {
  return `INT-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Alta rápida de producto desde Recepción: sólo pide lo mínimo para sumarlo
 * al stock ya (nombre y cantidad); precio y categoría se completan después
 * en la pestaña Productos. Si el nombre tipeado se parece a algo que ya
 * existe, sugiere sumarle stock a ese en vez de crear un duplicado.
 */
export default function QuickCreateReceptionModal({
  initialBarcode = "",
  initialName = "",
  products,
  onClose,
  onCreated,
  onMerge,
}: QuickCreateReceptionModalProps) {
  const { showToast } = useToast();
  const [barcode, setBarcode] = useState(initialBarcode);
  const [name, setName] = useState(initialName);
  const [cantidadTexto, setCantidadTexto] = useState("1");
  const quantity = parseCantidad(cantidadTexto) ?? 0;
  /** Precio de venta: sin él el producto entra a $0 y no se puede vender. */
  const [price, setPrice] = useState<number | null>(null);
  const [avisos, setAvisos] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialName) nameRef.current?.focus();
  }, [initialName]);

  // Al tipear el nombre puede resultar que el producto ya existe con otro
  // código: mejor sumarle stock a ese que crear un duplicado.
  const suggestions = useMemo(() => {
    if (dismissedSuggestions) return [];
    const trimmed = name.trim();
    if (trimmed.length < 3) return [];
    return searchProducts(products, trimmed).slice(0, 3);
  }, [name, products, dismissedSuggestions]);

  const handleMerge = (product: ProductUI) => {
    if (!quantity || quantity <= 0) {
      showToast("Indica la cantidad", "error");
      return;
    }
    onMerge(product, quantity);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      showToast("El nombre es obligatorio", "error");
      return;
    }
    if (!quantity || quantity <= 0) {
      showToast("Indica la cantidad", "error");
      return;
    }
    const a = price
      ? revisarPrecio(null, price)
      : ["Sin precio no se puede vender: en Venta te lo van a pedir. Queda en el filtro «Sin precio»."];
    if (a.length > 0) {
      setAvisos(a);
      return;
    }
    void crear();
  };

  const crear = async () => {
    setAvisos(null);
    const trimmedName = name.trim();
    const trimmedBarcode = barcode.trim() || generateInternalCode();

    setSaving(true);
    try {
      // Sin stock: el alta entra con 0 y la cantidad la suma la recepción
      // misma. Mandar `stock: 0` sobre un código existente lo vaciaba.
      await saveProduct(
        { barcode: trimmedBarcode, name: trimmedName, is_active: true, ...(price ? { sale_price: price } : {}) },
        { crear: true }
      );

      const product: ProductUI = {
        id: trimmedBarcode,
        barcode: trimmedBarcode,
        name: trimmedName,
        price: price ?? 0,
        image: DEFAULT_IMAGE,
        slug: trimmedName.toLowerCase().trim().replace(/\s+/g, "-"),
        description: "",
        categories: [],
        stock: 0,
        featured: false,
        byWeight: false,
        isActive: true,
      };

      showToast(`Producto creado: ${trimmedName}`, "success");
      onCreated(product, quantity);
    } catch (err) {
      if (err instanceof ProductExistsError) {
        const existente = await usarProductoExistente(err.existente.barcode).catch(() => null);
        if (existente) {
          showToast(
            `${err.message}${err.existente.isActive ? "" : ": lo reactivé"} y le sumé la cantidad`,
            "warning",
            5000
          );
          onMerge(existente, quantity);
          return;
        }
      }
      showToast(err instanceof Error ? err.message : "Error al crear el producto", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-emerald-400">
            <BoltIcon className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">Producto nuevo</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-2 -mr-2 text-white/50 hover:text-white">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-white/40 mb-4">
          No está en el catálogo. Ponle nombre, cantidad y precio de venta: sin precio no se puede vender.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Nombre *
            </label>
            <input
              ref={nameRef}
              autoFocus={!!initialName}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDismissedSuggestions(false);
              }}
              required
              className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500"
            />
          </div>

          {suggestions.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                ¿Es alguno de estos?
              </p>
              <ul className="space-y-1.5">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleMerge(p)}
                      className="w-full flex items-center justify-between gap-2 text-left bg-black/30 hover:bg-black/50 rounded-lg px-3 py-2 border border-amber-500/20 transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-white truncate">{p.name}</span>
                        <span className="block text-[9px] text-white/40 font-mono">
                          {p.barcode || p.id} · stock {p.stock}
                        </span>
                      </span>
                      <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-300">
                        Sumar acá
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setDismissedSuggestions(true)}
                className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70"
              >
                No, es otro producto — crear nuevo
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                Código de barras
              </label>
              <input
                value={barcode}
                data-scan-accept
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Opcional"
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
                Cantidad *
              </label>
              <input
                inputMode="decimal"
                data-scan-guard
                value={cantidadTexto}
                onChange={(e) => setCantidadTexto(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-black border border-white/10 rounded-xl px-3 h-12 text-white text-lg font-black outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
              Precio de venta
            </label>
            <MoneyInput
              aria-label="Precio de venta"
              value={price}
              onChange={setPrice}
              onEnter={() => handleSubmit()}
              placeholder="Sin precio"
              className="w-full bg-black border-2 border-emerald-500/40 rounded-xl px-3 h-12 text-xl font-black text-white outline-none focus:border-emerald-400"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-14 rounded-xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-[2] h-14 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 active:bg-emerald-600 transition-colors"
            >
              {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
              Crear y agregar
            </button>
          </div>
        </form>
      </div>

      {avisos && (
        <Confirmar
          titulo={price ? "¿Seguro?" : "¿Crear sin precio?"}
          avisos={avisos}
          acciones={[
            { label: price ? "Sí, crear" : "Crear sin precio", tono: "primario", onClick: () => void crear() },
            { label: price ? "Corregir" : "Ponerle precio", tono: "neutro", onClick: () => setAvisos(null) },
          ]}
        />
      )}
    </div>
  );
}
