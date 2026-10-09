"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import type { Branch } from "@/types";

const STORAGE_KEY = "pos.branchId.v1";
const CACHE_KEY = "pos.branches.v1";

interface BranchContextType {
  branches: Branch[];
  currentBranch: Branch | null;
  setBranch: (branch: Branch) => void;
  /** true mientras se piden las sucursales y todavía no hay ninguna elegida. */
  isLoading: boolean;
  /** Vuelve a pedir las sucursales (botón "Reintentar" de la caja). */
  reload: () => Promise<void>;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // La última carga desde el servidor salió bien. Si no (401 en /login, sin
  // red), se reintenta cuando la sesión pase a "authenticated".
  const cargadoDelServidor = useRef(false);

  const applyList = useCallback((list: Branch[]) => {
    setBranches(list);
    let savedId: string | null = null;
    try {
      savedId = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* sin localStorage: se usa la por defecto */
    }
    const restored = savedId ? list.find((b) => b.id === savedId) : null;
    const defaultBranch = list.find((b) => b.is_default) ?? list[0];
    setCurrentBranch(restored ?? defaultBranch ?? null);
  }, []);

  // Sin red, las sucursales salen de localStorage. La sucursal es obligatoria
  // para armar una venta, así que el POS no puede quedar bloqueado esperando
  // una respuesta que no va a llegar.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as Branch[];
      if (Array.isArray(list) && list.length > 0) applyList(list);
    } catch {
      /* caché ilegible: se espera al servidor */
    }
  }, [applyList]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/branches", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { branches?: Branch[] };
      const list = data.branches ?? [];
      applyList(list);
      cargadoDelServidor.current = true;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      } catch {
        /* cuota llena: seguimos igual, sólo perdemos el modo offline */
      }
    } catch {
      // Queda lo que había en caché (si había). En /login esto es un 401
      // esperable: se reintenta solo al autenticarse.
    } finally {
      setIsLoading(false);
    }
  }, [applyList]);

  // Antes se pedía una sola vez al montar. El provider vive en el layout
  // raíz, así que en /login ese pedido daba 401 y, como el login no
  // remontaba nada, la sucursal quedaba en null hasta recargar: la caja se
  // abría sin sucursal. Ahora se vuelve a pedir cuando la sesión aparece.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      setIsLoading(false);
      return;
    }
    if (!cargadoDelServidor.current) void reload();
  }, [status, reload]);

  const setBranch = useCallback((branch: Branch) => {
    setCurrentBranch(branch);
    try {
      localStorage.setItem(STORAGE_KEY, branch.id);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <BranchContext.Provider
      value={{
        branches,
        currentBranch,
        setBranch,
        isLoading: isLoading && !currentBranch,
        reload,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
