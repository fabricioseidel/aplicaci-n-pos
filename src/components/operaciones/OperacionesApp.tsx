"use client";

import React, { useState } from "react";
import {
  ShoppingCartIcon,
  ArchiveBoxArrowDownIcon,
  BanknotesIcon,
  LockClosedIcon,
  QrCodeIcon,
  TagIcon,
  CloudIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { POSProvider } from "@/contexts/POSContext";
import { useSync } from "@/contexts/SyncContext";
import { useBranch } from "@/contexts/BranchContext";
import { useOpenShift } from "@/hooks/useOpenShift";
import SaleMode from "@/components/operaciones/SaleMode";
import ReceptionMode from "@/components/operaciones/ReceptionMode";
import CajaMode from "@/components/operaciones/CajaMode";
import CloseMode from "@/components/operaciones/CloseMode";
import InventarioMode from "@/components/operaciones/InventarioMode";
import ProductosMode from "@/components/operaciones/ProductosMode";
import BranchSwitcher from "@/components/operaciones/BranchSwitcher";

type OperationsMode = "VENTA" | "RECEPCION" | "INVENTARIO" | "CAJA" | "CIERRE" | "PRODUCTOS";

const TABS: { id: OperationsMode; label: string; icon: typeof ShoppingCartIcon }[] = [
  { id: "VENTA", label: "Venta", icon: ShoppingCartIcon },
  { id: "RECEPCION", label: "Recepción", icon: ArchiveBoxArrowDownIcon },
  { id: "INVENTARIO", label: "Inventario", icon: QrCodeIcon },
  { id: "CAJA", label: "Caja", icon: BanknotesIcon },
  { id: "CIERRE", label: "Cierre", icon: LockClosedIcon },
  { id: "PRODUCTOS", label: "Productos", icon: TagIcon },
];

/** Punto naranja con el número de operaciones sin sincronizar. */
function SyncBadge() {
  const { pending, syncing, isOnline, syncNow } = useSync();

  if (pending === 0 && isOnline) return null;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={
        pending > 0
          ? `${pending} operación(es) sin sincronizar. Toca para reintentar.`
          : "Sin conexión"
      }
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
        pending > 0
          ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
          : "bg-white/5 border-white/10 text-white/40"
      }`}
    >
      {syncing ? (
        <ArrowPathIcon className="w-3 h-3 animate-spin" />
      ) : (
        <span
          className={`w-2 h-2 rounded-full ${pending > 0 ? "bg-amber-400" : "bg-white/30"}`}
        />
      )}
      {pending > 0 ? `${pending} pendiente${pending === 1 ? "" : "s"}` : "Sin conexión"}
      {!isOnline && <CloudIcon className="w-3 h-3" />}
    </button>
  );
}

export default function OperacionesApp() {
  const [mode, setMode] = useState<OperationsMode>("VENTA");
  const { currentBranch } = useBranch();
  const {
    open: cajaAbierta,
    shiftId,
    loading: cargandoCaja,
    refresh: refrescarCaja,
  } = useOpenShift(currentBranch?.id);

  // Sin caja abierta no se vende: si la venta no queda dentro de un turno, el
  // arqueo del día nunca cuadra. El servidor rechaza igual, esto evita que el
  // vendedor llegue hasta el final del carrito para recibir el error.
  const ventaBloqueada = mode === "VENTA" && cajaAbierta === false && !cargandoCaja;

  return (
    // Altura exacta de la ventana (dvh, no vh: en el navegador del celular la
    // barra de direcciones se esconde y vh miente). Así el único que scrollea
    // es el contenido, y la barra de pestañas no se puede ir de pantalla.
    <div className="flex flex-col h-dvh bg-[#0a0a0a] text-white">
      <div className="sticky top-0 z-30 bg-[#0a0a0a] border-b border-white/5">
        <div className="flex justify-end gap-2 px-3 pt-2 h-7 items-center">
          <BranchSwitcher />
          <SyncBadge />
        </div>
        <div className="flex max-w-4xl mx-auto px-1 sm:px-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-current={mode === id ? "page" : undefined}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-2.5 sm:py-3.5 text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${
                mode === id
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-white/30 hover:text-white/60"
              }`}
            >
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {mode === "VENTA" && ventaBloqueada && (
          <div className="max-w-md mx-auto px-6 py-16 text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-5">
              <BanknotesIcon className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black text-white">La caja está cerrada</h2>
            <p className="mt-2 text-white/50 leading-relaxed">
              Para registrar ventas primero tienes que abrir la caja del día. Así cada venta queda
              dentro de un turno y el arqueo cuadra al cierre.
            </p>
            <button
              type="button"
              onClick={() => setMode("CAJA")}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-6 h-12 font-bold text-white transition-colors hover:bg-emerald-500"
            >
              Ir a abrir la caja
            </button>
            <button
              type="button"
              onClick={refrescarCaja}
              className="mt-3 block w-full text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white/60"
            >
              Ya la abrí, reintentar
            </button>
          </div>
        )}

        {mode === "VENTA" && !ventaBloqueada && (
          <POSProvider>
            <SaleMode shiftId={shiftId} />
          </POSProvider>
        )}
        {mode === "RECEPCION" && <ReceptionMode />}
        {mode === "INVENTARIO" && <InventarioMode />}
        {mode === "CAJA" && <CajaMode onShiftChange={refrescarCaja} />}
        {mode === "CIERRE" && <CloseMode onShiftChange={refrescarCaja} />}
        {mode === "PRODUCTOS" && <ProductosMode />}
      </div>
    </div>
  );
}
