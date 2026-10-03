"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { useStaff, staffDisplayName } from "@/hooks/useStaff";
import { clp } from "@/lib/cierre/denominations";
import { resumenProductos } from "@/lib/caja/anular";
import Hoja from "./Hoja";

interface Compra {
  id: number;
  ts: string;
  total: number;
  seller_name: string | null;
  notes: string | null;
  sale_items: Array<{ product_name: string | null; quantity: number; subtotal: number }>;
}

const PLEGADA_KEY = "pos.comprasSinDueno.plegada.v1";

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Quién atiende ahora, del selector de Venta, si existe. */
function quienAtiende(): string {
  try {
    const raw = localStorage.getItem("pos.attendant.v1");
    return raw ? String((JSON.parse(raw) as { name?: string }).name ?? "") : "";
  } catch {
    return "";
  }
}

/**
 * Tarjeta ámbar "N compras propias sin dueño" en Caja → Turno.
 *
 * Son compras del personal que quedaron a nombre de nadie (antes de que el POS
 * preguntara quién compra) y que por eso nadie paga. Se elige la persona con
 * botones grandes; "No sé" la deja para el admin. Se puede plegar para que no
 * moleste cada vez que se entra a Caja.
 */
export default function ComprasSinDueno() {
  const { showToast } = useToast();
  const { staff } = useStaff();
  const [compras, setCompras] = useState<Compra[]>([]);
  const [plegada, setPlegada] = useState(true);
  const [abierta, setAbierta] = useState<Compra | null>(null);
  const [elegido, setElegido] = useState<{ id: string; name: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/compras-propias/sin-dueno", { cache: "no-store" });
      if (!r.ok) return;
      setCompras(((await r.json()) as { compras?: Compra[] }).compras ?? []);
    } catch {
      /* sin red: no se muestra */
    }
  }, []);

  useEffect(() => {
    try {
      setPlegada(localStorage.getItem(PLEGADA_KEY) !== "0");
    } catch {
      /* noop */
    }
    void cargar();
  }, [cargar]);

  const plegar = (v: boolean) => {
    setPlegada(v);
    try {
      localStorage.setItem(PLEGADA_KEY, v ? "1" : "0");
    } catch {
      /* noop */
    }
  };

  const cerrar = () => {
    setAbierta(null);
    setElegido(null);
  };

  const asignar = async () => {
    if (!abierta || !elegido || enviando) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/compras-propias/asignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: abierta.id, sellerId: elegido.id, atendio: quienAtiende() }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        showToast(d.error ?? "No se pudo asignar", "error");
      } else {
        showToast(`${clp(abierta.total)} asignado a ${staffDisplayName(elegido.name)} ✓`, "success");
      }
      cerrar();
      void cargar();
    } catch {
      showToast("Sin conexión. Reintenta con red.", "error");
    } finally {
      setEnviando(false);
    }
  };

  if (compras.length === 0) return null;
  const total = compras.reduce((a, c) => a + Number(c.total), 0);

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10">
      <button
        type="button"
        onClick={() => plegar(!plegada)}
        aria-expanded={!plegada}
        className="w-full min-h-14 px-4 flex items-center gap-3 text-left"
      >
        <span className="flex-1 text-sm font-black text-amber-200">
          {compras.length === 1 ? "1 compra propia sin dueño" : `${compras.length} compras propias sin dueño`}{" "}
          <span className="font-bold text-amber-200/70">({clp(total)})</span>
        </span>
        {plegada ? (
          <ChevronDownIcon className="w-5 h-5 text-amber-200" />
        ) : (
          <ChevronUpIcon className="w-5 h-5 text-amber-200" />
        )}
      </button>

      {!plegada && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-amber-100/70 leading-relaxed">
            Nadie las paga hasta que tengan dueño. Toca una para decir de quién es.
          </p>
          {compras.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setAbierta(c)}
              className="w-full min-h-14 flex items-center gap-3 p-3 rounded-xl bg-black/30 text-left active:bg-black/50"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-white/80">{fechaHora(c.ts)}</span>
                <span className="block text-sm text-white/50 truncate">
                  {resumenProductos(c.sale_items) || "Sin detalle"}
                </span>
              </span>
              <span className="font-black text-amber-300 tabular-nums">{clp(c.total)}</span>
            </button>
          ))}
        </div>
      )}

      {abierta && (
        <Hoja titulo={`Compra propia · ${fechaHora(abierta.ts)}`} onClose={cerrar}>
          <div className="space-y-1">
            {abierta.sale_items.map((i, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-white/80">
                  {i.product_name ?? "Producto"}{" "}
                  <span className="text-white/45">× {Number(i.quantity).toLocaleString("es-CL")}</span>
                </span>
                <span className="tabular-nums text-white">{clp(i.subtotal)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-white/10">
              <span className="text-sm font-black uppercase text-white/60">Total</span>
              <span className="text-xl font-black text-amber-300 tabular-nums">{clp(abierta.total)}</span>
            </div>
            {abierta.seller_name && (
              <p className="text-sm text-white/50">Quedó a nombre de: {abierta.seller_name}</p>
            )}
          </div>

          <p className="text-xs font-black uppercase tracking-widest text-white/50">¿De quién es?</p>
          <div className="grid grid-cols-2 gap-2">
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setElegido(s)}
                aria-pressed={elegido?.id === s.id}
                className={`min-h-14 rounded-xl text-lg font-black border ${
                  elegido?.id === s.id
                    ? "bg-amber-400 text-black border-amber-300"
                    : "bg-white/5 text-white border-white/10 active:bg-white/10"
                }`}
              >
                {staffDisplayName(s.name)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={cerrar}
              className="min-h-14 rounded-2xl bg-white/5 text-white/70 text-sm font-black uppercase tracking-widest"
            >
              No sé
            </button>
            <button
              type="button"
              onClick={() => void asignar()}
              disabled={!elegido || enviando}
              className="min-h-14 px-2 rounded-2xl bg-amber-400 text-black text-sm font-black disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {enviando && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
              {elegido
                ? `Asignar ${clp(abierta.total)} a ${staffDisplayName(elegido.name)}`
                : "Elige a la persona"}
            </button>
          </div>
          <p className="text-xs text-white/40">&quot;No sé&quot; la deja para que la asigne el administrador.</p>
        </Hoja>
      )}
    </div>
  );
}
