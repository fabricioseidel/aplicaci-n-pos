"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePOS, unitPriceOf, lineSubtotal } from "@/contexts/POSContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/contexts/ToastContext";
import { useSync } from "@/contexts/SyncContext";
import { useProductCatalog } from "@/hooks/useProductCatalog";
import { useStaff, staffDisplayName } from "@/hooks/useStaff";
import { useAttendant } from "@/hooks/useAttendant";
import { ProductUI } from "@/types";
import { STAFF_DISCOUNT_RATE, PAYMENT_LABELS, type PosPaymentMethod } from "@/lib/pos/payments";
import {
  ajustarAuto,
  calcularCobro,
  pagosParaServidor,
  EXCESO_EFECTIVO_CONFIRMAR,
  type FilaPago,
} from "@/lib/pos/cobro";
import { searchProducts } from "@/lib/pos/search";
import { apiWrite } from "@/lib/offline/apiWrite";
import { newId } from "@/lib/offline/db";
import { fetchProductByBarcode, usarProductoExistente } from "@/services/products";
import { useScan, useScanFeedback } from "@/components/scanner/ScanProvider";
import UnifiedScanner from "@/components/scanner/UnifiedScanner";
import QuickCreateProductModal from "@/components/operaciones/QuickCreateProductModal";
import WeightPrompt from "@/components/operaciones/WeightPrompt";
import PriceSheet from "@/components/operaciones/PriceSheet";
import MoneyInput from "@/components/ui/MoneyInput";
import {
  MagnifyingGlassIcon, XMarkIcon, TrashIcon, MinusIcon, PlusIcon,
  BanknotesIcon, CreditCardIcon, ArrowPathIcon, CheckCircleIcon,
  ShoppingBagIcon, CameraIcon, PlusCircleIcon, ScaleIcon, CloudArrowUpIcon,
  ArrowLeftIcon, ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";

const PRODUCTS_PER_PAGE = 40;
const BILLETES = [1000, 2000, 5000, 10000, 20000];

const METHOD_ICONS: Record<PosPaymentMethod, typeof BanknotesIcon> = {
  CASH: BanknotesIcon, CARD: CreditCardIcon, TRANSFER: ArrowPathIcon,
};
const METHOD_SHORT: Record<PosPaymentMethod, string> = {
  CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transf.",
};

const clp = (n: number) => `$ ${Math.round(n).toLocaleString("es-CL")}`;
const filaInicial = (): FilaPago[] => [{ id: "p1", method: "CASH", amount: 0, auto: true }];

interface UltimaVenta {
  id: number | null;
  total: number;
  vuelto: number;
  queued: boolean;
  /** Se guardó porque la sesión venció (no por falta de red). */
  sesionVencida: boolean;
  dueno: string | null;
}

interface SaleModeProps {
  /** Turno abierto en el que se registrarán las ventas. */
  shiftId: string | null;
}

export default function SaleMode({ shiftId }: SaleModeProps) {
  const {
    cart, addToCart, setQuantity, removeFromCart, clearCart, total, itemCount,
    compraPropia, setCompraPropia, porCobrar, setPorCobrar, comprador, setComprador,
    resetSale, restored, dismissRestored, applyCatalog, updateLineProduct,
  } = usePOS();
  const { currentBranch } = useBranch();
  const { showToast } = useToast();
  const { refreshPending } = useSync();
  const { products: allProducts, loading, fromCache, upsertLocal } = useProductCatalog();
  const { staff } = useStaff();
  const { attendant } = useAttendant();
  const feedback = useScanFeedback();

  const [searchQuery, setSearchQuery] = useState("");
  const [filas, setFilas] = useState<FilaPago[]>(filaInicial);
  const [mixto, setMixto] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [quickCreateBarcode, setQuickCreateBarcode] = useState<string | null>(null);
  const [view, setView] = useState<"products" | "cart">("products");
  const [visibleCount, setVisibleCount] = useState(PRODUCTS_PER_PAGE);
  /** Producto por peso esperando que el cajero ingrese los gramos. */
  const [weighing, setWeighing] = useState<{ product: ProductUI; initialKg?: number } | null>(null);
  /** Producto sin precio: se pide antes de agregarlo. */
  const [sinPrecio, setSinPrecio] = useState<ProductUI | null>(null);
  /** Efectivo muy por encima del total: se pide confirmar antes de cobrar. */
  const [confirmarEfectivo, setConfirmarEfectivo] = useState(false);
  const [ultimaVenta, setUltimaVenta] = useState<UltimaVenta | null>(null);
  /** Carrito recién vaciado, para "Deshacer". */
  const [vaciado, setVaciado] = useState<typeof cart | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // El descuento de personal se recalcula cuando cambia el carrito para que
  // siga siendo el 25% del total vigente, no un monto congelado.
  const discount = useMemo(
    () => (compraPropia ? Math.round(total * STAFF_DISCOUNT_RATE) : 0),
    [compraPropia, total]
  );
  const finalTotal = Math.max(0, total - discount);

  // Los montos automáticos siguen al total: agregar un producto no deja el
  // pago clavado en el precio del primero.
  useEffect(() => {
    setFilas((f) => ajustarAuto(finalTotal, f));
  }, [finalTotal]);

  const cobro = useMemo(() => calcularCobro(finalTotal, filas), [finalTotal, filas]);
  const efectivoRecibido = filas.filter((f) => f.method === "CASH").reduce((a, f) => a + f.amount, 0);

  // Una compra propia sin dueño no se puede liquidar a fin de mes.
  const faltaComprador = compraPropia && !comprador;
  // Una compra propia por cobrar no recibe dinero ahora: no hay pagos que cuadrar.
  const puedeCobrar =
    cart.length > 0 && !processing && !faltaComprador && (porCobrar ? true : cobro.ok);
  const motivoNoCobrar =
    cart.length === 0 ? null : faltaComprador ? "Elige de quién es la compra" : porCobrar ? null : cobro.motivo;

  // Una venta retomada se cobra con los precios de hoy.
  useEffect(() => {
    if (fromCache || allProducts.length === 0) return;
    const changed = applyCatalog(allProducts);
    if (changed.length > 0) {
      showToast(`Cambió el precio de: ${changed.join(", ")}`, "warning", 6000);
    }
  }, [allProducts, fromCache, applyCatalog, showToast]);

  const products = useMemo(
    () => searchProducts(allProducts, searchQuery),
    [searchQuery, allProducts]
  );
  const visibleProducts = useMemo(() => products.slice(0, visibleCount), [products, visibleCount]);

  useEffect(() => { setVisibleCount(PRODUCTS_PER_PAGE); }, [searchQuery]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((p) => Math.min(p + PRODUCTS_PER_PAGE, products.length));
    }
  }, [products.length]);

  /**
   * Punto único de entrada al carrito. Un producto sin precio pide el precio
   * primero; uno por peso no puede entrar con cantidad 1: se pregunta cuánto pesa.
   */
  const pickProduct = useCallback((p: ProductUI) => {
    setUltimaVenta(null);
    setVaciado(null);
    if (unitPriceOf(p) <= 0) {
      setSinPrecio(p);
      return;
    }
    if (p.byWeight) {
      setWeighing({ product: p });
      return;
    }
    addToCart(p);
    showToast(`+ ${p.name}`, "success", 1200);
  }, [addToCart, showToast]);

  /**
   * Un código leído (láser, cámara o tipeado + Enter). Si no está en el
   * catálogo cargado se busca también entre los desactivados antes de
   * ofrecer crearlo: crear un duplicado reparte el stock en dos fichas.
   */
  const handleCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const found = allProducts.find((p) => p.id === code || p.barcode === code);
    if (found) {
      pickProduct(found);
      return;
    }
    const existente = await fetchProductByBarcode(code).catch(() => null);
    if (existente) {
      if (existente.isActive === false) {
        if (!window.confirm(`«${existente.name}» está desactivado. ¿Reactivarlo y venderlo?`)) return;
        const activo = await usarProductoExistente(code).catch(() => null);
        if (!activo) {
          showToast("No se pudo reactivar el producto", "error");
          return;
        }
        upsertLocal(activo);
        pickProduct(activo);
        return;
      }
      upsertLocal(existente);
      pickProduct(existente);
      return;
    }
    feedback.error();
    showToast(`No encontrado: ${code}`, "error", 4000);
    setQuickCreateBarcode(code);
  }, [allProducts, pickProduct, upsertLocal, showToast, feedback]);

  // El láser funciona en Venta sin tocar nada, también desde el carrito. Se
  // apaga mientras hay un cuadro abierto (peso, precio, alta, cámara): una
  // lectura en ese momento se descarta con aviso en vez de escribirse ahí.
  useScan(
    handleCode,
    !showScanner && !weighing && quickCreateBarcode === null && !sinPrecio && !confirmarEfectivo
  );

  const setFila = (idx: number, patch: Partial<FilaPago>) => {
    setFilas((f) => ajustarAuto(finalTotal, f.map((row, i) => (i === idx ? { ...row, ...patch } : row))));
  };

  /** Método único (lo común): Tarjeta y Transferencia quedan con el monto exacto. */
  const elegirMetodo = (method: PosPaymentMethod) => {
    setFilas([{ id: "p1", method, amount: finalTotal, auto: true }]);
  };

  /** Billetes que se suman: $10k + $5k = recibido $15.000. */
  const sumarBillete = (valor: number) => {
    setFilas((f) => {
      const row = f[0];
      const base = row.auto ? 0 : row.amount;
      return ajustarAuto(finalTotal, [{ ...row, method: "CASH", amount: base + valor, auto: false }, ...f.slice(1)]);
    });
  };

  const activarMixto = () => {
    setMixto(true);
    setFilas((f) =>
      ajustarAuto(finalTotal, [
        { ...f[0], auto: false },
        { id: `p${Date.now()}`, method: f[0].method === "CARD" ? "CASH" : "CARD", amount: 0, auto: true },
      ])
    );
  };

  const resetCobro = () => {
    setFilas(filaInicial());
    setMixto(false);
    setConfirmarEfectivo(false);
  };

  const vaciarCarrito = () => {
    if (cart.length === 0) return;
    setVaciado(cart);
    clearCart();
    resetCobro();
  };

  const deshacerVaciado = () => {
    if (!vaciado) return;
    for (const item of vaciado) addToCart(item, item.quantity);
    setVaciado(null);
  };

  const handleCheckout = async (efectivoConfirmado = false) => {
    if (cart.length === 0 || processing) return;
    if (faltaComprador) {
      showToast("Elige de quién es la compra propia", "error");
      return;
    }
    if (!porCobrar && !cobro.ok) {
      showToast(cobro.motivo ?? "Pagos inválidos", "error");
      return;
    }
    if (!porCobrar && !efectivoConfirmado && efectivoRecibido > finalTotal + EXCESO_EFECTIVO_CONFIRMAR) {
      setConfirmarEfectivo(true);
      return;
    }
    setConfirmarEfectivo(false);
    setProcessing(true);
    try {
      // El id del cliente es la clave de idempotencia: si esta venta se encola
      // y se reintenta, apply_sale la deduplica por client_sale_id.
      const clientSaleId = newId();
      const dueno = compraPropia && comprador ? staffDisplayName(comprador.name) : null;
      const vuelto = porCobrar ? 0 : cobro.vuelto;

      const result = await apiWrite<{ saleId?: number }>({
        kind: "sale",
        url: "/api/sales",
        id: clientSaleId,
        payload: {
          clientSaleId,
          total: finalTotal,
          branchId: currentBranch?.id ?? null,
          // Se manda el turno vigente para que una venta sincronizada más
          // tarde quede en el turno en que realmente ocurrió.
          shiftId,
          // Hora real de la venta: sin red se sincroniza después.
          soldAt: new Date().toISOString(),
          cashReceived: porCobrar ? 0 : efectivoRecibido,
          changeGiven: vuelto,
          tax: 0,
          discount: compraPropia ? discount : 0,
          isStaffPurchase: compraPropia,
          staffUnpaid: compraPropia && porCobrar,
          staffDiscountRate: compraPropia ? STAFF_DISCOUNT_RATE : undefined,
          staffSellerId: compraPropia ? comprador?.id : undefined,
          // Quién cobró, elegido en el teléfono: no la sesión de la mañana.
          attendantSellerId: attendant?.id,
          ...(porCobrar ? {} : { payments: pagosParaServidor(finalTotal, filas) }),
          items: cart.map((item) => ({
            barcode: item.id,
            name: item.name,
            // Decimal para los productos por peso; entero para el resto.
            qty: item.quantity,
            unit_price: unitPriceOf(item),
            subtotal: lineSubtotal(item),
          })),
        },
      });

      if (result.ok) {
        setUltimaVenta({
          id: result.queued ? null : result.data?.saleId ?? null,
          total: finalTotal,
          vuelto,
          queued: result.queued,
          sesionVencida: result.queued && result.reason === "session",
          dueno: dueno && porCobrar ? dueno : null,
        });
        resetSale();
        resetCobro();
        setSearchQuery("");
        setView("products");
        if (result.queued) await refreshPending();
      } else {
        feedback.error();
        showToast(result.error || "Error en la venta", "error", 6000);
      }
    } catch (e) {
      showToast(`Error: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    } finally {
      setProcessing(false);
    }
  };

  const avisoRetomada = restored && cart.length > 0 && (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
      <p className="flex-1 text-sm font-bold text-sky-100">
        Seguimos con la venta en curso ({restored.count} producto{restored.count === 1 ? "" : "s"})
      </p>
      <button
        type="button"
        onClick={() => { resetSale(); resetCobro(); }}
        className="shrink-0 h-11 px-3 rounded-xl bg-white/10 text-xs font-black uppercase tracking-widest text-white"
      >
        Empezar de cero
      </button>
      <button type="button" onClick={dismissRestored} aria-label="Cerrar aviso" className="p-2 -m-2 text-white/50">
        <XMarkIcon className="h-5 w-5" />
      </button>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto w-full h-full">
      {/* Vista de productos.
          Columna flex con un único scroll (el grid): con dos contenedores
          scrolleando a la vez, el de afuera se llevaba la primera fila debajo
          del buscador. */}
      <div className={view === "products" ? "flex flex-col h-full" : "hidden"}>
        <div className="p-3 flex gap-2 items-center border-b border-white/5 shrink-0 bg-[#0a0a0a] z-20">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar o escanear…"
              enterKeyHint="search"
              className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-10 pr-10 text-white text-base outline-none focus:border-emerald-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                // Un código tipeado a mano (o un lector lento) + Enter: búsqueda exacta.
                if (e.key === "Enter" && /^\d{6,}$/.test(searchQuery.trim())) {
                  e.preventDefault();
                  const code = searchQuery.trim();
                  setSearchQuery("");
                  void handleCode(code);
                }
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="Borrar búsqueda"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-white/50 p-2.5"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowScanner(true)}
            aria-label="Escanear con la cámara"
            className="h-12 w-12 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400"
          >
            <CameraIcon className="h-6 w-6" />
          </button>
          <button
            onClick={() => setView("cart")}
            aria-label="Ver carrito"
            className="relative h-12 w-12 flex items-center justify-center bg-white/5 border border-white/10 rounded-xl text-white/80"
          >
            <ShoppingBagIcon className="h-6 w-6" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 bg-emerald-500 text-black text-[11px] font-black rounded-full flex items-center justify-center">
                {cart.length}
              </span>
            )}
          </button>
        </div>

        {fromCache && (
          <p className="px-3 py-1.5 shrink-0 text-[11px] font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
            Catálogo sin conexión
          </p>
        )}

        {ultimaVenta && (
          <button
            type="button"
            onClick={() => setUltimaVenta(null)}
            className="mx-3 mt-3 shrink-0 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-left"
          >
            <p className="text-xs font-black uppercase tracking-widest text-emerald-300">
              {ultimaVenta.sesionVencida
                ? "✓ Venta guardada — tu sesión venció: vuelve a entrar para enviarla"
                : ultimaVenta.queued
                ? "✓ Venta guardada sin conexión — se sincroniza sola"
                : `✓ Venta${ultimaVenta.id ? ` #${ultimaVenta.id}` : ""} registrada · ${clp(ultimaVenta.total)}`}
              {ultimaVenta.dueno ? ` · por cobrar a ${ultimaVenta.dueno}` : ""}
            </p>
            {ultimaVenta.vuelto > 0 && (
              <p className="text-3xl font-black text-white">Vuelto {clp(ultimaVenta.vuelto)}</p>
            )}
          </button>
        )}

        {avisoRetomada}

        {cart.length > 0 && (
          <button
            type="button"
            onClick={() => setView("cart")}
            className="mx-3 mt-3 shrink-0 h-14 rounded-2xl bg-emerald-500 text-black flex items-center justify-between px-4 font-black"
          >
            <span className="text-sm uppercase tracking-widest">
              Cobrar · {itemCount % 1 === 0 ? itemCount : itemCount.toFixed(1)} art.
            </span>
            <span className="text-xl">{clp(finalTotal)}</span>
          </button>
        )}

        <div
          className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 p-3 pb-24 content-start flex-1 min-h-0 overflow-y-auto"
          onScroll={handleScroll}
        >
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />
          ))}

          {!loading && visibleProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => pickProduct(p)}
              // Sin foco después del toque: el Enter del lector no la puede "presionar".
              onPointerUp={(e) => e.currentTarget.blur()}
              className="bg-white/5 rounded-xl p-2 border text-left transition-all active:scale-95 flex gap-2 items-center border-white/10 hover:border-emerald-500 min-h-20"
            >
              <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen externa sin dimensiones conocidas */}
                <img src={p.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                {p.byWeight && (
                  <span className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-0.5 bg-black/70 py-0.5 text-[9px] font-black uppercase text-emerald-300">
                    <ScaleIcon className="h-3 w-3" /> kg
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-tight line-clamp-2 text-white/90">{p.name}</p>
                <p className="mt-0.5 text-sm font-black text-emerald-400">
                  {unitPriceOf(p) > 0 ? clp(unitPriceOf(p)) : <span className="text-amber-400">Sin precio</span>}
                  {p.byWeight && <span className="text-[10px] text-white/40"> /kg</span>}
                </p>
                {p.offerPrice && p.offerPrice > 0 && p.offerPrice < p.price && (
                  <p className="text-[10px] font-bold text-amber-300">
                    Oferta · antes <span className="line-through">{clp(p.price)}</span>
                  </p>
                )}
                {/* Venta sin stock habilitada: se avisa pero no se bloquea. */}
                {p.stock <= 0 && (
                  <p className="text-[10px] font-black uppercase text-amber-400/90">Sin stock</p>
                )}
              </div>
            </button>
          ))}

          {!loading && visibleCount < products.length && (
            <div className="col-span-full py-3 text-center">
              <button
                onClick={() => setVisibleCount((p) => p + PRODUCTS_PER_PAGE)}
                className="h-11 px-4 text-xs font-bold uppercase tracking-widest text-emerald-500"
              >
                + {products.length - visibleCount} más
              </button>
            </div>
          )}

          {!loading && products.length === 0 && (
            <div className="col-span-full py-16 text-center text-white/40">
              <p className="text-xs font-black uppercase tracking-widest mb-3">Sin resultados</p>
              {searchQuery.trim() && (
                <button
                  onClick={() => setQuickCreateBarcode(searchQuery.trim())}
                  className="inline-flex items-center gap-1.5 h-12 px-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-black uppercase tracking-widest"
                >
                  <PlusCircleIcon className="h-5 w-5" /> Crear &quot;{searchQuery.trim()}&quot;
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Vista de carrito / cobro */}
      <div className={view === "cart" ? "block" : "hidden"}>
        <div className="p-3 flex items-center gap-2 border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-20">
          <button
            onClick={() => setView("products")}
            className="flex items-center gap-1.5 h-12 px-3 rounded-xl bg-white/5 text-xs font-black uppercase tracking-widest text-white/80"
          >
            <ArrowLeftIcon className="h-5 w-5" /> Productos
          </button>
          <span className="flex-1 text-xs font-black uppercase tracking-widest text-emerald-400 text-center">
            Carrito ({cart.length})
          </span>
          <button
            onClick={vaciarCarrito}
            aria-label="Vaciar carrito"
            disabled={cart.length === 0}
            className="h-12 w-12 flex items-center justify-center rounded-xl text-white/50 hover:text-red-400 disabled:opacity-20"
          >
            <TrashIcon className="h-6 w-6" />
          </button>
        </div>

        {avisoRetomada}

        {vaciado && (
          <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="flex-1 text-sm font-bold text-white/80">Carrito vaciado</p>
            <button
              type="button"
              onClick={deshacerVaciado}
              className="flex items-center gap-1.5 h-11 px-3 rounded-xl bg-white/10 text-xs font-black uppercase tracking-widest"
            >
              <ArrowUturnLeftIcon className="h-4 w-4" /> Deshacer
            </button>
          </div>
        )}

        <div className="p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="py-16 flex flex-col items-center opacity-40">
              <ShoppingBagIcon className="h-12 w-12 mb-3" />
              <p className="text-xs font-black uppercase tracking-widest">Carrito vacío</p>
              <p className="mt-1 text-xs">Escanea un producto para empezar</p>
            </div>
          ) : cart.map((item) => (
            <div key={item.id} className="bg-white/5 rounded-2xl p-3 border border-white/5">
              <div className="flex justify-between items-start gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-tight">{item.name}</p>
                  <p className="text-xs text-emerald-400 font-bold">
                    {clp(unitPriceOf(item))} {item.byWeight ? "por kg" : "c/u"}
                  </p>
                </div>
                <button
                  onClick={() => removeFromCart(item.id)}
                  aria-label={`Quitar ${item.name}`}
                  className="h-11 w-11 -m-1 flex items-center justify-center rounded-xl text-white/40 hover:text-red-400"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="flex items-center justify-between">
                {item.byWeight ? (
                  /* Por peso no hay stepper de +/-: se vuelve a pedir el peso. */
                  <button
                    onClick={() => setWeighing({ product: item, initialKg: item.quantity })}
                    className="flex items-center gap-1.5 h-12 bg-black/40 px-4 rounded-xl border border-emerald-500/30 text-emerald-300"
                  >
                    <ScaleIcon className="h-5 w-5" />
                    <span className="text-base font-black">{item.quantity.toFixed(3)} kg</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                    <button
                      onClick={() => setQuantity(item.id, item.quantity - 1)}
                      aria-label="Quitar una unidad"
                      className="h-11 w-11 flex items-center justify-center text-white/70 active:scale-90"
                    >
                      <MinusIcon className="h-5 w-5" />
                    </button>
                    <span className="w-10 text-center text-lg font-black">{item.quantity}</span>
                    <button
                      onClick={() => setQuantity(item.id, item.quantity + 1)}
                      aria-label="Agregar una unidad"
                      className="h-11 w-11 flex items-center justify-center text-emerald-400 active:scale-90"
                    >
                      <PlusIcon className="h-5 w-5" />
                    </button>
                  </div>
                )}
                <span className="text-lg font-black">{clp(lineSubtotal(item))}</span>
              </div>
            </div>
          ))}

          {cart.length > 0 && (
            <div className="bg-white/5 rounded-2xl p-3 border border-white/5 space-y-3 mt-2">
              <button
                type="button"
                onClick={() => setCompraPropia(!compraPropia)}
                className={`w-full h-12 rounded-xl border px-4 text-xs font-black uppercase tracking-widest transition-colors ${
                  compraPropia
                    ? "bg-amber-500 border-amber-500 text-black"
                    : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {compraPropia ? "✓ Compra propia activa" : `Compra propia (−${Math.round(STAFF_DISCOUNT_RATE * 100)}%)`}
              </button>

              {compraPropia && (
                <div className="space-y-2">
                  <p className={`text-[11px] font-black uppercase tracking-widest ${comprador ? "text-amber-300/70" : "text-amber-400"}`}>
                    ¿De quién es la compra?
                  </p>
                  {staff.length === 0 ? (
                    <p className="text-xs text-red-300">
                      No se pudo cargar la lista de empleados. Conéctate a internet y reintenta.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {staff.map((s) => {
                        const activo = comprador?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={activo}
                            onClick={() => setComprador(activo ? null : { id: s.id, name: s.name })}
                            className={`rounded-xl border px-2 h-12 text-sm font-black transition-colors ${
                              activo
                                ? "bg-amber-500 border-amber-500 text-black"
                                : "bg-black/40 border-amber-500/30 text-amber-100"
                            }`}
                          >
                            {staffDisplayName(s.name)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <label className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 min-h-12">
                    <input
                      type="checkbox"
                      checked={porCobrar}
                      onChange={(e) => setPorCobrar(e.target.checked)}
                      className="h-5 w-5 accent-amber-500"
                    />
                    <span className="text-xs font-bold text-amber-200">
                      Dejar por cobrar (se descuenta del sueldo a fin de mes)
                    </span>
                  </label>
                </div>
              )}

              {!porCobrar && mixto && (
                <div className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-white/50">Pago mixto</p>
                  {filas.map((row, idx) => {
                    const Icon = METHOD_ICONS[row.method];
                    return (
                      <div key={row.id} className="flex gap-2 items-stretch">
                        <select
                          value={row.method}
                          onChange={(e) => setFila(idx, { method: e.target.value as PosPaymentMethod })}
                          aria-label="Método de pago"
                          className="h-12 bg-black border border-white/10 rounded-xl px-2 text-xs font-black uppercase text-white outline-none focus:border-emerald-500 shrink-0"
                        >
                          {(Object.keys(METHOD_SHORT) as PosPaymentMethod[]).map((m) => (
                            <option key={m} value={m}>{METHOD_SHORT[m]}</option>
                          ))}
                        </select>
                        <div className="relative flex-1">
                          <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-5 w-5 text-white/30" />
                          <MoneyInput
                            value={row.amount || null}
                            onChange={(v) => setFila(idx, { amount: v ?? 0, auto: false })}
                            aria-label={`Monto ${PAYMENT_LABELS[row.method]}`}
                            className="w-full h-12 bg-black border border-white/10 rounded-xl pl-9 pr-3 text-lg font-black text-white outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={resetCobro}
                    className="h-11 px-3 text-xs font-black uppercase tracking-widest text-white/50"
                  >
                    Volver a un solo pago
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cobro: siempre a la vista, aunque el carrito sea largo. */}
        {cart.length > 0 && (
          <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-3 space-y-2">
            {compraPropia && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">
                  Compra propia{comprador ? ` de ${staffDisplayName(comprador.name)}` : ""} −{Math.round(STAFF_DISCOUNT_RATE * 100)}%
                </span>
                <span className="text-amber-400 font-black">− {clp(discount)}</span>
              </div>
            )}

            {!porCobrar && !mixto && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(METHOD_SHORT) as PosPaymentMethod[]).map((m) => {
                    const Icon = METHOD_ICONS[m];
                    const activo = filas[0].method === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => elegirMetodo(m)}
                        aria-pressed={activo}
                        className={`h-12 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wide ${
                          activo ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/70"
                        }`}
                      >
                        <Icon className="h-5 w-5" /> {METHOD_SHORT[m]}
                      </button>
                    );
                  })}
                </div>

                {filas[0].method === "CASH" && (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-6 gap-1">
                      <button
                        type="button"
                        onClick={() => setFila(0, { auto: true })}
                        className={`h-11 rounded-lg text-[11px] font-black border ${
                          filas[0].auto
                            ? "bg-emerald-500 text-black border-emerald-500"
                            : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                        }`}
                      >
                        Exacto
                      </button>
                      {BILLETES.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => sumarBillete(b)}
                          className="h-11 rounded-lg bg-white/10 text-xs font-black text-white"
                        >
                          {b / 1000}k
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-black uppercase tracking-widest text-white/50 shrink-0">
                        Recibido
                      </span>
                      <MoneyInput
                        value={filas[0].amount || null}
                        onChange={(v) => setFila(0, { amount: v ?? 0, auto: false })}
                        aria-label="Efectivo recibido"
                        className="flex-1 h-11 bg-black border border-white/10 rounded-xl px-3 text-right text-lg font-black text-white outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={activarMixto}
                        className="shrink-0 h-11 px-2 text-[11px] font-black uppercase tracking-wide text-white/50"
                      >
                        + Mixto
                      </button>
                    </div>
                  </div>
                )}
                {filas[0].method !== "CASH" && (
                  <button
                    type="button"
                    onClick={activarMixto}
                    className="h-10 px-1 text-[11px] font-black uppercase tracking-wide text-white/50"
                  >
                    + Pago mixto (parte en efectivo)
                  </button>
                )}
              </>
            )}

            <div className="flex items-end justify-between">
              <div>
                <span className="block text-[11px] font-black uppercase tracking-widest text-emerald-400">Total</span>
                <span className="text-3xl font-black">{clp(finalTotal)}</span>
              </div>
              {!porCobrar && cobro.vuelto > 0 && (
                <div className="text-right">
                  <span className="block text-[11px] font-black uppercase tracking-widest text-emerald-300">Vuelto</span>
                  <span className="text-3xl font-black text-emerald-300">{clp(cobro.vuelto)}</span>
                </div>
              )}
              {!porCobrar && cobro.falta > 0 && (
                <div className="text-right">
                  <span className="block text-[11px] font-black uppercase tracking-widest text-red-400">Falta</span>
                  <span className="text-2xl font-black text-red-400">{clp(cobro.falta)}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => void handleCheckout()}
              disabled={!puedeCobrar}
              className={`w-full h-16 rounded-2xl flex items-center justify-center gap-2 text-base font-black uppercase tracking-widest transition-all ${
                puedeCobrar ? "bg-emerald-500 text-black active:bg-emerald-600" : "bg-white/5 text-white/40"
              }`}
            >
              {processing ? <ArrowPathIcon className="h-6 w-6 animate-spin" /> : motivoNoCobrar ? (
                motivoNoCobrar
              ) : (
                <><CheckCircleIcon className="h-6 w-6" /> {porCobrar ? "Registrar por cobrar" : `Cobrar ${clp(finalTotal)}`}</>
              )}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">
              <CloudArrowUpIcon className="h-3.5 w-3.5" />
              Sin conexión la venta se guarda y se sincroniza sola
            </p>
          </div>
        )}
      </div>

      {/* Efectivo muy por encima del total: un billete de más o un cero de más. */}
      {confirmarEfectivo && (
        <div className="fixed inset-0 z-[120] bg-black/85 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#111] border border-amber-500/30 rounded-2xl p-5 text-white space-y-4">
            <p className="text-lg font-black">¿Recibiste {clp(efectivoRecibido)}?</p>
            <p className="text-white/70">
              Total {clp(finalTotal)} · Vuelto <span className="font-black text-emerald-300">{clp(cobro.vuelto)}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmarEfectivo(false)}
                className="flex-1 h-14 rounded-xl bg-white/5 text-xs font-black uppercase tracking-widest"
              >
                Corregir
              </button>
              <button
                type="button"
                onClick={() => void handleCheckout(true)}
                className="flex-1 h-14 rounded-xl bg-emerald-500 text-black text-xs font-black uppercase tracking-widest"
              >
                Sí, cobrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escáner */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md relative">
            <button
              onClick={() => setShowScanner(false)}
              aria-label="Cerrar escáner"
              className="absolute -top-14 right-0 h-12 w-12 flex items-center justify-center bg-white/10 rounded-xl text-white hover:bg-red-500 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            <UnifiedScanner
              onDetected={(barcode) => {
                setShowScanner(false);
                void handleCode(barcode);
              }}
            />
          </div>
        </div>
      )}

      {/* Peso para productos que se venden por kilo */}
      {weighing && (
        <WeightPrompt
          product={weighing.product}
          initialKg={weighing.initialKg}
          onCancel={() => setWeighing(null)}
          onConfirm={(kg) => {
            const inCart = cart.some((c) => c.id === weighing.product.id);
            if (inCart) {
              setQuantity(weighing.product.id, kg);
            } else {
              addToCart(weighing.product, kg);
            }
            showToast(`${weighing.product.name}: ${kg.toFixed(3)} kg`, "success", 1500);
            setWeighing(null);
          }}
        />
      )}

      {sinPrecio && (
        <PriceSheet
          product={sinPrecio}
          onCancel={() => {
            setSinPrecio(null);
            showToast("Pregunta el precio: el producto no se agregó", "warning", 4000);
          }}
          onSaved={(p) => {
            setSinPrecio(null);
            upsertLocal(p);
            updateLineProduct(p);
            pickProduct(p);
          }}
        />
      )}

      {quickCreateBarcode !== null && (
        <QuickCreateProductModal
          initialBarcode={quickCreateBarcode}
          onClose={() => setQuickCreateBarcode(null)}
          onCreated={(product) => {
            upsertLocal(product);
            setQuickCreateBarcode(null);
            setSearchQuery("");
            pickProduct(product);
          }}
        />
      )}
    </div>
  );
}
