"use client";

import { useState, useCallback } from "react";
import { ProductUI } from "@/types";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { apiWrite } from "@/lib/offline/apiWrite";
import { readCachedProducts } from "@/lib/offline/db";

export interface InventoryItem {
  product: ProductUI;
  quantity: number;
}

/**
 * Cola de ítems escaneados que se confirma como una recepción real:
 * inserta inventory_movements (IN) e incrementa branch_stock vía el RPC
 * apply_reception.
 */
export function useQuickInventory() {
  const { currentBranch } = useBranch();
  const { refreshPending } = useSync();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const addItem = useCallback(async (barcode: string) => {
    setIsScanning(true);
    setError(null);
    setSuccess(null);

    try {
      let matched = false;
      setItems((prev) => {
        const idx = prev.findIndex(
          (item) => item.product.barcode === barcode || item.product.id === barcode
        );
        if (idx === -1) return prev;
        matched = true;
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      });
      if (matched) return true;

      // La búsqueda va contra el catálogo cacheado: recibir mercadería suele
      // pasar en la bodega, justo donde peor llega el wifi.
      const cached = await readCachedProducts().catch(() => [] as ProductUI[]);
      let found = cached.find((p) => p.barcode === barcode || p.id === barcode);

      if (!found) {
        try {
          const res = await fetch("/api/products", { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as { items?: ProductUI[] };
            found = (data.items ?? []).find((p) => p.barcode === barcode || p.id === barcode);
          }
        } catch {
          /* sin red: nos quedamos con lo cacheado */
        }
      }

      if (!found) {
        setError(`Producto no encontrado: ${barcode}`);
        return false;
      }

      const product = found;
      setItems((prev) => [...prev, { product, quantity: 1 }]);
      return true;
    } catch {
      setError("Error al buscar el producto");
      return false;
    } finally {
      setIsScanning(false);
    }
  }, []);

  const updateQuantity = useCallback((barcode: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) =>
        prev.filter((i) => i.product.barcode !== barcode && i.product.id !== barcode)
      );
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.product.barcode === barcode || i.product.id === barcode ? { ...i, quantity } : i
      )
    );
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setError(null);
    setSuccess(null);
  }, []);

  const confirm = useCallback(async () => {
    if (items.length === 0) return;
    setIsSaving(true);
    setError(null);

    try {
      const res = await apiWrite<{ count: number }>({
        kind: "reception",
        url: "/api/reception",
        payload: {
          items: items.map((i) => ({
            barcode: i.product.barcode || i.product.id,
            // Decimal si el producto se vende por kilo.
            qty: i.quantity,
            name: i.product.name,
          })),
          branchId: currentBranch?.id ?? null,
          notes: "RECEPTION",
        },
      });

      if (res.ok && res.queued) {
        setSuccess("Recepción guardada sin conexión — se sincronizará");
        await refreshPending();
        setItems([]);
      } else if (res.ok) {
        const count = res.data?.count ?? items.length;
        setSuccess(`Recepción registrada: ${count} producto${count === 1 ? "" : "s"}`);
        setItems([]);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la operación");
    } finally {
      setIsSaving(false);
    }
  }, [items, currentBranch?.id, refreshPending]);

  return {
    items,
    addItem,
    updateQuantity,
    confirm,
    clear,
    isScanning,
    isSaving,
    error,
    success,
    totalItems: items.reduce((acc, item) => acc + item.quantity, 0),
  };
}
