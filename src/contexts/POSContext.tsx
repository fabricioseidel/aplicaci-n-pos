"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { ProductUI } from "@/types";
import {
  CART_KEY,
  EMPTY_DRAFT,
  parseDraft,
  refreshPrices,
  type CartLine,
  type SaleDraft,
} from "@/lib/pos/cartStorage";

export type POSItem = CartLine;

/** Precio unitario efectivo: la oferta manda sobre el precio de lista. */
export function unitPriceOf(p: ProductUI): number {
  return p.offerPrice && p.offerPrice > 0 ? p.offerPrice : p.price;
}

/**
 * Subtotal de una línea, redondeado a peso.
 *
 * Se redondea POR LÍNEA y no al final para que lo que ve el cajero en cada
 * fila sume exactamente el total que va a cobrar: con productos por peso
 * (0.350 kg × $4.990) los decimales sueltos descuadran el arqueo.
 */
export function lineSubtotal(item: POSItem): number {
  const precio = item.precioEspecial !== undefined ? item.precioEspecial : unitPriceOf(item);
  return Math.round(precio * item.quantity);
}

/** Lo que la línea costaría con el precio de la ficha. */
export function lineSubtotalFicha(item: POSItem): number {
  return Math.round(unitPriceOf(item) * item.quantity);
}

/** Descuento de la línea por precio especial (0 si no tiene). */
export function lineDiscount(item: POSItem): number {
  return Math.max(0, lineSubtotalFicha(item) - lineSubtotal(item));
}

type Comprador = SaleDraft["comprador"];

interface POSContextType {
  cart: POSItem[];
  addToCart: (product: ProductUI, quantity?: number) => void;
  setQuantity: (barcode: string, quantity: number) => void;
  removeFromCart: (barcode: string) => void;
  updateQuantity: (barcode: string, quantity: number) => void;
  /** Reemplaza los datos de producto de una línea (p. ej. su precio nuevo). */
  updateLineProduct: (product: ProductUI) => void;
  /** Precio sólo para esta venta; `undefined` lo quita. */
  setPrecioEspecial: (barcode: string, precio: number | undefined) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
  compraPropia: boolean;
  setCompraPropia: (v: boolean) => void;
  porCobrar: boolean;
  setPorCobrar: (v: boolean) => void;
  comprador: Comprador;
  setComprador: (c: Comprador) => void;
  /** Deja la venta en blanco (al confirmarla o con "Empezar de cero"). */
  resetSale: () => void;
  /** Venta retomada al abrir la app, para avisar "Seguimos con la venta en curso". */
  restored: { count: number; savedAt: number } | null;
  dismissRestored: () => void;
  /** Trae los precios del catálogo fresco al carrito; devuelve los que cambiaron. */
  applyCatalog: (catalog: ProductUI[]) => string[];
}

const POSContext = createContext<POSContextType | undefined>(undefined);

/**
 * Venta en curso.
 *
 * Vive arriba de todas las pestañas y se guarda en el teléfono: antes estaba
 * dentro de la pestaña Venta, y con sólo ir a Productos a corregir un precio
 * (o recargar, o que se cortara la luz) el carrito se perdía y había que
 * escanear todo de nuevo con el cliente esperando.
 */
export function POSProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SaleDraft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState<{ count: number; savedAt: number } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Se lee después de montar (no en el render) para no desentonar con el HTML
  // del servidor, que no tiene acceso al teléfono.
  useEffect(() => {
    let saved: SaleDraft | null = null;
    try {
      saved = parseDraft(localStorage.getItem(CART_KEY));
    } catch {
      /* sin localStorage: el carrito vive sólo en memoria */
    }
    if (saved && saved.items.length > 0) {
      setDraft(saved);
      setRestored({ count: saved.items.length, savedAt: saved.savedAt });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (draft.items.length === 0 && !draft.compraPropia) localStorage.removeItem(CART_KEY);
      else localStorage.setItem(CART_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
    } catch {
      /* lleno o bloqueado: se sigue en memoria */
    }
  }, [draft, hydrated]);

  const cart = draft.items;
  const total = useMemo(() => cart.reduce((acc, item) => acc + lineSubtotal(item), 0), [cart]);

  // Los productos por peso cuentan como 1 "ítem" en el contador aunque sean
  // 0.35 kg: el número del carrito es cuántas cosas lleva, no cuánto pesan.
  const itemCount = useMemo(
    () => cart.reduce((acc, item) => acc + (item.byWeight ? 1 : item.quantity), 0),
    [cart]
  );

  const setItems = useCallback(
    (fn: (prev: POSItem[]) => POSItem[]) => setDraft((d) => ({ ...d, items: fn(d.items) })),
    []
  );

  const addToCart = useCallback(
    (product: ProductUI, quantity: number = 1) => {
      setItems((prev) => {
        const existing = prev.find((item) => item.id === product.id);
        if (existing) {
          return prev.map((item) =>
            item.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
          );
        }
        return [...prev, { ...product, quantity }];
      });
    },
    [setItems]
  );

  const removeFromCart = useCallback(
    (barcode: string) => setItems((prev) => prev.filter((item) => item.id !== barcode)),
    [setItems]
  );

  /** Fija la cantidad exacta (lo que usa el prompt de peso). */
  const setQuantity = useCallback(
    (barcode: string, quantity: number) => {
      if (quantity <= 0) {
        removeFromCart(barcode);
        return;
      }
      setItems((prev) => prev.map((item) => (item.id === barcode ? { ...item, quantity } : item)));
    },
    [removeFromCart, setItems]
  );

  const updateLineProduct = useCallback(
    (product: ProductUI) =>
      setItems((prev) =>
        prev.map((item) => (item.id === product.id ? { ...item, ...product, quantity: item.quantity } : item))
      ),
    [setItems]
  );

  const setPrecioEspecial = useCallback(
    (barcode: string, precio: number | undefined) =>
      setItems((prev) => prev.map((item) => (item.id === barcode ? { ...item, precioEspecial: precio } : item))),
    [setItems]
  );

  const clearCart = useCallback(() => setItems(() => []), [setItems]);

  const resetSale = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setRestored(null);
  }, []);

  const applyCatalog = useCallback((catalog: ProductUI[]) => {
    if (draftRef.current.items.length === 0 || catalog.length === 0) return [];
    const { changed } = refreshPrices(draftRef.current.items, catalog);
    setDraft((d) => ({ ...d, items: refreshPrices(d.items, catalog).items }));
    return changed;
  }, []);

  const value = useMemo<POSContextType>(
    () => ({
      cart,
      addToCart,
      setQuantity,
      removeFromCart,
      updateQuantity: setQuantity,
      updateLineProduct,
      setPrecioEspecial,
      clearCart,
      total,
      itemCount,
      compraPropia: draft.compraPropia,
      setCompraPropia: (v) =>
        setDraft((d) => ({ ...d, compraPropia: v, ...(v ? {} : { porCobrar: false, comprador: null }) })),
      porCobrar: draft.porCobrar,
      setPorCobrar: (v) => setDraft((d) => ({ ...d, porCobrar: v })),
      comprador: draft.comprador,
      setComprador: (c) => setDraft((d) => ({ ...d, comprador: c })),
      resetSale,
      restored,
      dismissRestored: () => setRestored(null),
      applyCatalog,
    }),
    [
      cart, addToCart, setQuantity, removeFromCart, updateLineProduct, setPrecioEspecial, clearCart, total, itemCount,
      draft.compraPropia, draft.porCobrar, draft.comprador, resetSale, restored, applyCatalog,
    ]
  );

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
}

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) throw new Error("usePOS must be used within POSProvider");
  return context;
};
