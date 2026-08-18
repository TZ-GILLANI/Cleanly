/* ENDPOINT COVERAGE — which routes does no test ever call?

   Counting tests tells you how much was written, not how much is protected.
   This lists the server's routes and marks the ones no suite touches: the
   surface where a mistake ships silently.

   Run: node scripts/coverage.mjs [--all]                                     */
import fs from "fs";

const idx = fs.readFileSync("server/index.js", "utf8");
const files = {};
for (const m of idx.matchAll(/import\s+(\w+)(?:,\s*\{[^}]*\})?\s+from\s+"\.\/routes\/([a-z-]+)\.js"/g)) files[m[1]] = m[2];
const mounts = [];
for (const m of idx.matchAll(/app\.use\(\s*"(\/api\/[a-z-]+)"\s*,\s*(\w+)\s*\)/g)) mounts.push([m[1], files[m[2]]]);
for (const m of idx.matchAll(/app\.use\(\s*"(\/api\/[a-z-]+)"\s*,\s*\(await import\("\.\/routes\/([a-z-]+)\.js"\)\)/g)) mounts.push([m[1], m[2]]);

const routes = [];
for (const [prefix, f] of mounts) {
  if (!f) continue;
  const src = fs.readFileSync(`server/routes/${f}.js`, "utf8");
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g)) {
    routes.push({ method: m[1].toUpperCase(), path: (prefix + m[2]).replace(/\/$/, "") || prefix, file: f });
  }
}
for (const m of idx.matchAll(/app\.(get|post)\(\s*"(\/api\/[^"]+)"/g)) routes.push({ method: m[1].toUpperCase(), path: m[2], file: "index" });

const tests = fs.readdirSync("test").filter((f) => f.endsWith(".mjs"))
  .map((f) => fs.readFileSync(`test/${f}`, "utf8")).join("\n");

/* every literal path a test asks for */
const asked = new Set();
for (const m of tests.matchAll(/["'`](\/api\/[^"'`\s)]+)["'`]/g)) asked.add(m[1]);
for (const m of tests.matchAll(/j\(\s*`([^`]+)`/g)) asked.add(m[1]);

const norm = (p) => p.split("?")[0].replace(/\$\{[^}]+\}/g, "*").replace(/\/$/, "");
const covered = (r) => {
  const t = norm(r.path).split("/").filter(Boolean);
  return [...asked].some((a) => {
    const c = norm(a).split("/").filter(Boolean);
    if (c.length !== t.length) return false;
    return t.every((seg, i) => seg.startsWith(":") || c[i] === "*" || c[i] === seg);
  });
};

const miss = routes.filter((r) => !covered(r));
const byFile = {};
for (const r of miss) (byFile[r.file] ||= []).push(r);

console.log(`ENDPOINT COVERAGE\n\n  ${routes.length} routes · ${routes.length - miss.length} touched by tests · ${miss.length} not\n`);
for (const f of Object.keys(byFile).sort()) {
  console.log(`  ${f}`);
  for (const r of byFile[f]) console.log(`     ${r.method.padEnd(6)} ${r.path}`);
}
console.log(`\n════ ${miss.length} endpoints with no test ════`);
