"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from "react";
import { ProductUI } from "@/types";

export interface POSItem extends ProductUI {
  /** Unidades para productos normales; kilos (decimal) para los de peso. */
  quantity: number;
}

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
  return Math.round(unitPriceOf(item) * item.quantity);
}

interface POSContextType {
  cart: POSItem[];
  addToCart: (product: ProductUI, quantity?: number) => void;
  setQuantity: (barcode: string, quantity: number) => void;
  removeFromCart: (barcode: string) => void;
  updateQuantity: (barcode: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const POSContext = createContext<POSContextType | undefined>(undefined);

export function POSProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<POSItem[]>([]);

  const total = useMemo(() => cart.reduce((acc, item) => acc + lineSubtotal(item), 0), [cart]);

  // Los productos por peso cuentan como 1 "ítem" en el contador aunque sean
  // 0.35 kg: el número del carrito es cuántas cosas lleva, no cuánto pesan.
  const itemCount = useMemo(
    () => cart.reduce((acc, item) => acc + (item.byWeight ? 1 : item.quantity), 0),
    [cart]
  );

  const addToCart = useCallback((product: ProductUI, quantity: number = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
        );
      }
      return [...prev, { ...product, quantity }];
    });
  }, []);

  const removeFromCart = useCallback((barcode: string) => {
    setCart((prev) => prev.filter((item) => item.id !== barcode));
  }, []);

  /** Fija la cantidad exacta (lo que usa el prompt de peso). */
  const setQuantity = useCallback(
    (barcode: string, quantity: number) => {
      if (quantity <= 0) {
        removeFromCart(barcode);
        return;
      }
      setCart((prev) =>
        prev.map((item) => (item.id === barcode ? { ...item, quantity } : item))
      );
    },
    [removeFromCart]
  );

  const updateQuantity = setQuantity;

  const clearCart = useCallback(() => setCart([]), []);

  return (
    <POSContext.Provider
      value={{
        cart,
        addToCart,
        setQuantity,
        removeFromCart,
        updateQuantity,
        clearCart,
        total,
        itemCount,
      }}
    >
      {children}
    </POSContext.Provider>
  );
}

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) throw new Error("usePOS must be used within POSProvider");
  return context;
};
