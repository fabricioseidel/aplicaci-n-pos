"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon, ArrowPathIcon, ArrowUturnLeftIcon, CheckCircleIcon, ExclamationTriangleIcon,
  MagnifyingGlassIcon, QrCodeIcon,
} from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchFicha, patchProduct, saveProduct, ProductConflictError, ProductExistsError, type Ficha,
} from "@/services/products";
import { revisarPrecio } from "@/lib/products/edicion";
import { searchProducts } from "@/lib/pos/search";
import type { ProductUI } from "@/types";
import Confirmar, { type AccionConfirmar } from "./Confirmar";
import { useEscaneoProductos } from "./useEscaneoProductos";

const CLAVE = "pos.listaPrecios.v1";
const clp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`;

export interface LineaLista {
  barcode: string;
  nombre: string;
  antes: number | null;
  despues: number;
  estado: "ok" | "error" | "deshecho";
  error?: string;
  hora: number;
}

function leer(): LineaLista[] {
  try {
    const raw = localStorage.getItem(CLAVE);
    const v = raw ? (JSON.parse(raw) as { lineas?: LineaLista[] }) : null;
    return Array.isArray(v?.lineas) ? v!.lineas : [];
  } catch {
    return [];
  }
}

function escribir(lineas: LineaLista[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ lineas: lineas.slice(0, 200) }));
  } catch {
    /* sin localStorage: la lista vale para esta pantalla */
  }
}

type Actual =
  | { tipo: "ficha"; ficha: Ficha }
  | { tipo: "nuevo"; barcode: string };

/**
 * "Llegó lista nueva": escanear → el precio ya está seleccionado → tipear →
 * Enter guarda → esperar el siguiente escaneo. Sin toques.
 *
 * Debajo queda la lista de lo cambiado ("Coca lata $1.000 → $1.100 ✓") con
 * "Deshacer el último". Lo que no se pudo guardar (sin red, o alguien cambió
 * el precio entretanto) queda marcado para reintentar; la lista vive en el
 * teléfono para que no se pierda si se cierra la app.
 */
export default function ListaPrecios({
  catalogo,
  branchId,
  onSalir,
  onGuardado,
}: {
  catalogo: ProductUI[];
  branchId: string | null;
  onSalir: () => void;
  onGuardado: (p: ProductUI) => void;
}) {
  const { showToast } = useToast();
  const [lineas, setLineas] = useState<LineaLista[]>([]);
  const [actual, setActual] = useState<Actual | null>(null);
  const [precio, setPrecio] = useState<number | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [confirmar, setConfirmar] = useState<{ titulo: string; avisos?: string[]; acciones: AccionConfirmar[] } | null>(null);
  const precioRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLineas(leer()), []);
  const actualizarLineas = (fn: (prev: LineaLista[]) => LineaLista[]) =>
    setLineas((prev) => {
      const next = fn(prev);
      escribir(next);
      return next;
    });

  const precioAntes = actual?.tipo === "ficha" ? Number(actual.ficha.fila.sale_price) || null : null;
  const pendiente = actual !== null && precio !== null && precio !== precioAntes;

  const cargar = useCallback(
    async (code: string) => {
      setCargando(true);
      setBusqueda("");
      try {
        const f = await fetchFicha(code, branchId);
        if (f) {
          setActual({ tipo: "ficha", ficha: f });
          setPrecio(Number(f.fila.sale_price) || null);
        } else {
          setActual({ tipo: "nuevo", barcode: code });
          setPrecio(null);
          setNombreNuevo("");
        }
      } catch {
        showToast("Sin conexión: no se puede abrir el producto", "error");
      } finally {
        setCargando(false);
        setTimeout(() => precioRef.current?.focus(), 50);
      }
    },
    [branchId, showToast]
  );

  const guardar = async (exp?: Record<string, unknown>) => {
    if (!actual || precio === null || guardando) return;
    setGuardando(true);
    const hora = Date.now();
    try {
      if (actual.tipo === "nuevo") {
        const nombre = nombreNuevo.trim();
        if (!nombre) {
          showToast("Escribe el nombre del producto nuevo", "error");
          return;
        }
        await saveProduct({ barcode: actual.barcode, name: nombre, sale_price: precio, is_active: true }, { crear: true });
        const f = await fetchFicha(actual.barcode, branchId).catch(() => null);
        if (f) onGuardado(f.producto);
        actualizarLineas((prev) => [
          { barcode: actual.barcode, nombre, antes: null, despues: precio, estado: "ok", hora },
          ...prev,
        ]);
      } else {
        const fila = actual.ficha.fila;
        const r = await patchProduct(fila.barcode, { sale_price: precio }, exp ?? { sale_price: fila.sale_price ?? null });
        onGuardado(r.producto);
        actualizarLineas((prev) => [
          { barcode: fila.barcode, nombre: r.producto.name, antes: precioAntes, despues: precio, estado: "ok", hora },
          ...prev,
        ]);
      }
      setActual(null);
      setPrecio(null);
    } catch (e) {
      if (e instanceof ProductConflictError && actual.tipo === "ficha") {
        const ahora = Number(e.fila.sale_price);
        setConfirmar({
          titulo: e.message,
          avisos: [`Ahora está a ${clp(ahora)}. Tú pusiste ${clp(precio)}.`],
          acciones: [
            {
              label: `Dejar ${clp(precio)}`,
              tono: "primario",
              onClick: () => {
                setConfirmar(null);
                setActual({ tipo: "ficha", ficha: { ...actual.ficha, fila: e.fila, producto: e.producto } });
                void guardar({ sale_price: e.fila.sale_price ?? null });
              },
            },
            {
              label: `Dejar ${clp(ahora)}`,
              tono: "neutro",
              onClick: () => {
                setConfirmar(null);
                setActual(null);
                setPrecio(null);
              },
            },
          ],
        });
        return;
      }
      if (e instanceof ProductExistsError) {
        void cargar(e.existente.barcode);
        return;
      }
      const nombre = actual.tipo === "ficha" ? actual.ficha.producto.name : nombreNuevo || actual.barcode;
      actualizarLineas((prev) => [
        {
          barcode: actual.tipo === "ficha" ? actual.ficha.fila.barcode : actual.barcode,
          nombre,
          antes: precioAntes,
          despues: precio,
          estado: "error",
          error: e instanceof Error ? e.message : "No se guardó",
          hora,
        },
        ...prev,
      ]);
      showToast(`No se guardó ${nombre}: queda en la lista para reintentar`, "error", 5000);
      setActual(null);
      setPrecio(null);
    } finally {
      setGuardando(false);
    }
  };

  const intentarGuardar = () => {
    if (!actual || precio === null) return;
    if (precio <= 0) return showToast("El precio tiene que ser mayor que 0", "error");
    if (actual.tipo === "ficha" && precio === precioAntes) {
      setActual(null);
      setPrecio(null);
      return;
    }
    const avisos = revisarPrecio(precioAntes, precio);
    if (avisos.length > 0) {
      setConfirmar({
        titulo: "¿Seguro?",
        avisos,
        acciones: [
          { label: "Sí, guardar", tono: "primario", onClick: () => { setConfirmar(null); void guardar(); } },
          { label: "Corregir", tono: "neutro", onClick: () => { setConfirmar(null); precioRef.current?.focus(); } },
        ],
      });
      return;
    }
    void guardar();
  };

  const onScan = (code: string) => {
    const codigoActual = actual?.tipo === "ficha" ? actual.ficha.fila.barcode : actual?.barcode;
    if (code === codigoActual) return;
    if (pendiente) {
      const nombre = actual?.tipo === "ficha" ? actual.ficha.producto.name : nombreNuevo || "el producto nuevo";
      setConfirmar({
        titulo: `No guardaste ${nombre} (${clp(precio)})`,
        acciones: [
          { label: "Guardar y seguir", tono: "primario", onClick: () => { setConfirmar(null); void guardar().then(() => cargar(code)); } },
          { label: "Descartar", tono: "peligro", onClick: () => { setConfirmar(null); void cargar(code); } },
        ],
      });
      return;
    }
    void cargar(code);
  };
  useEscaneoProductos({ enabled: !confirmar && !guardando, onScan });

  // Lo último que se puede deshacer: un cambio de precio (un alta no tiene "antes").
  const ultimoOk = lineas.find((l) => l.estado === "ok" && l.antes !== null);
  const deshacerUltimo = async () => {
    if (!ultimoOk || ultimoOk.antes === null) return;
    try {
      const r = await patchProduct(ultimoOk.barcode, { sale_price: ultimoOk.antes }, { sale_price: ultimoOk.despues });
      onGuardado(r.producto);
      actualizarLineas((prev) => prev.map((l) => (l === ultimoOk ? { ...l, estado: "deshecho" } : l)));
      showToast(`↩ ${ultimoOk.nombre} volvió a ${clp(ultimoOk.antes)}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo deshacer", "error");
    }
  };

  const reintentar = async (l: LineaLista) => {
    try {
      const f = await fetchFicha(l.barcode, branchId);
      if (!f) throw new Error("Ya no existe");
      const r = await patchProduct(l.barcode, { sale_price: l.despues }, { sale_price: f.fila.sale_price ?? null });
      onGuardado(r.producto);
      actualizarLineas((prev) =>
        prev.map((x) => (x === l ? { ...x, antes: Number(f.fila.sale_price) || null, estado: "ok", error: undefined } : x))
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo", "error");
    }
  };

  const resultados = useMemo(
    () => (busqueda.trim().length >= 2 ? searchProducts(catalogo, busqueda).slice(0, 6) : []),
    [busqueda, catalogo]
  );

  return (
    <div className="max-w-xl mx-auto w-full p-4 space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button onClick={onSalir} className="flex items-center gap-1.5 h-11 px-3 -ml-3 text-xs font-black uppercase tracking-widest text-white/60">
          <ArrowLeftIcon className="w-5 h-5" /> Salir
        </button>
        <h1 className="flex-1 text-right text-sm font-black uppercase tracking-widest text-emerald-400">Lista de precios</h1>
      </div>

      {!actual && (
        <div className="rounded-3xl border-2 border-dashed border-emerald-500/40 p-6 text-center space-y-3">
          {cargando ? (
            <ArrowPathIcon className="w-10 h-10 mx-auto text-emerald-400 animate-spin" />
          ) : (
            <QrCodeIcon className="w-10 h-10 mx-auto text-emerald-400" />
          )}
          <p className="text-lg font-black">Escanea el producto</p>
          <p className="text-sm text-white/45">Tipeas el precio nuevo y Enter guarda.</p>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="…o búscalo por nombre"
              data-laser-passthrough
              className="w-full bg-black border border-white/15 rounded-xl h-12 pl-10 pr-3 text-base text-white outline-none focus:border-emerald-500"
            />
          </div>
          {resultados.length > 0 && (
            <ul className="text-left space-y-1.5">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => void cargar(p.barcode || p.id)}
                    className="w-full min-h-[3rem] flex items-center justify-between gap-2 bg-white/5 rounded-xl px-3 border border-white/10"
                  >
                    <span className="truncate font-bold">{p.name}</span>
                    <span className="shrink-0 font-black text-emerald-400">{clp(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {actual && (
        <div className="rounded-3xl border-2 border-emerald-500/50 bg-emerald-500/5 p-5 space-y-3">
          {actual.tipo === "ficha" ? (
            <>
              <p className="text-xl font-black leading-tight">{actual.ficha.producto.name}</p>
              <p className="text-sm text-white/50">
                Precio actual <strong className="text-white text-lg">{clp(precioAntes)}</strong>
                {Number(actual.ficha.fila.offer_price) > 0 && (
                  <span className="ml-2 text-amber-300 font-bold">
                    · en oferta a {clp(Number(actual.ficha.fila.offer_price))} (manda la oferta)
                  </span>
                )}
                {actual.ficha.fila.is_active === false && <span className="ml-2 text-amber-300 font-bold">· desactivado</span>}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-black text-amber-300">Código nuevo: {actual.barcode}</p>
              <input
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                placeholder="Nombre del producto"
                data-scan-guard
                className="w-full bg-black border border-white/15 rounded-xl h-12 px-3 text-base text-white outline-none focus:border-emerald-500"
              />
            </>
          )}
          <div className="flex items-center gap-2">
            <span className="text-3xl font-black text-white/40">$</span>
            <MoneyInput
              ref={precioRef}
              aria-label="Precio nuevo"
              value={precio}
              onChange={setPrecio}
              onEnter={intentarGuardar}
              autoFocus
              enterKeyHint="done"
              className="flex-1 min-w-0 bg-black border-2 border-emerald-500/60 rounded-2xl px-4 h-16 text-4xl font-black text-white outline-none focus:border-emerald-400 tabular-nums"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setActual(null);
                setPrecio(null);
              }}
              className="flex-1 min-h-[3.25rem] rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest"
            >
              Saltar
            </button>
            <button
              onClick={intentarGuardar}
              disabled={guardando || precio === null}
              className="flex-[2] min-h-[3.25rem] rounded-2xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {guardando && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
              Guardar (Enter)
            </button>
          </div>
        </div>
      )}

      {lineas.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-widest text-white/40">
              Cambiados ({lineas.filter((l) => l.estado === "ok").length})
            </p>
            <div className="flex gap-2">
              {ultimoOk && ultimoOk.antes !== null && (
                <button
                  onClick={() => void deshacerUltimo()}
                  className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-[11px] font-black uppercase tracking-widest text-white/70 flex items-center gap-1.5"
                >
                  <ArrowUturnLeftIcon className="w-4 h-4" /> Deshacer {ultimoOk.nombre.split(" ").slice(0, 2).join(" ")}
                </button>
              )}
              <button
                onClick={() => actualizarLineas(() => [])}
                className="h-10 px-3 text-[11px] font-black uppercase tracking-widest text-white/35"
              >
                Limpiar
              </button>
            </div>
          </div>
          <ul className="space-y-1.5">
            {lineas.map((l) => (
              <li
                key={`${l.barcode}-${l.hora}`}
                className={`flex items-center gap-2 rounded-xl px-3 min-h-[3rem] border ${
                  l.estado === "error"
                    ? "bg-red-500/10 border-red-500/30"
                    : l.estado === "deshecho"
                      ? "bg-white/5 border-white/5 opacity-50"
                      : "bg-white/5 border-white/10"
                }`}
              >
                {l.estado === "error" ? (
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0" />
                ) : (
                  <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate text-sm font-bold">{l.nombre}</span>
                <span className={`shrink-0 text-sm tabular-nums ${l.estado === "deshecho" ? "line-through" : ""}`}>
                  {clp(l.antes)} → <strong>{clp(l.despues)}</strong>
                </span>
                {l.estado === "error" && (
                  <button
                    onClick={() => void reintentar(l)}
                    className="shrink-0 h-9 px-2 rounded-lg bg-red-500/20 text-[10px] font-black uppercase text-red-200"
                  >
                    Reintentar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmar && <Confirmar {...confirmar} />}
    </div>
  );
}
