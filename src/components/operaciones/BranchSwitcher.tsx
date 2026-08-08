"use client";

import React, { useState, useRef, useEffect } from "react";
import { BuildingStorefrontIcon, ChevronDownIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useBranch } from "@/contexts/BranchContext";

/** Selector de sucursal: cambia el contexto activo, se persiste en localStorage. */
export default function BranchSwitcher() {
  const { branches, currentBranch, setBranch, isLoading } = useBranch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (isLoading || branches.length === 0) return null;

  // Con una sola sucursal no hay nada para elegir; mostrarlo sólo confundiría.
  if (branches.length === 1) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-white/40">
        <BuildingStorefrontIcon className="w-3 h-3" />
        {currentBranch?.name}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-white/10 bg-white/5 text-white/70 hover:text-white transition-colors"
      >
        <BuildingStorefrontIcon className="w-3 h-3" />
        {currentBranch?.name ?? "Sucursal"}
        <ChevronDownIcon className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-48 bg-[#111] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBranch(b);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold text-white/80 hover:bg-white/5 transition-colors"
            >
              <span className="flex flex-col">
                {b.name}
                {b.is_default && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                    Casa matriz
                  </span>
                )}
              </span>
              {currentBranch?.id === b.id && <CheckIcon className="w-4 h-4 text-emerald-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
