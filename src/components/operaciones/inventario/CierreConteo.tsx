"use client";

import React, { useEffect, useState } from "react";
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Confirmar from "@/components/operaciones/productos/Confirmar";
import { numeroConfirmado, type ModoCierre } from "@/lib/inventario/conteo";

interface Resumen {
  sessionId: string;
  applyMode: "ON_CLOSE" | "LIVE";
  contados: number;
  pendientes: number;
  movidosDesdeElConteo: number;
}

const n = (x: number) => x.toLocaleString("es-CL");

/**
 * Cierre del conteo, con dos salidas muy distintas:
 *
 * - **Solo aplicar lo escaneado** (por defecto, cualquiera): conteo de una
 *   góndola. Lo no escaneado queda como estaba.
 * - **Conteo total** (solo ADMIN): además pone en 0 y saca del catálogo todo
 *   lo que no se escaneó. Se confirma escribiendo cuántos productos son, con
 *   la lista a la vista.
 */
export default function CierreConteo({
  resumen,
  esAdmin,
  hayLineasSinGuardar,
  cerrando,
  onCerrar,
}: {
  resumen: Resumen;
  esAdmin: boolean;
  hayLineasSinGuardar: boolean;
  cerrando: boolean;
  onCerrar: (modo: ModoCierre, esperadoPendientes?: number) => void;
}) {
  const [confirmarEscaneado, setConfirmarEscaneado] = useState(false);
  const [total, setTotal] = useState(false);
  const p = resumen.pendientes;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 mt-4">
      <p className="text-sm font-black text-white">Cerrar conteo</p>
      {hayLineasSinGuardar && (
        <p className="text-xs text-amber-300">Guarda primero lo que tienes en la lista de arriba.</p>
      )}

      <button
        onClick={() => setConfirmarEscaneado(true)}
        disabled={cerrando || hayLineasSinGuardar || resumen.contados === 0}
        className="w-full min-h-14 rounded-2xl bg-emerald-500 text-black px-4 py-3 text-left disabled:bg-white/10 disabled:text-white/40"
      >
        <span className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
          <CheckCircleIcon className="w-5 h-5 shrink-0" /> Solo aplicar lo escaneado
        </span>
        <span className="block text-xs font-bold opacity-70 mt-0.5">
          {n(resumen.contados)} contados quedan con lo registrado. Lo demás no cambia.
        </span>
      </button>

      {esAdmin ? (
        <button
          onClick={() => setTotal(true)}
          disabled={cerrando || hayLineasSinGuardar}
          className="w-full min-h-12 rounded-2xl border border-red-500/40 bg-red-500/5 text-red-300 px-4 py-3 text-left disabled:opacity-40"
        >
          <span className="block text-xs font-black uppercase tracking-widest">
            Conteo total: poner en 0 lo no contado
          </span>
          <span className="block text-[11px] text-red-200/60 mt-0.5">
            Solo si recorriste TODA la tienda. {n(p)} productos sin contar quedarían en 0 y fuera del catálogo.
          </span>
        </button>
      ) : (
        <p className="text-[11px] text-white/40">
          Poner en 0 lo no contado (conteo total de la tienda) lo hace un administrador.
        </p>
      )}

      {confirmarEscaneado && (
        <Confirmar
          titulo="¿Aplicar lo escaneado?"
          avisos={[
            `${n(resumen.contados)} productos quedan con la cantidad contada` +
              (resumen.applyMode === "ON_CLOSE" ? ", menos lo vendido después de contarlos." : "."),
            "Los contados en 0 salen del catálogo.",
            `Los ${n(p)} que no escaneaste no cambian.`,
          ]}
          acciones={[
            {
              label: "Sí, aplicar y cerrar",
              tono: "primario",
              onClick: () => {
                setConfirmarEscaneado(false);
                onCerrar("escaneado");
              },
            },
            { label: "Volver", tono: "neutro", onClick: () => setConfirmarEscaneado(false) },
          ]}
        />
      )}

      {total && (
        <CierreTotal
          resumen={resumen}
          cerrando={cerrando}
          onClose={() => setTotal(false)}
          onConfirmar={(esperado) => {
            setTotal(false);
            onCerrar("todo", esperado);
          }}
        />
      )}
    </div>
  );
}

function CierreTotal({
  resumen,
  cerrando,
  onClose,
  onConfirmar,
}: {
  resumen: Resumen;
  cerrando: boolean;
  onClose: () => void;
  onConfirmar: (esperado: number) => void;
}) {
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState<{ total: number; productos: Array<{ barcode: string; name: string; stock: number }> } | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const p = resumen.pendientes;
  const okNumero = numeroConfirmado(texto, p);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/inventario/conteo/pendientes?sessionId=${encodeURIComponent(resumen.sessionId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelado && setLista(d))
      .catch(() => !cancelado && setErrorLista(true));
    return () => {
      cancelado = true;
    };
  }, [resumen.sessionId]);

  const conStock = lista?.productos.filter((x) => x.stock > 0).length ?? null;

  return (
    <div
      role="dialog"
      aria-label="Conteo total"
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
    >
      <div className="w-full max-w-md bg-[#111] border border-red-500/40 rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto text-white">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="w-7 h-7 text-red-400 shrink-0" />
          <div className="flex-1">
            <h2 className="text-lg font-black leading-snug">Conteo total de la tienda</h2>
            <p className="text-sm text-white/60 mt-1">
              Los <strong className="text-white">{n(resumen.contados)}</strong> contados quedan con lo registrado
              {resumen.applyMode === "ON_CLOSE" ? " (menos lo vendido después)" : ""}.{" "}
              <strong className="text-red-300">
                Los {n(p)} productos que no escaneaste quedan en 0 y salen del catálogo
              </strong>
              : no se van a poder vender hasta que alguien los vuelva a contar o los reactive.
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-12 h-12 -mr-2 -mt-2 flex items-center justify-center text-white/50">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">
            Sin contar{conStock !== null ? ` · ${conStock} con stock hoy` : ""}
          </p>
          {lista ? (
            <ul className="max-h-48 overflow-y-auto space-y-1 text-sm">
              {lista.productos.map((x) => (
                <li key={x.barcode} className="flex justify-between gap-2">
                  <span className="truncate text-white/80">{x.name}</span>
                  <span className={`tabular-nums shrink-0 ${x.stock > 0 ? "text-red-300" : "text-white/30"}`}>
                    {x.stock > 0 ? `${x.stock} → 0` : "0"}
                  </span>
                </li>
              ))}
              {lista.total > lista.productos.length && (
                <li className="text-white/40 text-xs">y {n(lista.total - lista.productos.length)} más…</li>
              )}
            </ul>
          ) : errorLista ? (
            <p className="text-xs text-amber-300">No se pudo cargar la lista (¿sin conexión?).</p>
          ) : (
            <ArrowPathIcon className="w-5 h-5 animate-spin text-white/40" />
          )}
          <p className="text-[11px] text-white/40 mt-2">
            Si ves algo que sí está en la tienda, cierra esto, escanéalo y guárdalo antes de cerrar.
          </p>
        </div>

        <div>
          <label htmlFor="confirmar-total" className="block text-sm font-bold text-white mb-1">
            Para confirmar, escribe <strong className="text-red-300">{n(p)}</strong>
          </label>
          <input
            id="confirmar-total"
            inputMode="numeric"
            autoComplete="off"
            data-scan-guard
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="w-full bg-black border-2 border-red-500/40 rounded-xl px-3 h-14 text-2xl font-black text-white outline-none focus:border-red-400"
          />
        </div>

        <div className="grid gap-2">
          <button
            onClick={() => onConfirmar(p)}
            disabled={!okNumero || cerrando}
            className="w-full h-14 rounded-2xl bg-red-600 text-white text-sm font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-white/30"
          >
            Poner {n(p)} en 0 y cerrar
          </button>
          <button
            onClick={onClose}
            className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 text-white/70 text-sm font-black uppercase tracking-widest"
          >
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
