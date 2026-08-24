import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// Return DATE (oid 1082) as a plain 'YYYY-MM-DD' string instead of a JS Date,
// so the frontend's date helpers receive the format they expect.
pg.types.setTypeParser(1082, (v) => v);

let pool;
if (process.env.PGMEM === "1") {
  // In-memory Postgres (pg-mem) — integration tests without a real database.
  const { newDb, DataType } = await import("pg-mem");
  const { randomUUID } = await import("crypto");
  const fs = await import("fs");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const mem = newDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  /* pg-mem does not implement NULLIF. Production leans on it heavily to fall
     back from a blank billing_name to the trading name, so without this the
     fee-invoice path could not be tested at all — it failed silently inside a
     catch and the tests only saw "no invoice". */
  for (const t of [DataType.text, DataType.integer]) {
    mem.public.registerFunction({
      name: "nullif", args: [t, t], returns: t,
      implementation: (a, b) => (a === b ? null : a),
    });
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  let schema = fs.readFileSync(path.join(here, "..", "schema.sql"), "utf8");
  // enum types live inside idempotent DO blocks — pull them out and run them first
  for (const m of schema.matchAll(/CREATE TYPE [^;]+;/g)) {
    try { mem.public.none(m[0]); } catch (e) { if (process.env.PGMEM_VERBOSE) console.warn("pgmem type:", e.message); }
  }
  schema = schema.replace(/DO \$\$[\s\S]*?\$\$;/g, "");                       // plpgsql DO blocks
  schema = schema.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, "");      // trigger functions
  schema = schema.replace(/CREATE TRIGGER[\s\S]*?;/g, "");
  schema = schema.replace(/CREATE EXTENSION[^;]*;/g, "");
  // Strip line comments BEFORE splitting on ";" — a semicolon inside a comment
  // would otherwise cut a statement in half and silently drop it.
  schema = schema.replace(/^[ \t]*--.*$/gm, "");
  // Partial indexes are a Postgres optimisation with no meaning in-memory, and
  // pg-mem mis-plans equality lookups on the indexed column when one exists
  // (a row with approval_status='approved' stops matching WHERE approval_status='approved').
  // They are pure performance in production, so dropping them here is safe.
  schema = schema.replace(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*\sWHERE\s[^;]*;/gi, "");
  for (const stmt of schema.split(";")) {
    const q = stmt.trim();
    if (!q) continue;
    try { mem.public.none(q); } catch (e) { if (process.env.PGMEM_VERBOSE) console.warn("pgmem skip:", q.slice(0, 60), "→", e.message); }
  }
  const adapter = mem.adapters.createPg();
  pool = new adapter.Pool();
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  });
}

pool.on?.("error", (err) => console.error("DB pool error:", err));

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;

/* ── Does this column exist? ──────────────────────────────────────
   Cached after the first look, because it cannot change while the process is
   running — a migration means a redeploy.

   This replaces matching on error messages, which is where the previous
   attempt broke: Postgres says `column "eu_vat" ... does not exist`, pg-mem
   says `Column "eu_vat" not found`. A guard written against one wording passes
   its own tests and fails in production, which is the worst of both. Asking
   the schema is the same answer everywhere. */
const _cols = new Map();
export async function hasColumn(table, col) {
  const key = `${table}.${col}`;
  if (_cols.has(key)) return _cols.get(key);
  let ok = false;
  try {
    await query(`SELECT ${col} FROM ${table} LIMIT 0`);
    ok = true;
  } catch { ok = false; }
  _cols.set(key, ok);
  if (!ok) console.error(`schema: ${table}.${col} is missing — run schema.sql.`);
  return ok;
}
