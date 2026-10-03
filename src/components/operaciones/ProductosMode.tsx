"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  MagnifyingGlassIcon, XMarkIcon, PlusIcon, ScaleIcon, CameraIcon, ArchiveBoxIcon,
  CheckCircleIcon, ListBulletIcon, ClockIcon, ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useToast } from "@/contexts/ToastContext";
import { useBranch } from "@/contexts/BranchContext";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import {
  fetchCategorias, fetchInactivos, fetchProductByBarcode, patchProduct,
} from "@/services/products";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import type { ProductUI } from "@/types";
import { searchProducts } from "@/lib/pos/search";
import {
  contarFiltros, cumpleFiltro, ETIQUETA_FILTRO, filtrosParaRol, type FiltroProducto,
} from "@/lib/products/filtros";
import FichaProducto, { type ResultadoFicha } from "./productos/FichaProducto";
import ListaPrecios from "./productos/ListaPrecios";
import CambiosHoy from "./productos/CambiosHoy";
import { useEscaneoProductos } from "./productos/useEscaneoProductos";

const PAGE_SIZE = 40;
const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
/** Un texto que parece código de barras (o código interno) y no un nombre. */
const pareceCodigo = (t: string) => /^[0-9]{4,}$|^INT-/i.test(t.trim());

type Vista =
  | { tipo: "lista" }
  | { tipo: "ficha"; barcode?: string; nuevo?: { barcode?: string; name?: string }; clave: number }
  | { tipo: "listaPrecios" }
  | { tipo: "cambios" };

/**
 * Productos: buscar, escanear y editar.
 *
 * - Escanear con el láser, sin tocar nada, abre la ficha del producto (o un
 *   alta con el código puesto, o la ficha del desactivado con "Reactivar").
 * - Filtros con contador para encontrar lo incompleto: sin precio, sin costo,
 *   inactivos, con oferta…
 * - "Lista de precios" para cuando llega una lista nueva: escanear, tipear, Enter.
 * - "Cambiados hoy": quién cambió qué precio.
 */
export default function ProductosMode() {
  const { showToast } = useToast();
  const { data: session } = useSession();
  const esAdmin = (session?.user?.role ?? "").toString().toUpperCase() === "ADMIN";
  const { currentBranch } = useBranch();
  const branchId = currentBranch?.id ?? null;
  const { products, loading, fromCache, upsertLocal } = useProductCatalog();

  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [filtro, setFiltro] = useState<FiltroProducto | null>(null);
  const [inactivos, setInactivos] = useState<ProductUI[] | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const [reactivando, setReactivando] = useState<string | null>(null);

  const cargarInactivos = useCallback(() => {
    fetchInactivos()
      .then(setInactivos)
      .catch(() => setInactivos(null));
  }, []);

  useEffect(() => {
    cargarInactivos();
    void fetchCategorias().then(setCategorias);
  }, [cargarInactivos]);

  useEffect(() => {
    if (!ultimo) return;
    const t = setTimeout(() => setUltimo(null), 6000);
    return () => clearTimeout(t);
  }, [ultimo]);

  const filtros = filtrosParaRol(esAdmin);
  const contadores = useMemo(
    () => contarFiltros(products, filtros, inactivos?.length ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, inactivos, esAdmin]
  );

  const filtered = useMemo(() => {
    const base =
      filtro === "inactivos" ? inactivos ?? [] : filtro ? products.filter((p) => cumpleFiltro(p, filtro)) : products;
    return searchProducts(base, query);
  }, [filtro, inactivos, products, query]);

  const abrir = useCallback(
    async (code: string) => {
      setCamara(false);
      const enCatalogo = products.some((p) => p.id === code || p.barcode === code);
      if (enCatalogo) {
        setVista({ tipo: "ficha", barcode: code, clave: Date.now() });
        return;
      }
      const existente = await fetchProductByBarcode(code).catch(() => null);
      if (existente) {
        if (existente.isActive === false) showToast(`${existente.name} está desactivado`, "warning", 3000);
        setVista({ tipo: "ficha", barcode: existente.barcode || code, clave: Date.now() });
      } else {
        showToast(`Código nuevo: ${code}`, "info", 2000);
        setVista({ tipo: "ficha", nuevo: { barcode: code }, clave: Date.now() });
      }
    },
    [products, showToast]
  );

  useEscaneoProductos({ enabled: vista.tipo === "lista" && !camara, onScan: (c) => void abrir(c) });

  const alGuardar = (p: ProductUI) => {
    upsertLocal(p);
    setInactivos((prev) => {
      if (!prev) return prev;
      const sin = prev.filter((x) => x.id !== p.id);
      return p.isActive === false ? [p, ...sin] : sin;
    });
  };

  const cerrarFicha = (r?: ResultadoFicha) => {
    if (r) {
      alGuardar(r.producto);
      setUltimo(`✓ ${r.resumen}`);
    }
    setVista({ tipo: "lista" });
  };

  const nuevo = () => {
    const t = query.trim();
    setVista({
      tipo: "ficha",
      nuevo: t ? (pareceCodigo(t) ? { barcode: t } : { name: t }) : {},
      clave: Date.now(),
    });
  };

  const reactivar = async (p: ProductUI) => {
    setReactivando(p.id);
    try {
      const r = await patchProduct(p.barcode || p.id, { is_active: true }, { is_active: false });
      alGuardar(r.producto);
      setUltimo(`✓ ${r.producto.name} reactivado`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo reactivar", "error");
    } finally {
      setReactivando(null);
    }
  };

  // ── Vistas ────────────────────────────────────────────────────────────
  if (vista.tipo === "ficha") {
    return (
      <FichaProducto
        key={vista.clave}
        barcode={vista.barcode}
        nuevo={vista.nuevo}
        esAdmin={esAdmin}
        branchId={branchId}
        categorias={categorias}
        onClose={cerrarFicha}
        onAbrirOtro={(code) => void abrir(code)}
      />
    );
  }
  if (vista.tipo === "listaPrecios") {
    return (
      <ListaPrecios
        catalogo={products}
        branchId={branchId}
        onSalir={() => setVista({ tipo: "lista" })}
        onGuardado={alGuardar}
      />
    );
  }
  if (vista.tipo === "cambios") {
    return <CambiosHoy onVolver={() => setVista({ tipo: "lista" })} />;
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="p-3 space-y-2 border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-20">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
            <input
              type="text"
              placeholder="Buscar o escanear…"
              data-laser-passthrough
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE_SIZE);
              }}
              onKeyDown={(e) => {
                // Un código tipeado a mano (o leído por un lector lento) + Enter abre la ficha.
                if (e.key === "Enter" && /^[0-9]{6,}$/.test(query.trim())) {
                  e.preventDefault();
                  const code = query.trim();
                  setQuery("");
                  void abrir(code);
                }
              }}
              className="w-full bg-white/5 border border-white/10 rounded-xl h-12 pl-10 pr-10 text-white text-base outline-none focus:border-emerald-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-white/50 p-2"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setCamara(true)}
            aria-label="Escanear con la cámara"
            className="w-12 h-12 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center"
          >
            <CameraIcon className="h-6 w-6" />
          </button>
          <button
            onClick={nuevo}
            className="flex items-center gap-1 px-3 h-12 shrink-0 bg-emerald-500 text-black rounded-xl text-xs font-black uppercase tracking-widest"
          >
            <PlusIcon className="w-5 h-5" /> Nuevo
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setVista({ tipo: "listaPrecios" })}
            className="h-11 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest text-white/80 flex items-center justify-center gap-2"
          >
            <ListBulletIcon className="w-5 h-5" /> Lista de precios
          </button>
          <button
            onClick={() => setVista({ tipo: "cambios" })}
            className="h-11 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest text-white/80 flex items-center justify-center gap-2"
          >
            <ClockIcon className="w-5 h-5" /> Cambiados hoy
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3" role="group" aria-label="Filtros">
          {filtros.map((f) => {
            const activo = filtro === f;
            const n = contadores[f];
            return (
              <button
                key={f}
                type="button"
                aria-pressed={activo}
                onClick={() => {
                  setFiltro(activo ? null : f);
                  setVisible(PAGE_SIZE);
                  if (f === "inactivos" && !activo) cargarInactivos();
                }}
                className={`shrink-0 h-10 px-3 rounded-full border text-xs font-black whitespace-nowrap ${
                  activo
                    ? "bg-emerald-500 border-emerald-400 text-black"
                    : n
                      ? "bg-white/5 border-white/15 text-white/80"
                      : "bg-white/[0.02] border-white/5 text-white/35"
                }`}
              >
                {ETIQUETA_FILTRO[f]}
                {n !== null && n !== undefined && <span className="ml-1.5 tabular-nums">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {ultimo && (
        <div
          role="status"
          className="mx-3 mt-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-3 flex items-center gap-3"
        >
          <CheckCircleIcon className="w-7 h-7 text-emerald-400 shrink-0" />
          <p className="text-base font-black text-emerald-100">{ultimo.replace(/^✓ /, "")}</p>
        </div>
      )}

      {fromCache && (
        <p className="px-3 py-2 text-xs font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
          Sin conexión: se puede mirar, no guardar
        </p>
      )}

      <div className="p-3 space-y-2">
        {loading && (
          <p className="py-10 text-center text-white/30 text-xs font-black uppercase tracking-widest animate-pulse">
            Cargando…
          </p>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center text-white/30">
            <ArchiveBoxIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-xs font-black uppercase tracking-widest">
              {filtro === "inactivos" && inactivos === null ? "Sin conexión" : "Sin resultados"}
            </p>
          </div>
        )}

        {filtered.slice(0, visible).map((p) => {
          const inactivo = p.isActive === false;
          const oferta = Number(p.offerPrice) > 0;
          return (
            <div
              key={p.id}
              className="flex items-center gap-2 bg-white/5 border border-white/5 rounded-2xl pr-2"
            >
              <button
                onClick={() => setVista({ tipo: "ficha", barcode: p.barcode || p.id, clave: Date.now() })}
                className="flex-1 min-w-0 flex items-center gap-3 p-3 text-left"
              >
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas */}
                  <img src={p.image} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-[11px] font-mono text-white/40 truncate">
                    {p.id} · stock {p.stock.toLocaleString("es-CL")}
                    {p.byWeight ? " kg" : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {oferta ? (
                    <>
                      <p className="text-[11px] text-white/40 line-through tabular-nums">{clp(p.price)}</p>
                      <p className="text-base font-black text-amber-300 tabular-nums">{clp(Number(p.offerPrice))}</p>
                      <span className="text-[9px] font-black uppercase text-amber-300">Oferta</span>
                    </>
                  ) : (
                    <p className={`text-base font-black tabular-nums ${p.price > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.price > 0 ? clp(p.price) : "Sin precio"}
                    </p>
                  )}
                  {p.byWeight && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase text-emerald-300/70">
                      <ScaleIcon className="w-3 h-3" /> por kg
                    </span>
                  )}
                </div>
              </button>
              {inactivo && (
                <button
                  onClick={() => void reactivar(p)}
                  disabled={reactivando === p.id}
                  className="shrink-0 h-12 px-3 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center gap-1"
                >
                  {reactivando === p.id && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
                  Reactivar
                </button>
              )}
            </div>
          );
        })}

        {!loading && visible < filtered.length && (
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="w-full h-12 text-xs font-black uppercase tracking-widest text-emerald-500"
          >
            + {filtered.length - visible} más
          </button>
        )}
      </div>

      {camara && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md relative">
            <button
              onClick={() => setCamara(false)}
              aria-label="Cerrar escáner"
              className="absolute -top-12 right-0 p-2 bg-white/10 rounded-xl text-white"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            <UnifiedScanner onDetected={(code) => void abrir(code)} />
          </div>
        </div>
      )}
    </div>
  );
}
