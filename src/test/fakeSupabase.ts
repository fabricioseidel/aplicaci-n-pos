/**
 * Base en memoria con la forma del cliente de supabase-js, para testear rutas
 * sin red. Soporta lo que usan las rutas de productos: select/insert/update,
 * eq/is/in/not/or/gte, order, limit, maybeSingle y rpc.
 */
type Fila = Record<string, unknown>;
type Filtro = (f: Fila) => boolean;

export interface FakeDb {
  tablas: Record<string, Fila[]>;
  rpcs: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>;
  llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }>;
}

export function crearFakeDb(tablas: Record<string, Fila[]> = {}): FakeDb {
  return { tablas, rpcs: {}, llamadasRpc: [] };
}

class Consulta implements PromiseLike<{ data: unknown; error: unknown }> {
  private filtros: Filtro[] = [];
  private op: "select" | "update" | "insert" = "select";
  private valores: Fila | Fila[] | null = null;
  private unico = false;
  private limite: number | null = null;
  private devolver = false;

  constructor(private db: FakeDb, private tabla: string) {}

  private filas() {
    return (this.db.tablas[this.tabla] ??= []);
  }
  select() {
    if (this.op !== "select") this.devolver = true;
    return this;
  }
  insert(v: Fila | Fila[]) {
    this.op = "insert";
    this.valores = v;
    return this;
  }
  update(v: Fila) {
    this.op = "update";
    this.valores = v;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filtros.push((f) => f[k] === v);
    return this;
  }
  is(k: string, v: unknown) {
    this.filtros.push((f) => (f[k] ?? null) === v);
    return this;
  }
  in(k: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[k]));
    return this;
  }
  not(k: string, _op: string, v: unknown) {
    this.filtros.push((f) => (f[k] ?? null) !== v);
    return this;
  }
  gte(k: string, v: string) {
    this.filtros.push((f) => String(f[k]) >= v);
    return this;
  }
  or() {
    this.filtros.push((f) => f.is_active === null || f.is_active === undefined || f.is_active === true);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  maybeSingle() {
    this.unico = true;
    return this;
  }

  private ejecutar(): { data: unknown; error: unknown } {
    const coinciden = this.filas().filter((f) => this.filtros.every((fn) => fn(f)));
    if (this.op === "insert") {
      const nuevas = (Array.isArray(this.valores) ? this.valores : [this.valores!]).map((v) => ({ ...v }));
      for (const n of nuevas) {
        if (n.barcode && this.filas().some((f) => f.barcode === n.barcode)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
      }
      this.filas().push(...nuevas);
      return { data: nuevas, error: null };
    }
    if (this.op === "update") {
      for (const f of coinciden) Object.assign(f, this.valores);
      return { data: this.devolver ? coinciden.map((f) => ({ ...f })) : null, error: null };
    }
    const lista = this.limite ? coinciden.slice(0, this.limite) : coinciden;
    if (this.unico) return { data: lista[0] ? { ...lista[0] } : null, error: null };
    return { data: lista.map((f) => ({ ...f })), error: null };
  }

  then<A, B>(
    ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.ejecutar()).then(ok, fail);
  }
}

export function clienteFake(db: FakeDb) {
  return {
    from: (tabla: string) => new Consulta(db, tabla),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.llamadasRpc.push({ fn, args });
      return db.rpcs[fn] ? db.rpcs[fn](args) : { data: null, error: { message: `rpc ${fn} no simulado` } };
    },
  };
}
