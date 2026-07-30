"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import type { Branch } from "@/types";

const STORAGE_KEY = "pos.branchId.v1";
const CACHE_KEY = "pos.branches.v1";

interface BranchContextType {
  branches: Branch[];
  currentBranch: Branch | null;
  setBranch: (branch: Branch) => void;
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyList = useCallback((list: Branch[]) => {
    setBranches(list);
    const savedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const restored = savedId ? list.find((b) => b.id === savedId) : null;
    const defaultBranch = list.find((b) => b.is_default) ?? list[0];
    setCurrentBranch(restored ?? defaultBranch ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Sin red, las sucursales salen de localStorage. La sucursal es obligatoria
    // para armar una venta, así que el POS no puede quedar bloqueado esperando
    // una respuesta que no va a llegar.
    const loadCached = () => {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const list = JSON.parse(raw) as Branch[];
        if (!Array.isArray(list) || list.length === 0) return false;
        applyList(list);
        return true;
      } catch {
        return false;
      }
    };

    const hadCache = loadCached();

    fetch("/api/branches", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: { branches?: Branch[] }) => {
        if (cancelled) return;
        const list = data.branches ?? [];
        applyList(list);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(list));
        } catch {
          /* cuota llena: seguimos igual, sólo perdemos el modo offline */
        }
      })
      .catch(() => {
        if (!hadCache) console.warn("[branches] sin red y sin caché local");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyList]);

  const setBranch = useCallback((branch: Branch) => {
    setCurrentBranch(branch);
    try {
      localStorage.setItem(STORAGE_KEY, branch.id);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <BranchContext.Provider value={{ branches, currentBranch, setBranch, isLoading }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
