"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductUI } from "@/types";
import { cacheProducts, readCachedProducts } from "@/lib/offline/db";

interface CatalogState {
  products: ProductUI[];
  loading: boolean;
  /** true si lo que se está mostrando salió de IndexedDB y no de la red. */
  fromCache: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Inserta/actualiza un producto en memoria (tras crearlo o editarlo). */
  upsertLocal: (product: ProductUI) => void;
}

/**
 * Catálogo del POS con respaldo offline.
 *
 * Primero pinta lo que haya en IndexedDB (instantáneo, y es lo único que hay
 * si no hay red) y en paralelo pide `/api/products`. Cuando la respuesta
 * llega, reemplaza la lista y refresca la caché.
 */
export function useProductCatalog(): CatalogState {
  const [products, setProducts] = useState<ProductUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: ProductUI[] };
      const items = data.items ?? [];
      setProducts(items);
      setFromCache(false);
      void cacheProducts(items).catch(() => {
        /* sin IndexedDB seguimos, sólo perdemos el modo offline */
      });
    } catch (e) {
      // Sin red: nos quedamos con lo cacheado, que ya se pintó abajo.
      const cached = await readCachedProducts().catch(() => [] as ProductUI[]);
      if (cached.length > 0) {
        setProducts(cached);
        setFromCache(true);
      } else {
        setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    readCachedProducts()
      .then((cached) => {
        if (cancelled || cached.length === 0) return;
        setProducts(cached);
        setFromCache(true);
        setLoading(false);
      })
      .catch(() => {
        /* noop */
      })
      .finally(() => {
        if (!cancelled) void refresh();
      });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const upsertLocal = useCallback((product: ProductUI) => {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === product.id);
      if (idx === -1) return [product, ...prev];
      const next = [...prev];
      next[idx] = product;
      return next;
    });
  }, []);

  return { products, loading, fromCache, error, refresh, upsertLocal };
}
