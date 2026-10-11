/**
 * Recorrido E2E de la app real (build de producción) en Chromium, con la API
 * simulada en el navegador (sin Supabase). Mide tiempos y recoge errores.
 *
 *   npx next build && NEXTAUTH_SECRET=test-secret-perf npx next start -p 3100
 *   N=400 node e2e/recorrido.mjs        # N = productos activos en el catálogo
 *
 * Escribe el resultado en e2e/resultados-<N>.json.
 */
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const SECRET = process.env.NEXTAUTH_SECRET ?? "test-secret-perf";
const N = Number(process.env.N ?? 400);
const CPU = Number(process.env.CPU ?? 4); // ralentización de CPU (teléfono gama media)
const EXEC = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";

// ── Datos ────────────────────────────────────────────────────────────
const NOMBRES = ["Harina de trigo", "Arroz grado 1", "Aceite maravilla", "Azúcar", "Leche entera",
  "Fideos spaghetti", "Coca-Cola 1.5L", "Pan de molde", "Yogurt frutilla", "Atún lomitos",
  "Café instantáneo", "Té negro", "Galletas soda", "Mantequilla", "Queso gauda", "Jamón pierna"];
const fila = (barcode, name, extra = {}) => ({
  id: barcode, barcode, name, price: 1000 + (Number(barcode.slice(-3)) % 50) * 100, stock: Number(barcode.slice(-2)) % 30,
  image: "/icons/icon-192.png", slug: name.toLowerCase().replace(/\W+/g, "-"), description: "", categories: ["Almacén"],
  featured: false, byWeight: false, isActive: true, ...extra,
});
const activos = Array.from({ length: N }, (_, i) => {
  const base = NOMBRES[i % NOMBRES.length];
  return fila(String(7800000000000 + i), i < NOMBRES.length ? base : `${base} ${Math.floor(i / NOMBRES.length)}`);
});
const inactivos = [
  fila("7702084137520", "HARINA DE MAÍZ PAN BLANCA", { isActive: false, stock: 0 }),
  fila("7702084137521", "Harina PAN amarilla", { isActive: false, stock: 0 }),
  fila("7790000000099", "Galletas descontinuadas", { isActive: false, stock: 0 }),
];
const todos = () => [...activos, ...inactivos];

// ── Estado del "servidor" simulado ──────────────────────────────────
const estado = { preciosGuardados: [], conteoAbierto: true, guardados: [], ventas: [], desconocidas: new Set(), llamadas: {} };
const sesionConteo = () => ({
  sessionId: "s1", status: "OPEN", applyMode: "ON_CLOSE", openedAt: new Date().toISOString(), openedBy: "Ingrid",
  contados: estado.guardados.length, unidades: estado.guardados.reduce((a, g) => a + g.qty, 0), conDiferencia: 0,
  diferenciaNeta: 0, enCero: 0, marcas: estado.guardados.length, enVariosLugares: 0, movidosDesdeElConteo: 0,
  pendientes: N - estado.guardados.length, totalCatalogo: N,
});

function api(path, params, method, body) {
  const q = (params.get("q") ?? "").trim().toLowerCase();
  switch (path) {
    case "/api/products":
      if (method === "POST") {
        const p = todos().find((x) => x.barcode === body?.barcode);
        if (p && body?.sale_price) p.price = Number(body.sale_price);
        estado.preciosGuardados.push(body);
        return { ok: true };
      }
      return { items: params.get("estado") === "inactivos" ? inactivos : activos };
    case "/api/products/cambios": return { cambios: [] };
    case "/api/products/categorias": return { categorias: ["Almacén"] };
    case "/api/branches": return { branches: [{ id: "b1", name: "Principal", is_default: true }] };
    case "/api/sellers": return { sellers: [{ id: "u1", name: "Fabricio" }, { id: "u2", name: "Ingrid seidel" }] };
    case "/api/caja/estado": return { open: true, shiftId: "t1", startedAt: new Date().toISOString(), startingCash: 20000, branchId: "b1" };
    case "/api/caja/shifts":
      return { shift: { id: "t1", status: "OPEN", branch_id: "b1", started_at: new Date().toISOString(), starting_cash: 15100, opened_by: "u1" }, branchId: "b1" };
    case "/api/caja": return { movements: [], sales: [], shift: { id: "t1", status: "OPEN" }, ventas: [], movimientos: [], resumen: {} };
    case "/api/cuentas": return { cuentas: [], movimientos: [] };
    case "/api/compras-propias/sin-dueno": return { compras: [] };
    case "/api/inventario/conteo":
      return { session: estado.conteoAbierto ? sesionConteo() : null };
    case "/api/inventario/conteo/producto": return { ok: true, contado: 0, marcas: 0 };
    case "/api/inventario/conteo/pendientes": return { total: N, productos: activos.slice(0, 50) };
    case "/api/inventario/conteo/items": {
      for (const it of body?.items ?? []) estado.guardados.push(it);
      return { ok: true, aplicados: body?.items?.length ?? 0, ajustados: 0, desconocidos: [], soloAnotado: true, sumados: 0 };
    }
    case "/api/inventario/buscar": {
      const bc = params.get("barcode");
      if (bc) return { producto: todos().find((p) => p.barcode === bc) ?? null };
      if (q.length < 2) return { productos: [] };
      const ws = q.split(/\s+/);
      const base = params.get("inactivos") === "1" ? inactivos : todos();
      return { productos: base.filter((p) => ws.every((w) => p.name.toLowerCase().includes(w))).slice(0, 25) };
    }
    case "/api/inventario/recepcion": {
      const bcs = (params.get("barcodes") ?? "").split(",").filter(Boolean);
      return { verCosto: true, items: bcs.map((b) => ({ barcode: b, precio: 1000, costoNeto: 600, costoDelProveedor: false, regla: { margen: 0.35, redondeo: "decena", origen: "general" } })) };
    }
    case "/api/sales": estado.ventas.push(body); return { ok: true, id: `v${estado.ventas.length}` };
    default:
      estado.desconocidas.add(`${method} ${path}`);
      return {};
  }
}

// ── Utilidades ──────────────────────────────────────────────────────
const resultados = { N, CPU, fecha: new Date().toISOString(), pasos: [], errores: [], fallas: [] };
const t0 = () => performance.now();
async function paso(nombre, fn) {
  const ini = t0();
  try {
    const extra = await fn();
    const ms = Math.round(t0() - ini);
    resultados.pasos.push({ nombre, ok: true, ms, ...(extra ?? {}) });
    console.log(`✓ ${nombre} — ${ms} ms${extra ? " " + JSON.stringify(extra) : ""}`);
  } catch (e) {
    const ms = Math.round(t0() - ini);
    resultados.pasos.push({ nombre, ok: false, ms, error: String(e.message ?? e).split("\n")[0] });
    resultados.fallas.push(nombre);
    await page?.screenshot({ path: `e2e/falla-${resultados.fallas.length}.png` }).catch(() => {});
    console.log(`✗ ${nombre} — ${String(e.message ?? e).split("\n")[0]}`);
  }
}

// ── Recorrido ───────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  serviceWorkers: "block",
});
const token = await encode({ token: { sub: "u1", uid: "u1", name: "Fabricio", role: "ADMIN" }, secret: SECRET });
await ctx.addCookies([{ name: "next-auth.session-token", value: token, url: BASE }]);

await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname.startsWith("/api/auth/")) return route.continue();
  let body = null;
  try { body = req.postDataJSON(); } catch { /* sin cuerpo */ }
  const k = `${req.method()} ${url.pathname}`;
  estado.llamadas[k] = (estado.llamadas[k] ?? 0) + 1;
  await new Promise((r) => setTimeout(r, 60)); // latencia de red simulada
  await route.fulfill({ json: api(url.pathname, url.searchParams, req.method(), body) });
});

// Barras del sistema simuladas (Android de borde a borde): 32px arriba, 48px abajo.
if (process.env.SAFE !== "0") {
  await ctx.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = ":root{--safe-area-inset-top:32px;--safe-area-inset-bottom:48px}";
      document.head.appendChild(st);
    });
  });
}
const page = await ctx.newPage();
page.on("pageerror", (e) => resultados.errores.push({ tipo: "pageerror", msg: e.message }));
page.on("console", (m) => { if (m.type() === "error") resultados.errores.push({ tipo: "console", msg: m.text().slice(0, 200) }); });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await cdp.send("Performance.enable");

const buscar = (ph = /Buscar producto por nombre/) => page.getByPlaceholder(ph);
const tab = (nombre) => page.getByRole("button", { name: new RegExp(`^${nombre}$`, "i") });

await paso("Carga inicial (/)", async () => {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await tab("Conteo").waitFor();
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const js = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script");
    return {
      ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd),
      fcp: Math.round(fcp?.startTime ?? 0), jsArchivos: js.length,
      jsKB: Math.round(js.reduce((a, r) => a + (r.transferSize || r.encodedBodySize), 0) / 1024),
    };
  });
  return m;
});

await paso("Elegir quién atiende", async () => {
  await page.getByText("¿Quién atiende?").last().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /Fabricio/ }).last().click();
});

await paso("Catálogo cargado en Venta", async () => {
  await page.getByPlaceholder(/Buscar o escanear/).first().waitFor();
});

for (const t of ["Recepción", "Conteo", "Caja", "Productos", "Venta"]) {
  await paso(`Pestaña ${t}`, async () => {
    await tab(t).click();
    await page.waitForTimeout(50);
  });
}

// Venta
await paso("Venta: buscar 'arroz' y agregar al carrito", async () => {
  const inp = page.getByPlaceholder(/Buscar o escanear/).first();
  const ini = t0();
  await inp.fill("arroz");
  await page.getByText("Arroz grado 1", { exact: true }).first().waitFor();
  const resMs = Math.round(t0() - ini);
  await page.getByText("Arroz grado 1", { exact: true }).first().click();
  await inp.fill("");
  return { resultadosEnMs: resMs };
});

await paso("Venta: corregir precio desde el carrito", async () => {
  await page.getByRole("button", { name: "Ver carrito" }).click();
  await page.getByRole("button", { name: /Corregir precio/ }).first().click();
  const inp = page.getByLabel("Precio", { exact: true });
  await inp.fill("1990");
  await page.getByRole("button", { name: /Guardar precio/ }).click();
  await page.getByText(/1\.990 c\/u/).first().waitFor({ timeout: 3000 });
  const guardado = estado.preciosGuardados.at(-1);
  if (Number(guardado?.sale_price) !== 1990) throw new Error("no se envió el precio a la ficha");
  await page.locator("button.h-12", { hasText: "Productos" }).first().click();
  return { enviado: { barcode: guardado.barcode, sale_price: guardado.sale_price } };
});

// Conteo
await tab("Conteo").click();
await paso("Conteo: pantalla con conteo abierto", async () => {
  await page.getByText(/Sin contar/i).first().waitFor();
});

await paso("Conteo: 'harina' trae activo + inactivo (BUG corregido)", async () => {
  const ini = t0();
  await buscar().fill("harina");
  await page.getByText("Harina de trigo", { exact: true }).first().waitFor();
  const activoMs = Math.round(t0() - ini);
  await page.getByText("HARINA DE MAÍZ PAN BLANCA").waitFor({ timeout: 5000 });
  return { activoMs, inactivoMs: Math.round(t0() - ini) };
});

await paso("Conteo: botón Crear visible con coincidencias", async () => {
  await page.getByText(/Crear "harina"/).waitFor({ timeout: 2000 });
});

await paso("Conteo: 'pan harina' (orden inverso) encuentra la Harina PAN", async () => {
  await buscar().fill("pan harina");
  await page.getByText("HARINA DE MAÍZ PAN BLANCA").waitFor({ timeout: 5000 });
});

await paso("Conteo: elegir inactivo → queda en 'Sin guardar'", async () => {
  await page.getByText("HARINA DE MAÍZ PAN BLANCA").click();
  await page.getByText(/Sin guardar \(1\)/i).waitFor({ timeout: 3000 });
});

await paso("Conteo: texto sin resultados → 'Sin coincidencias' + Crear abre modal", async () => {
  await buscar().fill("xyzproductoinexistente");
  await page.getByText("Sin coincidencias.").waitFor({ timeout: 5000 });
  await page.getByText(/Crear "xyzproductoinexistente"/).click();
  await page.locator("input[value='xyzproductoinexistente']").first().waitFor({ timeout: 3000 });
  await page.keyboard.press("Escape");
  const cancelar = page.getByRole("button", { name: /^Cancelar$/ }).last();
  if (await cancelar.isVisible().catch(() => false)) await cancelar.click();
  await buscar().fill("");
});

async function manual(codigo) {
  const btn = page.getByRole("button", { name: /^Manual$/i });
  if (await btn.isVisible().catch(() => false)) await btn.click();
  const inp = page.getByPlaceholder(/Escribe o pega un código/);
  await inp.fill(codigo);
  await inp.press("Enter");
}

await paso("Conteo: código manual de producto activo", async () => {
  await manual(activos[3].barcode);
  await page.getByText(/Sin guardar \(2\)/i).waitFor({ timeout: 3000 });
});

await paso("Conteo: código manual de producto INACTIVO (lo reactiva)", async () => {
  await manual("7702084137521");
  await page.getByText(/Sin guardar \(3\)/i).waitFor({ timeout: 4000 });
});

await paso("Conteo: mismo código de nuevo suma unidad (no duplica línea)", async () => {
  await manual(activos[3].barcode);
  await page.waitForTimeout(700);
  const n = await page.getByText(/Sin guardar \(3\)/i).count();
  if (n !== 1) throw new Error("se duplicó la línea");
});

await paso("Conteo: código desconocido → ofrece crear", async () => {
  await manual("1234567890123");
  await page.locator("input[value='1234567890123']").first().waitFor({ timeout: 4000 });
  await page.keyboard.press("Escape");
  const cancelar = page.getByRole("button", { name: /^Cancelar$/ }).last();
  if (await cancelar.isVisible().catch(() => false)) await cancelar.click();
});

await paso("Conteo: lector láser (tecleo rápido + Enter)", async () => {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.type(activos[5].barcode, { delay: 8 });
  await page.keyboard.press("Enter");
  await page.getByText(/Sin guardar \(4\)/i).waitFor({ timeout: 3000 });
});

await paso("Conteo: Guardar envía el lote", async () => {
  const ini = estado.guardados.length;
  await page.getByRole("button", { name: /^Guardar \d+ contados$/ }).click();
  await page.getByText(/Sin guardar \(0\)/i).waitFor({ timeout: 5000 });
  return { itemsEnviados: estado.guardados.length - ini };
});

await paso("Conteo sin red: escanear y guardar queda en cola", async () => {
  await ctx.setOffline(true);
  await manual(activos[7].barcode);
  await page.getByText(/Sin guardar \(1\)/i).waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: /^Guardar 1 contados$/ }).click();
  await page.waitForTimeout(800);
  const badge = await page.getByText(/sin enviar|pendiente/i).first().isVisible().catch(() => false);
  await ctx.setOffline(false);
  return { avisoPendiente: badge };
});

await paso("Conteo: al volver la red se sincroniza la cola", async () => {
  const antes = estado.guardados.length;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && estado.guardados.length === antes; i++) await page.waitForTimeout(200);
  if (estado.guardados.length === antes) throw new Error("la cola no se envió en 6 s");
});

// Recepción: ¿tiene el mismo problema con inactivos?
await tab("Recepción").click();
await paso("Recepción: 'harina pan' encuentra el inactivo", async () => {
  await buscar().fill("harina pan");
  await page.getByText(/HARINA DE MAÍZ PAN BLANCA/).first().waitFor({ timeout: 5000 });
});
await paso("Recepción: botón Crear visible con coincidencias", async () => {
  await buscar().fill("harina");
  await page.getByText("Harina de trigo", { exact: true }).first().waitFor({ timeout: 3000 });
  await page.getByText(/Crear/).first().waitFor({ timeout: 2000 });
});

// Productos
await tab("Productos").click();
await paso("Productos: buscar 'harina'", async () => {
  const inp = page.getByPlaceholder(/Buscar o escanear/).first();
  await inp.fill("harina");
  await page.getByText("Harina de trigo", { exact: true }).first().waitFor({ timeout: 3000 });
});

// Latencia de tecleo con el catálogo completo
await tab("Venta").click();
await paso("Venta: latencia por tecla (buscador, 10 teclas)", async () => {
  const inp = page.getByPlaceholder(/Buscar o escanear/).first();
  await inp.fill("");
  const tiempos = [];
  for (const ch of "galletas s") {
    const ini = t0();
    await inp.press(ch === " " ? "Space" : ch);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    tiempos.push(t0() - ini);
  }
  tiempos.sort((a, b) => a - b);
  return { medianaMs: Math.round(tiempos[5]), maxMs: Math.round(tiempos.at(-1)) };
});

await paso("Zonas seguras: nada importante bajo las barras del sistema", async () => {
  const vh = page.viewportSize().height;
  const chip = await page.getByRole("button", { name: /Fabricio/ }).first().boundingBox();
  await tab("Caja").click();
  await page.getByRole("button", { name: /Cierre/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/captura-caja-safe.png" });
  const btn = page.getByRole("button", { name: /Siguiente|Registrar cierre/i }).last();
  const b = (await btn.isVisible().catch(() => false)) ? await btn.boundingBox() : null;
  if (chip.y < 32) throw new Error(`chip de quién atiende bajo la barra de estado (y=${chip.y})`);
  if (b && b.y + b.height > vh - 48) throw new Error(`botón bajo la barra de navegación (bottom=${b.y + b.height}, límite=${vh - 48})`);
  return { chipY: Math.round(chip.y), botonAbajo: b ? Math.round(b.y + b.height) : "no visible", limite: vh - 48 };
});

const perf = await cdp.send("Performance.getMetrics");
const met = Object.fromEntries(perf.metrics.map((m) => [m.name, m.value]));
resultados.memoria = { jsHeapMB: +(met.JSHeapUsedSize / 1048576).toFixed(1), nodosDOM: met.Nodes, layouts: met.LayoutCount };
resultados.llamadasApi = estado.llamadas;
resultados.endpointsSinSimular = [...estado.desconocidas];
await page.screenshot({ path: `e2e/captura-${N}.png` });
await browser.close();

writeFileSync(`e2e/resultados-${N}.json`, JSON.stringify(resultados, null, 2));
console.log("\nMemoria:", resultados.memoria);
console.log("Errores de página:", resultados.errores.length, resultados.errores.slice(0, 8));
console.log("Endpoints sin simular:", resultados.endpointsSinSimular);
console.log(`\n${resultados.pasos.filter((p) => p.ok).length}/${resultados.pasos.length} pasos OK`);
