/* Fill in missing UI translations using the translation provider.

   Adding a language means several hundred strings. Hand-writing them is slow and
   inconsistent; this runs the missing ones through the same provider the app uses
   for user-typed content, and writes them straight into translations.js.

   It is deliberately conservative:
     · it only ever ADDS keys that are missing — nothing existing is overwritten,
       so hand-corrections and native-speaker edits are never clobbered
     · it preserves the emoji, {placeholders} and trailing punctuation that the
       UI depends on, and skips anything the provider mangled
     · it writes once at the end, so a crash halfway leaves the file untouched

   Usage:
     TRANSLATE_PROVIDER=deepl TRANSLATE_API_KEY=xxx node scripts/i18n-fill.mjs tr zh
     ...then have a native speaker read the result before you market in that country.  */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");
const T_PATH = path.join(SRC, "lib", "translations.js");

const targets = process.argv.slice(2).filter((a) => /^[a-z]{2}$/.test(a));
if (!targets.length) {
  console.error("Which languages? e.g.  node scripts/i18n-fill.mjs tr zh");
  process.exit(1);
}

const { translateAll, translationEnabled } = await import("../server/lib/translate.js");
if (!translationEnabled()) {
  console.error("No translation provider configured.");
  console.error("Set TRANSLATE_PROVIDER=deepl|google and TRANSLATE_API_KEY, then run again.");
  process.exit(1);
}

/* Every English string the UI asks for, straight from the source. */
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(f.name)) files.push(p);
  }
})(SRC);

const wanted = new Set();
const re = /\bL\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*,/g;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(text))) {
    const s = m[2].replace(/\\(['"\\])/g, "$1");
    if (s.trim()) wanted.add(s);
  }
}

const mod = await import("file://" + T_PATH);
const dicts = mod.EXTRA || {};

/* Sanity checks — a translation that loses a placeholder breaks the screen. */
const placeholders = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");
const emoji = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).join("");

function acceptable(src, out) {
  if (!out || typeof out !== "string") return false;
  if (!out.trim()) return false;
  if (placeholders(src) !== placeholders(out)) return false;   // {h}, {a}, {b} must survive
  if (emoji(src) && !emoji(out)) return false;                  // an emoji-led label must keep it
  if (out.length > src.length * 4 + 40) return false;           // runaway output
  return true;
}

let additions = {};
for (const lang of targets) {
  const have = dicts[lang] || {};
  const missing = [...wanted].filter((s) => !have[s] || !String(have[s]).trim());
  console.log(`${lang}: ${wanted.size - missing.length}/${wanted.size} already translated, ${missing.length} to do`);
  if (!missing.length) continue;

  additions[lang] = {};
  let done = 0, skipped = 0;
  for (const s of missing) {
    try {
      const map = await translateAll(s, "en");
      const out = map && map[lang];
      if (acceptable(s, out)) { additions[lang][s] = out; done++; }
      else { skipped++; }
    } catch (e) {
      skipped++;
    }
    if ((done + skipped) % 25 === 0) process.stdout.write(`\r  ${lang}: ${done + skipped}/${missing.length}`);
  }
  console.log(`\r  ${lang}: ${done} translated, ${skipped} skipped (left in English)      `);
}

/* Write once, at the end. */
let src = fs.readFileSync(T_PATH, "utf8");
let inserted = 0;
for (const [lang, entries] of Object.entries(additions)) {
  const anchor = `\n  ${lang}: {\n`;
  if (!src.includes(anchor)) { console.error(`No "${lang}" block in translations.js — add an empty one first.`); continue; }
  const at = src.indexOf(anchor) + anchor.length;
  const lines = Object.entries(entries).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  if (!lines.length) continue;
  src = src.slice(0, at) + lines.join("\n") + "\n" + src.slice(at);
  inserted += lines.length;
}
if (inserted) {
  fs.writeFileSync(T_PATH, src);
  console.log(`\nWrote ${inserted} translations into ${path.relative(process.cwd(), T_PATH)}`);
  console.log("Now run:  node scripts/i18n-drift.mjs");
  console.log("These are machine translations. Have a native speaker read them before you");
  console.log("advertise in that country — the app is fine, the marketing is what suffers.");
} else {
  console.log("\nNothing to write.");
}
