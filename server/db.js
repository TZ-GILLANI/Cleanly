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
