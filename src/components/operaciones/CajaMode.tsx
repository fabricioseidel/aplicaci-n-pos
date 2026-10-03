"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { apiWrite } from "@/lib/offline/apiWrite";
import { clp } from "@/lib/cierre/denominations";
import { resumenTurno, type VentaTurno } from "@/lib/caja/resumenTurno";
import type { CashShift } from "@/server/shifts.service";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import AbrirCaja from "./caja/AbrirCaja";
import Movimientos, { MOVEMENT_METHOD_LABEL, type MovementMethod, type NuevoMovimiento } from "./caja/Movimientos";
import VentasTurno, { type VentaDetalle } from "./caja/VentasTurno";

/**
 * Lo que avisa la caja hacia arriba. OperacionesApp refresca el estado de la
 * caja siempre y vuelve a Venta con "abierta" y con "corregir" (después de
 * "Anular y corregir", con los productos en `pos.corregir.v1`).
 */
export type EventoTurno = "abierta" | "cerrada" | "cambio" | "corregir";

interface CashMovement {
  id: string;
  amount: number;
  type: "IN" | "OUT";
  method?: MovementMethod;
  reason: string;
  created_at: string;
}

interface RespuestaTurno {
  shift: CashShift | null;
  propuesto?: number | null;
  propuestoOrigen?: "deja" | "contado" | null;
}

export default function CajaMode({
  onShiftChange,
}: { onShiftChange?: (evento?: EventoTurno) => void } = {}) {
  const { showToast } = useToast();
  const { currentBranch, isLoading: cargandoSucursal, reload: recargarSucursales } = useBranch();
  const { refreshPending } = useSync();

  const [turno, setTurno] = useState<RespuestaTurno | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [shiftSales, setShiftSales] = useState<VentaDetalle[]>([]);
  const shift = turno?.shift ?? null;

  const fetchShift = useCallback(async () => {
    // Sin sucursal no se consulta: el servidor caería en la por defecto, pero
    // esta pantalla tiene que mostrar la caja de la sucursal elegida.
    if (!currentBranch?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/caja/shifts?branchId=${encodeURIComponent(currentBranch.id)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(String(res.status));
      setTurno((await res.json()) as RespuestaTurno);
    } catch {
      /* sin red no se puede saber: se deja como está */
    } finally {
      setLoading(false);
    }
  }, [currentBranch?.id]);

  const fetchShiftData = useCallback(async (shiftId: string) => {
    try {
      const res = await fetch(`/api/caja?shiftId=${shiftId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMovements(data.movements || []);
      setShiftSales(data.sales || []);
    } catch {
      /* noop */
    }
  }, []);

  // Cambiar de sucursal es cambiar de caja: se vuelve a consultar el turno.
  useEffect(() => { void fetchShift(); }, [fetchShift]);
  useEffect(() => {
    if (shift?.id) void fetchShiftData(shift.id);
  }, [shift?.id, fetchShiftData]);

  const resumen = useMemo(
    () =>
      resumenTurno({
        inicio: shift?.starting_cash ?? 0,
        ventas: shiftSales as VentaTurno[],
        movimientos: movements,
      }),
    [shift?.starting_cash, shiftSales, movements]
  );

  const handleOpen = async (startingCash: number) => {
    if (opening || !currentBranch?.id) return;
    setOpening(true);
    try {
      // Abrir caja NO se encola: todo el resto del día depende de tener un
      // shiftId real, así que sin red hay que reintentar, no seguir a ciegas.
      const res = await apiWrite<{ shift: CashShift; alreadyOpen?: boolean }>({
        kind: "shiftOpen",
        url: "/api/caja/shifts",
        queueable: false,
        payload: { startingCash, branchId: currentBranch.id },
      });

      if (res.ok && !res.queued) {
        if (res.data?.alreadyOpen) {
          showToast("Ya había una caja abierta en esta sucursal: se sigue con esa", "warning");
        } else {
          showToast(`Caja abierta con ${clp(startingCash)} ✓`, "success");
        }
        await fetchShift();
        // Abierta la caja, lo que sigue es vender: OperacionesApp vuelve a Venta.
        onShiftChange?.("abierta");
      } else if (!res.ok) {
        showToast(res.error, "error");
      }
    } finally {
      setOpening(false);
    }
  };

  const handleMovement = async (m: NuevoMovimiento): Promise<boolean> => {
    if (!shift) return false;
    const res = await apiWrite({
      kind: "movement",
      url: "/api/caja/movements",
      // La base deduplica por este campo: si el outbox reenvía el movimiento
      // porque la respuesta no llegó, no se carga la plata dos veces.
      idField: "opId",
      payload: { shiftId: shift.id, ...m },
    });

    if (res.ok && res.queued) {
      showToast("Movimiento guardado sin conexión", "warning");
      await refreshPending();
      return true;
    }
    if (res.ok) {
      showToast("Movimiento registrado ✓", "success");
      void fetchShiftData(shift.id);
      return true;
    }
    showToast(res.error, "error");
    return false;
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-white/40 text-xs font-black uppercase tracking-widest animate-pulse">
        Cargando…
      </div>
    );
  }

  if (!shift) {
    return (
      <AbrirCaja
        sucursal={currentBranch?.name ?? null}
        cargandoSucursal={cargandoSucursal}
        onReintentarSucursal={() => void recargarSucursales()}
        propuesto={turno?.propuesto ?? null}
        propuestoOrigen={turno?.propuestoOrigen ?? null}
        abriendo={opening}
        onAbrir={handleOpen}
      />
    );
  }

  const filas: Array<{ label: string; value: number; color: string; nota?: string }> = [
    { label: "Inicio", value: resumen.inicio, color: "text-white" },
    { label: "Ventas efectivo", value: resumen.efectivo, color: "text-emerald-400" },
    { label: "Tarjeta", value: resumen.tarjeta, color: "text-white" },
    { label: "Transferencia", value: resumen.transferencia, color: "text-white" },
    { label: "Total ventas", value: resumen.totalVentas, color: "text-white" },
    { label: "Esperado en caja", value: resumen.esperado, color: "text-yellow-400", nota: "efectivo" },
  ];

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
        <div className="flex justify-between items-center mb-3">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-400">
            Turno activo · {currentBranch?.name ?? "Local"}
          </p>
          <button
            type="button"
            onClick={() => fetchShiftData(shift.id)}
            aria-label="Actualizar"
            className="w-12 h-12 -mr-2 flex items-center justify-center text-white/40 active:text-white"
          >
            <ArrowPathIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {filas.map((s) => (
            <div key={s.label} className="bg-white/5 rounded-xl p-3">
              <p className="text-[11px] font-black uppercase tracking-wider text-white/45 mb-0.5">
                {s.label}
              </p>
              <p className={`text-lg font-black tabular-nums ${s.color}`}>{clp(s.value)}</p>
            </div>
          ))}
        </div>
        {(resumen.ingresos > 0 || resumen.egresos > 0) && (
          <p className="mt-2 text-xs text-white/45">
            Esperado = inicio + ventas en efectivo
            {resumen.ingresos > 0 && ` + ingresos ${clp(resumen.ingresos)}`}
            {resumen.egresos > 0 && ` − egresos ${clp(resumen.egresos)}`}
          </p>
        )}
        {resumen.porCobrar > 0 && (
          <p className="mt-2 text-sm text-amber-300">
            Por cobrar (compras del personal): <span className="font-black">{clp(resumen.porCobrar)}</span>
            <span className="block text-xs text-white/40">
              No entra plata a la caja y no suma en Total ventas.
            </span>
          </p>
        )}
        {resumen.anuladas.cantidad > 0 && (
          <p className="mt-2 text-xs text-white/40">
            {resumen.anuladas.cantidad === 1
              ? "1 venta anulada no se cuenta"
              : `${resumen.anuladas.cantidad} ventas anuladas no se cuentan`}{" "}
            ({clp(resumen.anuladas.total)}).
          </p>
        )}
      </div>

      <Movimientos onRegistrar={handleMovement} />

      {movements.length > 0 && (
        <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
          <p className="text-xs font-black uppercase tracking-widest text-white/45 mb-3">
            Movimientos del turno
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {movements.map((m) => (
              <div
                key={m.id}
                className={`flex justify-between items-center p-3 rounded-xl text-sm ${
                  m.type === "IN" ? "bg-emerald-500/10" : "bg-red-500/10"
                }`}
              >
                <span className="text-white/80 truncate mr-2">
                  {m.reason || (m.type === "IN" ? "Ingreso" : "Egreso")}
                  <span className="text-white/40 text-xs ml-1.5">
                    · {MOVEMENT_METHOD_LABEL[m.method ?? "CASH"]}
                  </span>
                </span>
                <span className={`font-black shrink-0 tabular-nums ${m.type === "IN" ? "text-emerald-400" : "text-red-400"}`}>
                  {m.type === "IN" ? "+" : "−"} {clp(m.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <VentasTurno
        ventas={shiftSales}
        shiftId={shift.id}
        onCambio={() => {
          void fetchShiftData(shift.id);
          onShiftChange?.("cambio");
        }}
        onCorregir={() => onShiftChange?.("corregir")}
      />
    </div>
  );
}
