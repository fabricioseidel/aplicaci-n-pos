"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ArrowsRightLeftIcon, PlusCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  adoptarCodigo,
  cambiarCodigo,
  DEFAULT_IMAGE,
  ProductExistsError,
  saveProduct,
  usarProductoExistente,
} from "@/services/products";
import { useToast } from "@/contexts/ToastContext";
import { searchProducts } from "@/lib/pos/search";
import MoneyInput from "@/components/ui/MoneyInput";
import QtyInput from "@/components/operaciones/inventario/QtyInput";
import { esCodigoGenerico } from "@/lib/products/codigos";
import type { ProductUI } from "@/types";

/** Lo que se va a contar del producto elegido o recién creado. */
export interface DatosConteo {
  qty: number;
  /** "YYYY-MM-DD" o "" si no se anotó. */
  expiry: string;
}

interface Props {
  /** Código leído por la cámara que no coincidió con nada. "" si se abrió desde el buscador. */
  initialBarcode?: string;
  initialName?: string;
  /** Catálogo cargado (activos), para buscar el producto existente. */
  products: ProductUI[];
  esAdmin: boolean;
  /** false mientras la base no guarda vencimientos: el campo no se muestra. */
  conVencimiento?: boolean;
  onClose: () => void;
  /** `codigoAnterior`: el producto cambió su código genérico por el escaneado. */
  onListo: (product: ProductUI, datos: DatosConteo, codigoAnterior?: string) => void;
}

function codigoInterno(): string {
  return `INT-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * El código escaneado no coincide con ningún producto (o se buscó por nombre
 * y no apareció). Dos salidas:
 *
 * - **Crear nuevo**: nombre, precio de venta, vencimiento y código. Ninguno
 *   bloquea: en pleno inventario lo que importa es que quede contado; lo que
 *   falte se completa después en Productos.
 * - **Es uno existente**: el producto ya está en el catálogo con otro código.
 *   Se cuenta como ese y, si su código es genérico (INT-, SINCOD-, 9000000…),
 *   se queda con el escaneado —quien sea que esté contando—, para que la
 *   próxima vez coincida. Reemplazar un código real sigue siendo de admin.
 */
export default function SinCoincidencia({
  initialBarcode = "",
  initialName = "",
  products,
  esAdmin,
  conVencimiento = true,
  onClose,
  onListo,
}: Props) {
  const { showToast } = useToast();
  const escaneado = initialBarcode.trim();
  const [vista, setVista] = useState<"crear" | "existente">("crear");
  const [guardando, setGuardando] = useState(false);

  // Lo que se cuenta, común a las dos salidas.
  const [qty, setQty] = useState(1);
  const [expiry, setExpiry] = useState("");

  // Crear nuevo
  const [barcode, setBarcode] = useState(escaneado);
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState<number | null>(null);
  const [porPeso, setPorPeso] = useState(false);

  // Es uno existente
  const [query, setQuery] = useState(initialName);
  const [elegido, setElegido] = useState<ProductUI | null>(null);
  const [usarCodigo, setUsarCodigo] = useState(false);
  const [remotos, setRemotos] = useState<ProductUI[]>([]);

  const locales = useMemo(
    () => (query.trim().length >= 2 ? searchProducts(products, query).slice(0, 6) : []),
    [query, products]
  );

  // El catálogo local sólo trae activos: la base también conoce los que un
  // inventario anterior dejó fuera.
  useEffect(() => {
    const q = query.trim();
    if (vista !== "existente" || q.length < 2) {
      setRemotos([]);
      return;
    }
    let cancelado = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventario/buscar?q=${encodeURIComponent(q)}&inactivos=1`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { productos?: ProductUI[] };
        if (!cancelado) setRemotos((data.productos ?? []).slice(0, 6));
      } catch {
        /* sin red: quedan los locales */
      }
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [query, vista]);

  const candidatos = useMemo(() => {
    const vistos = new Set(locales.map((p) => p.id));
    return [...locales, ...remotos.filter((p) => !vistos.has(p.id))];
  }, [locales, remotos]);

  const elegir = (p: ProductUI) => {
    setElegido(p);
    setVista("existente");
    // Un código genérico se reemplaza por el escaneado sin preguntar: es lo
    // que se perdía. Uno real puede ser otro envase, así que no se asume.
    setUsarCodigo(!!escaneado && esCodigoGenerico(p.barcode || p.id));
  };

  // Mientras se escribe el nombre del producto "nuevo", puede resultar que ya
  // existe: mejor contarlo como ese (y que se quede con el código) que crear
  // un duplicado.
  const parecidos = useMemo(
    () => (vista === "crear" && name.trim().length >= 3 ? searchProducts(products, name).slice(0, 3) : []),
    [vista, name, products]
  );

  const crear = async () => {
    if (guardando) return;
    const codigo = barcode.trim() || codigoInterno();
    const nombre = name.trim() || `Producto sin nombre ${codigo}`;
    setGuardando(true);
    try {
      await saveProduct(
        {
          barcode: codigo,
          name: nombre,
          is_active: true,
          ...(price ? { sale_price: price } : {}),
          ...(porPeso ? { by_weight: true } : {}),
        },
        { crear: true }
      );
      const product: ProductUI = {
        id: codigo,
        barcode: codigo,
        name: nombre,
        price: price ?? 0,
        image: DEFAULT_IMAGE,
        slug: nombre.toLowerCase().replace(/\s+/g, "-"),
        description: "",
        categories: [],
        stock: 0,
        featured: false,
        byWeight: porPeso,
        isActive: true,
      };
      showToast(`Producto creado: ${nombre}`, "success");
      onListo(product, { qty, expiry });
    } catch (err) {
      if (err instanceof ProductExistsError) {
        const existente = await usarProductoExistente(err.existente.barcode).catch(() => null);
        if (existente) {
          showToast(`${err.message}: se cuenta como ese producto`, "warning", 5000);
          onListo(existente, { qty, expiry });
          return;
        }
      }
      showToast(err instanceof Error ? err.message : "No se pudo crear el producto", "error");
    } finally {
      setGuardando(false);
    }
  };

  const usarExistente = async () => {
    if (!elegido || guardando) return;
    setGuardando(true);
    try {
      let producto = elegido;
      let anterior: string | undefined;
      if (elegido.isActive === false) {
        producto = (await usarProductoExistente(elegido.barcode || elegido.id)) ?? elegido;
      }
      const actual = producto.barcode || producto.id;
      if (usarCodigo && escaneado && escaneado !== actual) {
        try {
          const nuevo = esCodigoGenerico(actual)
            ? await adoptarCodigo(actual, escaneado)
            : await cambiarCodigo(actual, escaneado);
          anterior = actual;
          producto = { ...producto, id: nuevo, barcode: nuevo };
          showToast(`${producto.name}: código ${nuevo} guardado`, "success");
        } catch (e) {
          // Se cuenta igual: perder el conteo por el código sería peor.
          showToast(
            `Contado, pero el código no se guardó: ${e instanceof Error ? e.message : "error"}`,
            "warning",
            6000
          );
        }
      }
      onListo(producto, { qty, expiry }, anterior);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo actualizar el producto", "error");
    } finally {
      setGuardando(false);
    }
  };

  const etiqueta = "block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1";
  const campo =
    "w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-emerald-500";

  const cantidadYVencimiento = (
    <div className={`grid gap-3 ${conVencimiento ? "grid-cols-2" : "grid-cols-1"}`}>
      <div>
        <label className={etiqueta}>{porPeso || elegido?.byWeight ? "Kilos contados" : "Cantidad contada"}</label>
        <QtyInput
          value={qty}
          porPeso={vista === "crear" ? porPeso : Boolean(elegido?.byWeight)}
          permitirCero
          onChange={setQty}
          aria-label="Cantidad contada"
          className={`${campo} tabular-nums font-black`}
        />
      </div>
      {conVencimiento && (
        <div>
          <label className={etiqueta}>Vence (opcional)</label>
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={campo} />
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm max-h-[92dvh] overflow-y-auto bg-[#111] border border-white/10 rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-300">
              {escaneado ? "Código sin coincidencia" : "Producto que no aparece"}
            </h2>
            {escaneado && <p className="text-xs text-white/50 font-mono mt-0.5 truncate">{escaneado}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-2 -mr-2 -mt-1 text-white/50 hover:text-white">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/40 border border-white/10 mb-4">
          {(
            [
              ["crear", "Producto nuevo", PlusCircleIcon],
              ["existente", "Ya existe", ArrowsRightLeftIcon],
            ] as const
          ).map(([id, texto, Icono]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              className={`min-h-11 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 ${
                vista === id ? "bg-emerald-500 text-black" : "text-white/50"
              }`}
            >
              <Icono className="h-4 w-4" /> {texto}
            </button>
          ))}
        </div>

        {vista === "crear" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
            className="space-y-3"
          >
            <div>
              <label className={etiqueta}>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initialName} className={campo} />
            </div>
            {parecidos.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                  ¿Es alguno de estos?
                </p>
                <ul className="space-y-1.5">
                  {parecidos.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => elegir(p)}
                        className="w-full min-h-11 text-left bg-black/30 rounded-lg px-3 py-2 border border-amber-500/20"
                      >
                        <span className="block text-xs font-bold truncate">{p.name}</span>
                        <span className="block text-[10px] text-white/40 font-mono">
                          {p.barcode || p.id}
                          {escaneado && esCodigoGenerico(p.barcode || p.id) ? " · se le guarda el código escaneado" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={etiqueta}>{porPeso ? "Precio por kilo" : "Precio de venta"}</label>
                <MoneyInput value={price} onChange={setPrice} className={campo} placeholder="$" />
              </div>
              <div>
                <label className={etiqueta}>Código de barras</label>
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Sin código"
                  inputMode="numeric"
                  className={`${campo} font-mono`}
                />
              </div>
            </div>
            {cantidadYVencimiento}
            <label className="flex items-center gap-2 min-h-11 text-xs text-white/60">
              <input
                type="checkbox"
                checked={porPeso}
                onChange={(e) => setPorPeso(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              Se vende por peso (kilos)
            </label>
            <p className="text-[11px] text-white/40 leading-relaxed">
              Nada es obligatorio: lo que falte se completa después en Productos. Sin precio no se
              puede vender.
            </p>
            <button
              type="submit"
              disabled={guardando}
              className="w-full h-12 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-white/40 flex items-center justify-center gap-2"
            >
              {guardando && <ArrowPathIcon className="h-4 w-4 animate-spin" />} Crear y contar
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            {!elegido ? (
              <>
                <div>
                  <label className={etiqueta}>Buscar el producto</label>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    placeholder="Nombre o código…"
                    className={campo}
                  />
                </div>
                <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                  {candidatos.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => elegir(p)}
                        className="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl px-3 py-2.5 border border-white/10"
                      >
                        <span className="block text-sm font-bold truncate">{p.name}</span>
                        <span className="block text-[10px] text-white/40 font-mono mt-0.5">
                          {p.barcode || p.id}
                          {p.price > 0 ? ` · $${p.price.toLocaleString("es-CL")}` : " · sin precio"}
                          {p.isActive === false ? " · fuera del catálogo" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {query.trim().length >= 2 && candidatos.length === 0 && (
                    <li className="text-xs text-white/30 text-center py-4">Sin coincidencias.</li>
                  )}
                </ul>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate">{elegido.name}</p>
                    <p className="text-[10px] text-white/50 font-mono mt-0.5">{elegido.barcode || elegido.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setElegido(null)}
                    className="text-[10px] font-black uppercase tracking-widest text-white/50 p-2 -m-2"
                  >
                    Cambiar
                  </button>
                </div>

                {escaneado &&
                  (esAdmin || esCodigoGenerico(elegido.barcode || elegido.id) ? (
                    <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70 leading-relaxed">
                      <input
                        type="checkbox"
                        checked={usarCodigo}
                        onChange={(e) => setUsarCodigo(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-emerald-500"
                      />
                      <span>
                        Guardarle el código escaneado <strong className="font-mono">{escaneado}</strong>
                        {esCodigoGenerico(elegido.barcode || elegido.id) ? " (reemplaza su código genérico)." : "."}
                        {!esCodigoGenerico(elegido.barcode || elegido.id) && (
                          <> Reemplaza su código actual: los envases con el código anterior ya no van a coincidir.</>
                        )}
                      </span>
                    </label>
                  ) : (
                    <p className="text-[11px] text-white/40 leading-relaxed">
                      Se cuenta como este producto. Cambiarle el código de barras lo hace un administrador.
                    </p>
                  ))}

                {cantidadYVencimiento}
                <button
                  type="button"
                  onClick={() => void usarExistente()}
                  disabled={guardando}
                  className="w-full h-12 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest disabled:bg-white/10 disabled:text-white/40 flex items-center justify-center gap-2"
                >
                  {guardando && <ArrowPathIcon className="h-4 w-4 animate-spin" />} Contar este producto
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
