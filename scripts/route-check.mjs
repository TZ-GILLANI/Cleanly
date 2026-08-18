/* ROUTE CHECK — does every path the app calls actually exist on the server?

   The test suites only exercise the endpoints they were written for, so a
   client call that points at a route which was renamed or deleted passes every
   test and fails in a user's hand. This walks the other direction: it reads the
   paths out of the app, reads the routes out of the server, and compares.

   Run: node scripts/route-check.mjs                                          */
import fs from "fs";

const client = fs.readFileSync("src/store.jsx", "utf8") + fs.readFileSync("src/App.jsx", "utf8");

/* api("/x") and api(`/x/${y}`) */
const calls = new Set();
for (const m of client.matchAll(/\bapi\(\s*[`"']([^`"']+)[`"']/g)) calls.add(m[1]);
for (const m of client.matchAll(/\bapi\(\s*`([^`]+)`/g)) calls.add(m[1]);
for (const m of client.matchAll(/API_BASE\s*\|\|\s*""\)\s*\+\s*[`"']([^`"']+)/g)) calls.add(m[1]);
for (const m of client.matchAll(/\$\{API_BASE \|\| ""\}(\/[a-zA-Z0-9\/._${}?=-]+)/g)) calls.add(m[1]);

/* mounted prefixes */
const idx = fs.readFileSync("server/index.js", "utf8");
const files = {};
for (const m of idx.matchAll(/import\s+(\w+)(?:,\s*\{[^}]*\})?\s+from\s+"\.\/routes\/([a-z-]+)\.js"/g)) files[m[1]] = m[2];
const mounts = [];
/* two mounting styles: a named import, and an inline dynamic import */
for (const m of idx.matchAll(/app\.use\(\s*"(\/api\/[a-z-]+)"\s*,\s*(\w+)\s*\)/g)) mounts.push([m[1], files[m[2]]]);
for (const m of idx.matchAll(/app\.use\(\s*"(\/api\/[a-z-]+)"\s*,\s*\(await import\("\.\/routes\/([a-z-]+)\.js"\)\)/g)) mounts.push([m[1], m[2]]);

const routes = [];
for (const [prefix, f] of mounts) {
  if (!f) continue;
  const src = fs.readFileSync(`server/routes/${f}.js`, "utf8");
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g)) {
    routes.push({ method: m[1].toUpperCase(), path: (prefix + m[2]).replace(/\/$/, "") || prefix });
  }
}
/* plain app.get on the server root */
for (const m of idx.matchAll(/app\.(get|post)\(\s*"([^"]+)"/g)) routes.push({ method: m[1].toUpperCase(), path: m[2] });

const norm = (p) => p.split("?")[0].replace(/\$\{[^}]+\}/g, ":x").replace(/\/$/, "");
const matches = (call) => {
  const c = norm(call).split("/").filter(Boolean);
  return routes.some((r) => {
    const t = norm(r.path).split("/").filter(Boolean);
    if (t.length !== c.length) return false;
    return t.every((seg, i) => seg.startsWith(":") || c[i] === ":x" || seg === c[i]);
  });
};

/* Two shapes the naive matcher gets wrong:
   · api("/x/" + id)  — the concatenated segment is invisible in the literal
   · "/privacy"       — served off the app root, not under /api                */
const expand = (c) => (c.endsWith("/") ? [c + ":x", c] : [c]);
const candidates = (c) => expand(c).flatMap((x) => [x, x.startsWith("/api") ? x : "/api" + x]);
const missing = [...calls].filter((c) => c.startsWith("/") && !candidates(c).some(matches));
console.log(`client call sites: ${calls.size}   server routes: ${routes.length}`);
if (missing.length) { console.log("\nNO SERVER ROUTE FOR:"); missing.forEach((m) => console.log("  ✗", m)); process.exit(1); }
console.log("\n✓ every path the app calls exists on the server");
