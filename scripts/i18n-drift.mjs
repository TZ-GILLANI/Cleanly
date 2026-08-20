/* i18n drift checker.
   Every English string that goes through L(en, hu) must exist in all eight extra
   dictionaries. Prints what is missing, per language, and exits non-zero if any.
   Run: node scripts/i18n-drift.mjs            (add --list to dump the strings)  */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src");

/* ── collect every L("…", "…") first argument across the client ── */
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(f.name)) files.push(p);
  }
})(src);

const wanted = new Set();
// L("en", "hu")  — handles escaped quotes and template-free literals
const re = /\bL\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*,/g;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(text))) {
    const s = m[2].replace(/\\(['"\\])/g, "$1");
    if (s.trim()) wanted.add(s);
  }
}

/* ── load the extra dictionaries ── */
const tPath = path.join(src, "lib", "translations.js");
const tSrc = fs.readFileSync(tPath, "utf8");
const mod = await import("file://" + tPath);
const dicts = mod.EXTRA || mod.default?.EXTRA || mod.default || {};
const langs = Object.keys(dicts).filter((k) => k !== "en" && k !== "hu");

/* ── The blind spot ──────────────────────────────────────────────────────
   The regex above only matches L("…") and L('…'). It does not match
   L(`…${x}…`), because a template literal has no fixed text to use as a
   dictionary key. Those calls were therefore counted as nothing at all: the
   checker reported 0 drift while every one of them reached exactly two of
   twelve languages.

   That is the same failure the untranslated-string detector had — a checker
   that is blind to a category reports success, which is worse than having no
   checker, because it ends the search. So: find them, name them, fail on them. */
const tmplRe = /\bL\(\s*`((?:\\.|[^`\\])*)`\s*,/g;
const templated = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  let m;
  while ((m = tmplRe.exec(text))) {
    templated.push({ file: path.relative(path.join(here, ".."), f), text: m[1] });
  }
}

console.log(`Strings behind L(): ${wanted.size}`);
console.log(`Extra languages:    ${langs.length ? langs.join(", ") : "(none found)"}`);

/* Languages we have committed to keeping complete. A new language starts life
   in ROLLING and is reported but does not fail the build, because partial
   coverage is genuinely fine — anything missing falls back to English. Move it
   into COMPLETE once it is finished, and it can never silently rot after that. */
const COMPLETE = ["de", "ro", "sk", "pl", "uk", "fr", "es", "it", "tr", "zh"];
const ROLLING = [];   // nothing in progress — every language is guaranteed

let missingTotal = 0;
const report = {};
for (const lg of langs) {
  const d = dicts[lg] || {};
  const miss = [...wanted].filter((s) => !(s in d) || !String(d[s] || "").trim());
  report[lg] = miss;
  const gating = !ROLLING.includes(lg);
  if (gating) missingTotal += miss.length;
  const pct = Math.round(((wanted.size - miss.length) / wanted.size) * 100);
  const tag = miss.length === 0 ? "✓" : gating ? `— ${miss.length} missing` : `— ${miss.length} still English (in progress)`;
  console.log(`  ${lg}: ${wanted.size - miss.length}/${wanted.size} (${pct}%) ${tag}`);
}
const unfinished = ROLLING.filter((lg) => (report[lg] || []).length);
if (unfinished.length) {
  console.log(`\n  ${unfinished.join(", ")} are still being translated — untranslated text shows in English,`);
  console.log("  which is correct. Finish with:  node scripts/i18n-fill.mjs " + unfinished.join(" "));
}

if (templated.length) {
  console.log(`\nInterpolated L(\`…\`) — English and Hungarian only, invisible to every`);
  console.log(`other language (${templated.length}):`);
  for (const t of templated) console.log(`  • ${t.file}: ${JSON.stringify(t.text.slice(0, 74))}`);
  console.log("\n  Fix by moving the variable out of the key:");
  console.log('    L(`Serve the whole of ${city}`, …)  ->  L("Serve the whole of {x}", …).replace("{x}", city)');
}

if (process.argv.includes("--list") && missingTotal) {
  const union = [...new Set(Object.values(report).flat())].sort();
  console.log(`\nStrings missing from at least one language (${union.length}):`);
  for (const s of union) console.log("  •", JSON.stringify(s));
}

/* dictionary entries nobody uses any more — dead weight, worth knowing about */
const stale = {};
for (const lg of langs) {
  const extra = Object.keys(dicts[lg] || {}).filter((k) => !wanted.has(k));
  if (extra.length) stale[lg] = extra.length;
}
if (Object.keys(stale).length) console.log("\nUnused dictionary keys:", JSON.stringify(stale));

/* ── The OTHER namespace ──────────────────────────────────────────────────
   The app has two translation systems: L("en","hu") strings, checked above, and
   t("some.key") strings that live in a separate dictionary in i18n.js. The
   checker only ever looked at the first, so a language could be reported as
   100% while every t() string on its screens was still English. */
const i18nPath = path.join(src, "lib", "i18n.js");
const i18nSrc = fs.readFileSync(i18nPath, "utf8");
const blockOf = (code) => {
  const a = `\n  ${code}: {\n`;
  const i = i18nSrc.indexOf(a);
  if (i === -1) return null;
  const from = i + a.length;
  return i18nSrc.slice(from, i18nSrc.indexOf("\n  },", from));
};
const enBlock = blockOf("en") || "";
const tKeys = [...enBlock.matchAll(/"([a-z]+\.[A-Za-z.]+)":/g)].map((m) => m[1]);

console.log(`\nSecond dictionary — t() keys: ${tKeys.length}`);
let tMissingTotal = 0;
for (const lg of [...COMPLETE]) {
  const b = blockOf(lg);
  const miss = b === null ? tKeys : tKeys.filter((k) => !b.includes(`"${k}":`));
  tMissingTotal += miss.length;
  const pct = Math.round(((tKeys.length - miss.length) / tKeys.length) * 100);
  console.log(`  ${lg}: ${tKeys.length - miss.length}/${tKeys.length} (${pct}%) ${miss.length ? `— ${miss.length} missing` : "✓"}`);
}
missingTotal += tMissingTotal;

/* Interpolated strings count. They are not "missing" from a dictionary — they
   can never be in one — so they are counted separately and still gate. */
const grand = missingTotal + templated.length;
console.log(`\n════ DRIFT: ${missingTotal} missing translation${missingTotal === 1 ? "" : "s"}` +
            (templated.length ? ` + ${templated.length} untranslatable interpolated string${templated.length === 1 ? "" : "s"}` : "") +
            ` in the languages we guarantee ════`);
process.exit(grand ? 1 : 0);
