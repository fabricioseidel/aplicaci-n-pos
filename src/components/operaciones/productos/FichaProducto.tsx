"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon, ArrowPathIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon,
  ScaleIcon, TagIcon, CubeIcon, CameraIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchFicha, patchProduct, saveProduct, ProductConflictError, ProductExistsError,
  type Ficha, type FilaProducto,
} from "@/services/products";
import {
  diffProduct, revisarPrecio, revisarOferta, costoBrutoDesdeNeto, costoNetoDesdeBruto,
  margenSobreVenta,
} from "@/lib/products/edicion";
import { formatMiles, parseCantidad } from "@/lib/num";
import { ofertaVigente } from "@/lib/pos/precios";
import { fechaChile, fechaCorta, finDelDiaChile, hoyChile } from "@/lib/products/oferta";
import type { ProductUI } from "@/types";
import Confirmar, { type AccionConfirmar } from "./Confirmar";
import AjustarStock from "./AjustarStock";
import { useEscaneoProductos } from "./useEscaneoProductos";

const clp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`;

interface Form {
  barcode: string;
  name: string;
  price: number | null;
  offer: number | null;
  verOferta: boolean;
  /** "Oferta hasta" como "YYYY-MM-DD" (día en Chile); "" = sin fecha de término. */
  ofertaHasta: string;
  costoBruto: number | null;
  byWeight: boolean;
  unit: string;
  isActive: boolean;
  category: string;
  minStock: string;
  optimumStock: string;
  description: string;
  imageUrl: string;
  stockInicial: string;
}

function formDesde(f: FilaProducto | null, nuevo?: { barcode?: string; name?: string }): Form {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    barcode: f?.barcode ?? nuevo?.barcode ?? "",
    name: f?.name ?? nuevo?.name ?? "",
    price: f ? num(f.sale_price) : null,
    offer: f ? num(f.offer_price) || null : null,
    verOferta: Boolean(f && Number(f.offer_price) > 0),
    ofertaHasta: fechaChile(f?.offer_ends_at as string | null | undefined),
    costoBruto: f && Number(f.purchase_price) > 0 ? costoBrutoDesdeNeto(Number(f.purchase_price)) : null,
    byWeight: Boolean(f?.by_weight),
    unit: (f?.measurement_unit as string) || "kg",
    isActive: f ? f.is_active !== false : true,
    category: (f?.category as string) ?? "",
    minStock: f?.min_stock === null || f?.min_stock === undefined ? "" : String(f.min_stock),
    optimumStock: f?.optimum_stock === null || f?.optimum_stock === undefined ? "" : String(f.optimum_stock),
    description: (f?.description as string) ?? "",
    imageUrl: (f?.image_url as string) ?? "",
    stockInicial: "",
  };
}

/**
 * Lo que se guarda en `offer_ends_at`. Si la fecha no cambió se devuelve el
 * valor original tal cual (PostgREST lo formatea distinto y si no el diff lo
 * vería como cambio).
 */
function offerEndsAtDe(form: Form, fila: FilaProducto | null): string | null {
  if (!form.verOferta || !form.ofertaHasta) return null;
  const original = (fila?.offer_ends_at as string | null | undefined) ?? null;
  if (original && fechaChile(original) === form.ofertaHasta) return original;
  return finDelDiaChile(form.ofertaHasta);
}

export interface ResultadoFicha {
  producto: ProductUI;
  /** Texto grande que confirma lo guardado: "Coca lata $1.000 → $1.100". */
  resumen: string;
}

interface Props {
  /** Código a editar; sin él, es un alta. */
  barcode?: string;
  nuevo?: { barcode?: string; name?: string };
  esAdmin: boolean;
  branchId: string | null;
  categorias: string[];
  onClose: (resultado?: ResultadoFicha) => void;
  /** El lector leyó otro código: abrir esa ficha (o un alta si no existe). */
  onAbrirOtro: (code: string) => void;
}

const etiqueta = "block text-[11px] font-black uppercase tracking-widest text-white/45 mb-1";
const campo =
  "w-full bg-black border border-white/15 rounded-xl px-3 h-12 text-white text-base outline-none focus:border-emerald-500";

/**
 * Ficha de producto. Arriba lo de todos los días (precio grande ya
 * seleccionado: tipear y Enter guarda), abajo y plegado lo demás.
 *
 * - Guarda SÓLO lo que cambió (PATCH con `expected`): nunca vuelve a borrar el
 *   costo ni los mínimos, y si otra persona cambió el mismo campo, avisa.
 * - El stock se mira; se mueve con "Ajustar stock" y un motivo.
 * - El costo (con IVA) lo ve y lo cambia sólo un ADMIN, y sólo si no lo fija
 *   un proveedor.
 */
export default function FichaProducto({
  barcode, nuevo, esAdmin, branchId, categorias, onClose, onAbrirOtro,
}: Props) {
  const { showToast } = useToast();
  const esAlta = !barcode;

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(!esAlta);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => formDesde(null, nuevo));
  const [masDatos, setMasDatos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState<{ titulo: string; avisos?: string[]; acciones: AccionConfirmar[] } | null>(null);
  const [ajustando, setAjustando] = useState(false);
  const [escaneandoCodigo, setEscaneandoCodigo] = useState(false);

  const cargar = useCallback(async () => {
    if (!barcode) return;
    setCargando(true);
    setErrorCarga(null);
    try {
      const f = await fetchFicha(barcode, branchId);
      if (!f) {
        setErrorCarga("Este producto ya no existe");
        return;
      }
      setFicha(f);
      setForm(formDesde(f.fila));
      setMasDatos(false);
    } catch {
      setErrorCarga("Sin conexión: la ficha no se puede editar hasta recuperar la red");
    } finally {
      setCargando(false);
    }
  }, [barcode, branchId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const set = (p: Partial<Form>) => setForm((prev) => ({ ...prev, ...p }));

  const costoEditable = esAdmin && !ficha?.costoDelProveedor;
  const fila = ficha?.fila ?? null;

  /** Lo editado con nombres de columna, para comparar con la fila original. */
  const editado = useMemo(() => {
    const entero = (t: string) => {
      const n = parseCantidad(t);
      return n === null ? null : Math.round(n);
    };
    const e: Record<string, unknown> = {
      name: form.name,
      sale_price: form.price,
      offer_price: form.verOferta ? form.offer : null,
      offer_ends_at: offerEndsAtDe(form, fila),
      by_weight: form.byWeight,
      is_active: form.isActive,
      category: form.category,
      min_stock: entero(form.minStock),
      optimum_stock: entero(form.optimumStock),
      description: form.description,
      image_url: form.imageUrl,
    };
    if (form.byWeight) e.measurement_unit = form.unit || "kg";
    if (costoEditable && form.costoBruto !== null) {
      const brutoOriginal = fila && Number(fila.purchase_price) > 0 ? costoBrutoDesdeNeto(Number(fila.purchase_price)) : null;
      if (form.costoBruto !== brutoOriginal) e.purchase_price = costoNetoDesdeBruto(form.costoBruto);
    }
    return e;
  }, [form, costoEditable, fila]);

  const diff = useMemo(() => (fila ? diffProduct(fila, editado) : null), [fila, editado]);
  const hayCambios = esAlta ? Boolean(form.name.trim() || form.price) : Boolean(diff && Object.keys(diff.changes).length);

  const resumenDe = (f: FilaProducto | null, nombre: string, precio: number | null) => {
    const antes = f ? Number(f.sale_price) : null;
    if (precio !== null && antes !== null && antes !== precio) return `${nombre} ${clp(antes)} → ${clp(precio)}`;
    return `${nombre} guardado`;
  };

  // ── Guardar ─────────────────────────────────────────────────────────────
  const ejecutarPatch = async (expectedOverride?: Record<string, unknown>) => {
    if (!fila || !diff) return;
    setGuardando(true);
    try {
      const r = await patchProduct(fila.barcode, diff.changes, expectedOverride ?? diff.expected);
      if (r.aviso) showToast(r.aviso, "warning", 6000);
      onClose({ producto: r.producto, resumen: resumenDe(fila, r.producto.name, form.price) });
    } catch (e) {
      if (e instanceof ProductConflictError) {
        const nuevaFila = e.fila;
        setConfirmar({
          titulo: e.message,
          avisos: [
            `Ahora: precio ${clp(Number(nuevaFila.sale_price))}${
              Number(nuevaFila.offer_price) > 0 ? ` · oferta ${clp(Number(nuevaFila.offer_price))}` : ""
            }`,
            `Tu cambio: ${form.price !== null ? `precio ${clp(form.price)}` : "—"}`,
          ],
          acciones: [
            {
              label: "Guardar mi cambio igual",
              tono: "primario",
              onClick: () => {
                setConfirmar(null);
                const exp: Record<string, unknown> = {};
                for (const k of Object.keys(diff.changes)) exp[k] = nuevaFila[k] ?? null;
                void ejecutarPatch(exp);
              },
            },
            {
              label: "Ver lo nuevo",
              tono: "neutro",
              onClick: () => {
                setConfirmar(null);
                void cargar();
              },
            },
          ],
        });
      } else {
        showToast(e instanceof Error ? e.message : "No se pudo guardar", "error");
      }
    } finally {
      setGuardando(false);
    }
  };

  const crear = async () => {
    const code = form.barcode.trim();
    const name = form.name.trim();
    if (!code) return showToast("Falta el código de barras", "error");
    if (!name) return showToast("Falta el nombre", "error");
    if (!form.price || form.price <= 0) return showToast("Falta el precio", "error");
    const stock = form.stockInicial.trim() ? parseCantidad(form.stockInicial) : null;
    setGuardando(true);
    try {
      await saveProduct(
        {
          barcode: code,
          name,
          sale_price: form.price,
          by_weight: form.byWeight,
          measurement_unit: form.byWeight ? form.unit || "kg" : null,
          category: form.category.trim() || null,
          is_active: true,
          ...(stock !== null ? { stock } : {}),
          ...(costoEditable && form.costoBruto ? { purchase_price: costoNetoDesdeBruto(form.costoBruto) } : {}),
        },
        { crear: true }
      );
      const f = await fetchFicha(code, branchId).catch(() => null);
      const producto: ProductUI = f?.producto ?? {
        id: code, barcode: code, name, price: form.price, image: "/file.svg", slug: code,
        description: "", categories: [], stock: stock ?? 0, byWeight: form.byWeight, isActive: true,
      };
      onClose({ producto, resumen: `${name} creado a ${clp(form.price)}` });
    } catch (e) {
      if (e instanceof ProductExistsError) {
        showToast(`${e.message}: te abro su ficha`, "warning", 5000);
        onAbrirOtro(e.existente.barcode);
        return;
      }
      showToast(e instanceof Error ? e.message : "No se pudo crear", "error");
    } finally {
      setGuardando(false);
    }
  };

  const guardar = () => {
    if (guardando || confirmar) return;
    if (!form.name.trim()) return showToast("El nombre no puede quedar vacío", "error");
    if (!form.price || form.price <= 0) return showToast("Falta el precio", "error");

    const avisos: string[] = [];
    const precioAntes = fila ? Number(fila.sale_price) : null;
    if (esAlta || form.price !== precioAntes) avisos.push(...revisarPrecio(precioAntes, form.price));
    if (form.verOferta) avisos.push(...revisarOferta(form.price, form.offer));
    if (form.verOferta && form.ofertaHasta && form.ofertaHasta < hoyChile() && editado.offer_ends_at !== fila?.offer_ends_at) {
      avisos.push(`La fecha de la oferta ya pasó (${fechaCorta(form.ofertaHasta)}): se cobrará el precio normal`);
    }

    const seguir = () => (esAlta ? void crear() : void ejecutarPatch());

    if (!esAlta && !hayCambios) {
      onClose();
      return;
    }
    if (avisos.length > 0) {
      setConfirmar({
        titulo: "¿Seguro?",
        avisos,
        acciones: [
          { label: "Sí, guardar", tono: "primario", onClick: () => { setConfirmar(null); seguir(); } },
          { label: "Corregir", tono: "neutro", onClick: () => setConfirmar(null) },
        ],
      });
      return;
    }
    seguir();
  };

  // ── Escaneo con la ficha abierta ────────────────────────────────────────
  const onScan = (code: string) => {
    if (code === (barcode ?? form.barcode)) {
      showToast("Ya estás en esta ficha", "info", 1500);
      return;
    }
    if (esAlta && !form.barcode.trim() && !form.name.trim()) {
      set({ barcode: code });
      return;
    }
    if (!hayCambios) {
      onAbrirOtro(code);
      return;
    }
    setConfirmar({
      titulo: `No guardaste ${form.name.trim() || "este producto"}`,
      acciones: [
        { label: "Descartar y abrir el otro", tono: "peligro", onClick: () => { setConfirmar(null); onAbrirOtro(code); } },
        { label: "Seguir editando", tono: "neutro", onClick: () => setConfirmar(null) },
      ],
    });
  };
  useEscaneoProductos({ enabled: !ajustando && !confirmar && !escaneandoCodigo, onScan });

  // ── Render ──────────────────────────────────────────────────────────────
  if (cargando) {
    return (
      <p className="py-16 text-center text-white/40 text-xs font-black uppercase tracking-widest animate-pulse">
        Abriendo ficha…
      </p>
    );
  }

  if (errorCarga) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center space-y-4">
        <p className="text-amber-300 font-bold">{errorCarga}</p>
        <div className="flex gap-2 justify-center">
          <button onClick={() => onClose()} className="h-12 px-5 rounded-xl bg-white/5 text-white/70 text-xs font-black uppercase tracking-widest">
            Volver
          </button>
          <button onClick={() => void cargar()} className="h-12 px-5 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const precioUnidad = form.byWeight ? `/ ${form.unit || "kg"}` : "";
  const margen = margenSobreVenta(form.price, form.costoBruto);
  const desactivado = !esAlta && fila?.is_active === false;
  const ofertaVencida = Boolean(
    form.offer && form.ofertaHasta && !ofertaVigente(form.offer, finDelDiaChile(form.ofertaHasta))
  );

  return (
    <div className="max-w-xl mx-auto w-full p-4 space-y-4 pb-32">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onClose()}
          className="flex items-center gap-1.5 h-11 px-3 -ml-3 text-xs font-black uppercase tracking-widest text-white/60 active:text-white"
        >
          <ArrowLeftIcon className="w-5 h-5" /> Volver
        </button>
        <span className="flex-1 text-right text-[11px] font-black uppercase tracking-widest text-emerald-400">
          {esAlta ? "Producto nuevo" : "Ficha"}
        </span>
      </div>

      {desactivado && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-center gap-3">
          <p className="flex-1 text-sm font-bold text-amber-200">
            Este producto está desactivado: no aparece en Venta ni en la tienda.
          </p>
          <button
            type="button"
            onClick={() => set({ isActive: true })}
            disabled={form.isActive}
            className="h-12 px-4 rounded-xl bg-amber-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-40"
          >
            {form.isActive ? "Se reactiva al guardar" : "Reactivar"}
          </button>
        </div>
      )}

      {/* Código y nombre */}
      {esAlta ? (
        <div>
          <label className={etiqueta}>Código de barras</label>
          <div className="flex gap-2">
            <input
              value={form.barcode}
              onChange={(e) => set({ barcode: e.target.value })}
              data-scan-accept
              placeholder="Escanéalo"
              className={`${campo} font-mono flex-1`}
            />
            <button
              type="button"
              onClick={() => setEscaneandoCodigo(true)}
              aria-label="Escanear con la cámara"
              className="w-12 h-12 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center"
            >
              <CameraIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] font-mono text-white/40">{fila?.barcode}</p>
      )}

      <div>
        <label className={etiqueta}>Nombre</label>
        <input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          autoFocus={esAlta && Boolean(form.barcode)}
          className={`${campo} font-bold`}
        />
      </div>

      {/* Precio: lo principal */}
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <label className="block text-xs font-black uppercase tracking-widest text-emerald-300">
          Precio {precioUnidad}
          {!esAlta && fila && (
            <span className="ml-2 normal-case tracking-normal font-bold text-white/40">
              antes {clp(Number(fila.sale_price))}
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black text-white/40">$</span>
          <MoneyInput
            aria-label="Precio"
            value={form.price}
            onChange={(v) => set({ price: v })}
            onEnter={guardar}
            autoFocus={!esAlta}
            enterKeyHint="done"
            className="flex-1 min-w-0 bg-black border-2 border-emerald-500/60 rounded-2xl px-4 h-16 text-4xl font-black text-white outline-none focus:border-emerald-400 tabular-nums"
          />
        </div>
        <p className="text-[11px] text-white/35">Escribe el precio y presiona Enter (Ir) para guardar.</p>
      </div>

      {/* Oferta */}
      {form.verOferta ? (
        <div
          className={`rounded-2xl border p-4 space-y-2 ${
            ofertaVencida ? "border-white/15 bg-white/5" : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <TagIcon className={`w-5 h-5 ${ofertaVencida ? "text-white/40" : "text-amber-300"}`} />
            <p data-testid="banda-oferta" className={`flex-1 text-sm font-bold ${ofertaVencida ? "text-white/60" : "text-amber-200"}`}>
              {!form.offer
                ? "Precio de oferta"
                : ofertaVencida
                  ? `La oferta de ${clp(form.offer)} venció el ${fechaCorta(form.ofertaHasta)}: se cobra el precio normal`
                  : `En oferta a ${clp(form.offer)}${
                      form.ofertaHasta ? ` hasta el ${fechaCorta(form.ofertaHasta)}` : ""
                    }: se cobra este precio, no el normal`}
            </p>
          </div>
          <div className="flex gap-2">
            <MoneyInput
              aria-label="Precio de oferta"
              value={form.offer}
              onChange={(v) => set({ offer: v })}
              onEnter={guardar}
              className="flex-1 min-w-0 bg-black border border-amber-500/40 rounded-xl px-3 h-12 text-xl font-black text-white outline-none focus:border-amber-400"
            />
            <button
              type="button"
              onClick={() => set({ verOferta: false, offer: null, ofertaHasta: "" })}
              className="h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs font-black uppercase tracking-widest"
            >
              Quitar oferta
            </button>
          </div>
          <div>
            <label htmlFor="oferta-hasta" className={etiqueta}>
              Oferta hasta (opcional)
            </label>
            <div className="flex gap-2">
              <input
                id="oferta-hasta"
                type="date"
                value={form.ofertaHasta}
                min={esAlta ? hoyChile() : undefined}
                onChange={(e) => set({ ofertaHasta: e.target.value })}
                data-scan-guard
                className={`${campo} flex-1 min-w-0 [color-scheme:dark]`}
              />
              {form.ofertaHasta && (
                <button
                  type="button"
                  onClick={() => set({ ofertaHasta: "" })}
                  className="h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs font-black uppercase tracking-widest"
                >
                  Sin fecha
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-white/35">
              {form.ofertaHasta
                ? `Vale todo el ${fechaCorta(form.ofertaHasta)}; después se cobra el precio normal solo.`
                : "Sin fecha, la oferta sigue hasta que la quites."}
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => set({ verOferta: true })}
          className="h-11 text-xs font-black uppercase tracking-widest text-amber-300/80"
        >
          + Poner en oferta
        </button>
      )}

      {/* Costo: sólo ADMIN */}
      {esAdmin && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
          <label className={etiqueta}>Costo con IVA (lo que se paga)</label>
          {ficha?.costoDelProveedor ? (
            <p className="text-sm text-white/70">
              <strong className="text-white">{clp(form.costoBruto)}</strong> · lo fija el proveedor. Se cambia en
              OlivoWeb → Precios.
            </p>
          ) : (
            <MoneyInput
              aria-label="Costo con IVA"
              value={form.costoBruto}
              onChange={(v) => set({ costoBruto: v })}
              onEnter={guardar}
              placeholder="Sin costo"
              className={`${campo} text-xl font-black`}
            />
          )}
          <p className={`text-sm font-bold ${margen === null ? "text-white/35" : margen < 0.15 ? "text-red-300" : "text-emerald-300"}`}>
            {margen === null ? "Margen: falta el costo" : `Margen ${Math.round(margen * 100)} %`}
          </p>
        </div>
      )}

      {/* Stock: sólo para mirar */}
      {!esAlta ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center gap-3">
          <CubeIcon className="w-6 h-6 text-white/40" />
          <div className="flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-white/45">Stock aquí</p>
            <p className="text-2xl font-black tabular-nums">
              {Number(ficha?.stockSucursal ?? 0).toLocaleString("es-CL")}
              {form.byWeight ? ` ${form.unit || "kg"}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAjustando(true)}
            className="h-12 px-4 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-black uppercase tracking-widest"
          >
            Ajustar stock
          </button>
        </div>
      ) : (
        <div>
          <label className={etiqueta}>Stock inicial (opcional)</label>
          <input
            inputMode="decimal"
            value={form.stockInicial}
            onChange={(e) => set({ stockInicial: e.target.value })}
            data-scan-guard
            placeholder="0"
            className={campo}
          />
        </div>
      )}

      {/* Interruptores */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={form.byWeight}
          onClick={() => set({ byWeight: !form.byWeight })}
          className={`h-14 rounded-xl border text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
            form.byWeight ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "bg-white/5 border-white/10 text-white/50"
          }`}
        >
          <ScaleIcon className="w-5 h-5" /> {form.byWeight ? "Por peso ✓" : "Por peso"}
        </button>
        <button
          type="button"
          aria-pressed={form.isActive}
          onClick={() => set({ isActive: !form.isActive })}
          className={`h-14 rounded-xl border text-xs font-black uppercase tracking-widest ${
            form.isActive ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "bg-red-500/10 border-red-500/40 text-red-300"
          }`}
        >
          {form.isActive ? "Activo ✓" : "Desactivado"}
        </button>
      </div>

      {/* Más datos */}
      <button
        type="button"
        onClick={() => setMasDatos((v) => !v)}
        className="w-full h-12 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest text-white/60 flex items-center justify-center gap-2"
      >
        {masDatos ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        Más datos (categoría, mínimos, foto)
      </button>

      {masDatos && (
        <div className="space-y-3">
          <div>
            <label className={etiqueta}>Categoría</label>
            <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={campo}>
              <option value="">Sin categoría</option>
              {form.category && !categorias.includes(form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {form.byWeight && (
            <div>
              <label className={etiqueta}>Se vende por</label>
              <select value={form.unit} onChange={(e) => set({ unit: e.target.value })} className={campo}>
                <option value="kg">kg</option>
                <option value="g">g</option>
              </select>
            </div>
          )}
          {!esAlta && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={etiqueta}>Stock mínimo</label>
                <input inputMode="numeric" data-scan-guard value={form.minStock} onChange={(e) => set({ minStock: e.target.value })} className={campo} />
              </div>
              <div>
                <label className={etiqueta}>Stock óptimo</label>
                <input inputMode="numeric" data-scan-guard value={form.optimumStock} onChange={(e) => set({ optimumStock: e.target.value })} className={campo} />
              </div>
            </div>
          )}
          {!esAlta && (
            <>
              <div>
                <label className={etiqueta}>Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={2}
                  data-scan-guard
                  className="w-full bg-black border border-white/15 rounded-xl p-3 text-white text-base outline-none focus:border-emerald-500 resize-none"
                />
              </div>
              <div>
                <label className={etiqueta}>URL de la foto</label>
                <input value={form.imageUrl} onChange={(e) => set({ imageUrl: e.target.value })} data-scan-guard placeholder="https://…" className={campo} />
              </div>
            </>
          )}
        </div>
      )}

      {/* Guardar fijo abajo */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-[#0a0a0a]/95 backdrop-blur border-t border-white/10 p-3">
        <div className="max-w-xl mx-auto flex gap-2">
          <button
            type="button"
            onClick={() => onClose()}
            className="flex-1 min-h-[3.5rem] rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="flex-[2] min-h-[3.5rem] rounded-2xl bg-emerald-500 text-black text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 active:bg-emerald-600"
          >
            {guardando ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <CheckIcon className="w-5 h-5" />}
            {esAlta ? "Crear" : hayCambios ? "Guardar" : "Sin cambios"}
          </button>
        </div>
      </div>

      {ajustando && fila && (
        <AjustarStock
          barcode={fila.barcode}
          nombre={form.name || String(fila.name ?? "")}
          porPeso={form.byWeight}
          stockVisto={Number(ficha?.stockSucursal ?? 0)}
          branchId={ficha?.branchId ?? branchId}
          onCancel={() => setAjustando(false)}
          onDone={(stock) => {
            setAjustando(false);
            setFicha((prev) => (prev ? { ...prev, stockSucursal: stock } : prev));
            showToast(`✓ Stock de ${form.name}: ${formatMiles(stock)}`, "success");
          }}
        />
      )}

      {escaneandoCodigo && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md relative">
            <button
              onClick={() => setEscaneandoCodigo(false)}
              aria-label="Cerrar escáner"
              className="absolute -top-12 right-0 p-2 bg-white/10 rounded-xl text-white"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            <UnifiedScanner
              onDetected={(code) => {
                set({ barcode: code });
                setEscaneandoCodigo(false);
              }}
            />
          </div>
        </div>
      )}

      {confirmar && <Confirmar {...confirmar} />}
    </div>
  );
}
