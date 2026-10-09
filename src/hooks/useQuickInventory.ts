"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ProductUI } from "@/types";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { apiWrite } from "@/lib/offline/apiWrite";
import { readCachedProducts } from "@/lib/offline/db";
import { parseRecepcion, recepcionKey } from "@/lib/inventario/recepcion";

export interface InventoryItem {
  product: ProductUI;
  quantity: number;
  /** Creado en esta recepción: se le ofrece precio sugerido. */
  nuevo?: boolean;
  /** Costo de la factura tipeado en esta recepción (con IVA). */
  costoFactura?: number | null;
  /** El costo de la factura no era el que tenía: se ofrece el precio sugerido. */
  costoCambiado?: boolean;
  /** "No, dejar el precio": no se vuelve a sugerir en esta línea. */
  sugerenciaDescartada?: boolean;
}

export type QuickInventoryMode = "reception" | "transfer";

/**
 * Cola de ítems escaneados que se confirma como un movimiento de stock real:
 *
 * - modo "reception" (casa matriz): entra mercadería de un proveedor externo,
 *   vía `apply_reception` — suma stock de la nada.
 * - modo "transfer" (sucursal): la mercadería sale de la casa matriz, vía
 *   `apply_transfer` — resta allá y suma acá, no aparece stock nuevo.
 */
export function useQuickInventory(mode: QuickInventoryMode = "reception") {
  const { currentBranch } = useBranch();
  const { refreshPending } = useSync();

  const [items, setItems] = useState<InventoryItem[]>([]);
  /** Productos recuperados del teléfono al abrir (para el aviso "Seguimos…"). */
  const [recuperados, setRecuperados] = useState(0);
  /** Clave cuya lista ya se leyó: hasta entonces no se escribe (ni se borra) nada. */
  const [cargadaKey, setCargadaKey] = useState<string | null>(null);
  const key = recepcionKey(mode);

  // La lista vive en el teléfono hasta confirmarse, como el carrito: cambiar
  // de pestaña o que Android cierre la app no borra lo ya escaneado.
  useEffect(() => {
    try {
      const guardada = parseRecepcion(window.localStorage.getItem(key));
      const lista = guardada?.items ?? [];
      setItems(lista);
      setRecuperados(lista.length);
    } catch {
      setItems([]);
    }
    setCargadaKey(key);
  }, [key]);

  useEffect(() => {
    if (cargadaKey !== key) return;
    try {
      if (items.length === 0) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify({ items, savedAt: Date.now() }));
    } catch {
      /* sin localStorage (modo privado): se recibe igual, sin respaldo */
    }
  }, [items, key, cargadaKey]);
  /**
   * Espejo de `items` para poder consultarlo sin meter la lectura dentro del
   * updater de setState: en StrictMode React invoca el updater dos veces, y
   * un efecto secundario ahí dentro sumaría la cantidad dos veces por escaneo.
   */
  const itemsRef = useRef<InventoryItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const addItem = useCallback(async (barcode: string) => {
    setIsScanning(true);
    setError(null);
    setSuccess(null);

    try {
      const existing = itemsRef.current.find(
        (item) => item.product.barcode === barcode || item.product.id === barcode
      );
      if (existing) {
        const step = existing.product.byWeight ? 0.5 : 1;
        setItems((prev) =>
          prev.map((item) =>
            item.product.barcode === barcode || item.product.id === barcode
              ? { ...item, quantity: item.quantity + step }
              : item
          )
        );
        return true;
      }

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

  /**
   * Suma un producto ya resuelto (recién creado, o elegido de una sugerencia
   * de fusión) sin pasar por la búsqueda por código de `addItem`: ya se tiene
   * el objeto completo, así que no hay nada que resolver contra el catálogo.
   */
  const addProduct = useCallback((product: ProductUI, quantity: number, opts?: { nuevo?: boolean }) => {
    setError(null);
    setSuccess(null);
    const key = product.barcode || product.id;
    setItems((prev) => {
      const idx = prev.findIndex((item) => (item.product.barcode || item.product.id) === key);
      if (idx === -1) return [...prev, { product, quantity, ...(opts?.nuevo ? { nuevo: true } : {}) }];
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
      return next;
    });
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

  /** Cambia datos de una línea que no son la cantidad (producto editado, costo tipeado…). */
  const updateLine = useCallback(
    (barcode: string, cambios: Partial<Omit<InventoryItem, "quantity">>) => {
      setItems((prev) =>
        prev.map((i) =>
          i.product.barcode === barcode || i.product.id === barcode ? { ...i, ...cambios } : i
        )
      );
    },
    []
  );

  const clear = useCallback(() => {
    setItems([]);
    setError(null);
    setSuccess(null);
  }, []);

  const confirm = useCallback(async () => {
    if (items.length === 0) return;
    setIsSaving(true);
    setError(null);

    const isTransfer = mode === "transfer";
    const successVerb = isTransfer ? "Traspaso registrado" : "Recepción registrada";
    const queuedMsg = isTransfer
      ? "Traspaso guardado sin conexión — se sincronizará"
      : "Recepción guardada sin conexión — se sincronizará";

    try {
      const res = await apiWrite<{ count: number }>(
        isTransfer
          ? {
              kind: "transfer",
              url: "/api/transfers",
              // La base deduplica por este campo: si el outbox reenvía el
              // traspaso porque la respuesta no llegó, no se aplica dos veces.
              idField: "opId",
              payload: {
                items: items.map((i) => ({
                  barcode: i.product.barcode || i.product.id,
                  qty: i.quantity,
                })),
                toBranchId: currentBranch?.id ?? null,
                notes: "TRANSFER",
              },
            }
          : {
              kind: "reception",
              url: "/api/reception",
              // Ídem recepción: sin esto, un reintento sumaba el stock de nuevo.
              idField: "opId",
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
            }
      );

      if (res.ok && res.queued) {
        setSuccess(queuedMsg);
        await refreshPending();
        setItems([]);
      } else if (res.ok) {
        const count = res.data?.count ?? items.length;
        setSuccess(`${successVerb}: ${count} producto${count === 1 ? "" : "s"}`);
        setItems([]);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la operación");
    } finally {
      setIsSaving(false);
    }
  }, [items, currentBranch?.id, refreshPending, mode]);

  return {
    items,
    addItem,
    addProduct,
    updateQuantity,
    updateLine,
    recuperados,
    descartarAvisoRecuperados: () => setRecuperados(0),
    confirm,
    clear,
    isScanning,
    isSaving,
    error,
    success,
    totalItems: items.reduce((acc, item) => acc + item.quantity, 0),
  };
}
