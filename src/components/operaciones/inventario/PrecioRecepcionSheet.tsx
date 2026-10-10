"use client";

import React, { useState } from "react";
import { ArrowPathIcon, XMarkIcon, SparklesIcon } from "@heroicons/react/24/outline";
import MoneyInput from "@/components/ui/MoneyInput";
import Confirmar from "@/components/operaciones/productos/Confirmar";
import { patchProduct, ProductConflictError, type FilaProducto } from "@/services/products";
import { costoNetoDesdeBruto, revisarPrecio } from "@/lib/products/edicion";
import { costoBruto, type InfoRecepcion } from "@/lib/inventario/recepcion";
import { formatoMargen, margenReal, sugerirDesdeFactura } from "@/lib/inventario/precios";
import type { ProductUI } from "@/types";

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

export interface ResultadoGuardado {
  producto: ProductUI;
  fila: FilaProducto;
  aviso?: string;
}

/**
 * Guarda precio y/o costo de un producto desde Recepción con el PATCH de
 * Productos: sólo lo que cambió, con `expected` (si otra persona lo cambió
 * entretanto, 409) y auditado con quien atiende. No toca el stock: eso es la
 * recepción misma, aparte e idempotente.
 */
export async function guardarPrecioCosto(input: {
  barcode: string;
  info: InfoRecepcion;
  precio?: number | null;
  /** Costo de la factura CON IVA; se guarda neto (÷ 1,19) como en OlivoWeb. */
  costoFactura?: number | null;
}): Promise<ResultadoGuardado | null> {
  const { barcode, info } = input;
  const changes: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  if (input.precio != null && input.precio > 0 && input.precio !== Math.round(info.precio ?? 0)) {
    changes.sale_price = input.precio;
    expected.sale_price = info.precio;
  }
  if (
    input.costoFactura != null &&
    input.costoFactura > 0 &&
    info.costoNeto !== null &&
    !info.costoDelProveedor &&
    input.costoFactura !== costoBruto(info.costoNeto)
  ) {
    changes.purchase_price = costoNetoDesdeBruto(input.costoFactura);
    expected.purchase_price = info.costoNeto;
  }
  if (Object.keys(changes).length === 0) return null;
  return patchProduct(barcode, changes, expected);
}

/**
 * Hoja "Precio y costo" de una línea de Recepción: el costo de la factura
 * (con IVA) propone el precio de venta con el margen de su categoría.
 *
 * - ADMIN: ve y guarda el costo, salvo que lo fije un proveedor (solo lectura).
 * - Vendedora: no ve el costo guardado; puede tipear el de la factura para
 *   calcular el sugerido, pero no se guarda (el costo lo carga un ADMIN).
 * - Cualquiera cambia el precio de venta (decisión del dueño; queda auditado).
 */
export default function PrecioRecepcionSheet({
  product,
  info,
  verCosto,
  costoInicial,
  onClose,
  onGuardado,
  onConflicto,
}: {
  product: ProductUI;
  info: InfoRecepcion;
  verCosto: boolean;
  /** Costo de factura ya tipeado antes en esta línea. */
  costoInicial: number | null;
  onClose: () => void;
  onGuardado: (r: ResultadoGuardado | null, costoFactura: number | null) => void;
  onConflicto: (mensaje: string) => void;
}) {
  const barcode = product.barcode || product.id;
  const costoActual = costoBruto(info.costoNeto);
  const costoEditable = !info.costoDelProveedor;
  const [costo, setCosto] = useState<number | null>(costoInicial ?? costoActual);
  const [precio, setPrecio] = useState<number | null>(info.precio !== null ? Math.round(info.precio) : null);
  const [avisos, setAvisos] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);

  const sugerido = costo && costo > 0 ? sugerirDesdeFactura(costo, info.regla) : null;
  const margen = verCosto && precio && costo ? margenReal(precio, costo) : null;
  const precioAnterior = info.precio !== null ? Math.round(info.precio) : null;

  const pedirGuardar = () => {
    if (precio !== null && precio > 0 && precio !== precioAnterior) {
      const a = revisarPrecio(precioAnterior, precio);
      if (a.length > 0) {
        setAvisos(a);
        return;
      }
    }
    void guardar();
  };

  const guardar = async () => {
    setAvisos(null);
    setGuardando(true);
    try {
      const r = await guardarPrecioCosto({
        barcode,
        info,
        precio,
        costoFactura: verCosto && costoEditable ? costo : null,
      });
      onGuardado(r, costo && costo > 0 ? costo : null);
    } catch (e) {
      if (e instanceof ProductConflictError) onConflicto(e.message);
      else onConflicto(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl p-5 text-white space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Precio y costo</p>
            <h2 className="text-lg font-black leading-tight truncate">{product.name}</h2>
            <p className="text-xs text-white/40">
              Precio actual {precioAnterior ? pesos(precioAnterior) : "sin precio"}
              {verCosto && costoActual ? ` · costo ${pesos(costoActual)} con IVA` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-12 h-12 -mr-2 -mt-1 flex items-center justify-center text-white/50 hover:text-white shrink-0"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
            Costo de la factura (con IVA, por unidad)
          </label>
          {costoEditable ? (
            <>
              <MoneyInput
                aria-label="Costo de la factura con IVA"
                value={costo}
                onChange={setCosto}
                placeholder={verCosto ? "Sin costo" : "Opcional"}
                className="w-full bg-black border border-white/15 rounded-xl px-3 h-12 text-xl font-black text-white outline-none focus:border-emerald-400"
              />
              <p className="text-[11px] text-white/40 mt-1">
                {verCosto
                  ? "Se guarda sin IVA (÷ 1,19), igual que en OlivoWeb."
                  : "Solo para calcular el precio sugerido: el costo lo guarda un administrador."}
              </p>
            </>
          ) : (
            <p className="rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-sm text-white/70">
              {verCosto && costoActual ? `${pesos(costoActual)} con IVA · ` : ""}
              Lo fija el proveedor: se cambia en OlivoWeb → Precios.
            </p>
          )}
        </div>

        {sugerido !== null && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-3">
            <SparklesIcon className="w-6 h-6 text-emerald-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-emerald-200">Sugerido {pesos(sugerido)}</p>
              <p className="text-[11px] text-emerald-100/60">
                Margen {formatoMargen(info.regla.margen)}
                {info.regla.origen === "categoria"
                  ? " de su categoría"
                  : info.regla.origen === "producto"
                    ? " de este producto"
                    : ""}
                , redondeado hacia arriba
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrecio(sugerido)}
              disabled={precio === sugerido}
              className="h-12 px-4 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-40"
            >
              Usar
            </button>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">
            Precio de venta
          </label>
          <MoneyInput
            aria-label="Precio de venta"
            value={precio}
            onChange={setPrecio}
            onEnter={pedirGuardar}
            placeholder="Sin precio"
            className="w-full bg-black border-2 border-emerald-500/40 rounded-xl px-3 h-14 text-2xl font-black text-white outline-none focus:border-emerald-400"
          />
          <p className="text-[11px] text-white/40 mt-1">
            Cambia el precio para todos, en la tienda y en la web. Queda registrado quién lo cambió.
            {margen !== null && ` Deja ${formatoMargen(margen)} de margen.`}
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-14 rounded-2xl bg-white/5 text-white/60 text-xs font-black uppercase tracking-widest"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={pedirGuardar}
            disabled={guardando}
            className="flex-[2] h-14 rounded-2xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {guardando && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>

      {avisos && (
        <Confirmar
          titulo="¿Seguro?"
          avisos={avisos}
          acciones={[
            { label: "Sí, guardar", tono: "primario", onClick: () => void guardar() },
            { label: "Corregir", tono: "neutro", onClick: () => setAvisos(null) },
          ]}
        />
      )}
    </div>
  );
}
