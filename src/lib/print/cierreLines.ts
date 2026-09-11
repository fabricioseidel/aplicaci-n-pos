import { clp } from "@/lib/cierre/denominations";
import type { CierreResumen } from "@/lib/cierre/types";

/**
 * Arma el cierre como líneas de texto de ancho fijo.
 *
 * Se separa del renderizado a propósito: hoy estas líneas se dibujan en un PDF
 * de 58 mm que se manda a la app de la impresora, pero son exactamente el
 * formato que espera una térmica por ESC/POS. Si algún día se imprime directo
 * desde la app, se reusa esto sin reescribir el cierre.
 */
export const TICKET_COLS = 32;

const rule = (char = "-") => char.repeat(TICKET_COLS);

const center = (text: string) => {
  const t = text.slice(0, TICKET_COLS);
  const pad = Math.max(0, Math.floor((TICKET_COLS - t.length) / 2));
  return " ".repeat(pad) + t;
};

/** Etiqueta a la izquierda, monto pegado al borde derecho. */
const row = (label: string, amount: number | string) => {
  const right = typeof amount === "number" ? clp(amount) : amount;
  const room = TICKET_COLS - right.length - 1;
  const left = label.length > room ? label.slice(0, room) : label;
  return left + " ".repeat(TICKET_COLS - left.length - right.length) + right;
};

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatBusinessDate(iso: string): string {
  // Se parsea a mano: `new Date("2026-09-10")` es UTC y en Chile retrocede un día.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dd}/${mm}/${y} ${DAYS[dt.getDay()]}`;
}

// La zona se fuerza a Chile en vez de usar la del aparato: el PDF puede
// generarse desde el computador o desde un celular con la hora en otra zona,
// y un cierre archivado con la hora corrida no se puede auditar después.
const hhmm = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("es-CL", {
        timeZone: "America/Santiago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--:--";

export function buildCierreLines(r: CierreResumen): string[] {
  const t = r.shift.declared_totals;
  const out: string[] = [];

  out.push(center("OLIVOMARKET"), center("CIERRE DE CAJA"), rule("="));
  out.push(`Fecha  ${formatBusinessDate(r.shift.business_date)}`);
  out.push(`Local  ${r.branch ?? "Principal"}`);
  out.push(`Turno  ${hhmm(r.shift.started_at)} a ${hhmm(r.shift.ended_at)}`);
  out.push(rule());

  out.push("VENTAS DEL DIA");
  out.push(row("Efectivo", t?.CASH.ventas ?? 0));
  out.push(row("Transferencia", t?.TRANSFER.ventas ?? 0));
  out.push(row("Tarjeta", t?.CARD.ventas ?? 0));
  out.push(rule());
  out.push(row("TOTAL VENTAS", t?.total_ventas ?? 0));
  out.push(rule());

  // ── Efectivo ────────────────────────────────────────────────────────────
  out.push("EFECTIVO");
  out.push(row("Sencillo inicial", t?.CASH.inicial ?? 0));
  out.push(row("+ Ventas efectivo", t?.CASH.ventas ?? 0));
  if ((t?.CASH.abonos ?? 0) > 0) out.push(row("+ Abonos fiado", t!.CASH.abonos));
  if ((t?.CASH.ingresos ?? 0) > 0) out.push(row("+ Otros ingresos", t!.CASH.ingresos!));
  if ((t?.CASH.egresos ?? 0) > 0) out.push(row("- Retiros/gastos", t!.CASH.egresos!));
  out.push(row("= CONTADO EN CAJA", r.shift.actual_cash ?? 0));

  if (r.denominations.length > 0) {
    out.push("");
    out.push("Conteo de billetes");
    for (const d of r.denominations) {
      const etiqueta = `  ${d.denomination.toLocaleString("es-CL")} x ${d.quantity}`;
      out.push(row(etiqueta, d.subtotal));
    }
  }
  out.push(rule());

  // ── Transferencias ──────────────────────────────────────────────────────
  if (r.transfers.length > 0) {
    out.push(`TRANSFERENCIAS (${r.transfers.length})`);
    r.transfers.forEach((tr, i) => {
      out.push(row(`  ${i + 1}. ${tr.payer ?? ""}`.trimEnd(), tr.amount));
    });
    out.push(row("Total transferencias", r.transfers.reduce((a, x) => a + Number(x.amount), 0)));
    out.push(rule());
  }

  // ── Vouchers ────────────────────────────────────────────────────────────
  if (r.vouchers.length > 0) {
    out.push(`VOUCHERS DE MAQUINA (${r.vouchers.length})`);
    for (const v of r.vouchers) {
      out.push(`Term ${v.terminal_code ?? "-"}  ${hhmm(v.closed_at)}`);
      if (Number(v.credit_amount) > 0) out.push(row("  Credito", v.credit_amount));
      if (Number(v.debit_amount) > 0) out.push(row("  Debito", v.debit_amount));
      if (Number(v.prepaid_amount) > 0) out.push(row("  Prepago", v.prepaid_amount));
      if (Number(v.cash_amount) > 0) out.push(row("  Efectivo", v.cash_amount));
      out.push(row("  Total voucher", v.total_amount));
      // Un voucher cuyas partes no suman el total está mal transcrito, y eso
      // hay que verlo en el papel archivado, no sólo en la pantalla.
      const desc = Number(v.total_amount) - Number(v.parts_total);
      if (Math.abs(desc) > 0.5) out.push(row("  !! DESCUADRE", desc));
    }
    out.push(row("Total tarjeta", r.vouchers.reduce((a, v) => a + Number(v.total_amount), 0)));
    out.push(rule());
  }

  // ── Fiados ──────────────────────────────────────────────────────────────
  const cargos = r.account_entries.filter((e) => e.kind === "CHARGE");
  const abonos = r.account_entries.filter((e) => e.kind === "PAYMENT");

  if (cargos.length > 0) {
    out.push("FIADO DE HOY");
    for (const c of cargos) out.push(row(`  ${c.name}`, c.amount));
    out.push(row("Total fiado", t?.fiados_otorgados ?? 0));
    out.push(rule());
  }

  if (abonos.length > 0) {
    out.push("ABONOS RECIBIDOS");
    for (const a of abonos) out.push(row(`  ${a.name}`, a.amount));
    out.push(row("Total abonos", t?.abonos_recibidos ?? 0));
    out.push(rule());
  }

  if (r.balances.length > 0) {
    out.push("DEUDAS VIGENTES");
    for (const b of r.balances) out.push(row(`  ${b.name}`, b.balance));
    out.push(row("TOTAL POR COBRAR", r.balances.reduce((a, b) => a + Number(b.balance), 0)));
    out.push(rule());
  }

  if (r.shift.notes) {
    out.push("OBSERVACIONES");
    // El texto libre se parte a mano: el PDF no reajusta líneas por sí solo.
    for (const chunk of wrap(r.shift.notes, TICKET_COLS)) out.push(chunk);
    out.push(rule());
  }

  out.push("");
  out.push("Firma: _______________________");
  out.push("");
  out.push(center(`Registrado ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}`));
  out.push("");

  return out;
}

function wrap(text: string, cols: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > cols) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current ? current + " " : "") + w;
    }
  }
  if (current) lines.push(current);
  return lines;
}
