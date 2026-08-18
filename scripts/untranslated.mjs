/* UNTRANSLATED SWEEP — English that never reaches the translator.

   scripts/i18n-drift.mjs answers "is every string we translate present in every
   language". It cannot answer the prior question: "is every string the user
   reads actually wrapped for translation at all". A hardcoded label is invisible
   to it — the dictionary is complete, and the screen is still half English.

   This walks src/App.jsx, works out which of the four interfaces each component
   belongs to from its name, and reports user-visible text that is a bare
   literal: JSX text nodes, placeholders, titles, aria-labels and toasts.

   Run: node scripts/untranslated.mjs [--all]                                  */
import fs from "fs";

const src = fs.readFileSync("src/App.jsx", "utf8");
const lines = src.split("\n");

/* Which interface owns which component. Anything unmatched is shared chrome. */
const ROLE = (name) =>
  /^CustomerReportQueue$/.test(name) ? "admin" :   /* the ADMIN queue of reports ABOUT customers */
  /^Customer/.test(name) ? "customer" :
  /^Company/.test(name) ? "company" :
  /^Employee/.test(name) ? "cleaner" :
  /^(Admin|Billing|ReviewReports)/.test(name) ? "admin" : "shared";

/* Component boundaries: top-level `function Name(` declarations. */
const comps = [];
lines.forEach((ln, i) => {
  const m = /^function ([A-Z]\w+)\s*\(/.exec(ln);
  if (m) comps.push({ name: m[1], role: ROLE(m[1]), start: i });
});
comps.forEach((c, i) => { c.end = i + 1 < comps.length ? comps[i + 1].start : lines.length; });
const owner = (i) => comps.find((c) => i >= c.start && i < c.end);

/* A literal is suspicious when it reads like a sentence a person would see. */
/* Labels very often lead with an emoji ("Solve in chat" behind a speech
   bubble). Judge the words, not the decoration — the first version of this
   script walked straight past every button in the app. */
const strip = (t) => t.replace(/^[^\p{L}\p{N}]+/u, "").trim();
const WORDS = /^[A-Za-zÀ-ſ][\w'’À-ſ]*(\s+[\w'’À-ſ.,!?%()/-]+){1,}$/;
const SKIP = /^(https?:|data:|#|\/|[\d\s.,:%-]+$)|^(px|rgba?|solid|none|center|flex|absolute|relative|hidden|pointer|bold|700|600)$/i;

/* Positions already inside L( ... ) or t( ... ) are fine. */
const wrapped = new Set();
for (const m of src.matchAll(/\b[Lt]\(\s*"(?:[^"\\]|\\.)*"/g)) wrapped.add(m.index);
const isWrapped = (idx) => {
  for (const w of wrapped) if (idx > w && idx < w + 400) {
    const seg = src.slice(w, idx);
    if (!seg.includes(")") || seg.split("(").length > seg.split(")").length) return true;
  }
  return false;
};

const hits = [];
const push = (i, text, kind) => {
  const o = owner(i);
  if (!o) return;
  hits.push({ role: o.role, comp: o.name, line: i + 1, text: text.trim(), kind });
};

/* 1 — JSX text nodes: >Some words< */
for (const m of src.matchAll(/>([^<>{}\n]{3,90})</g)) {
  const t = strip(m[1]);
  if (!WORDS.test(t) || SKIP.test(t)) continue;
  if (isWrapped(m.index)) continue;
  push(src.slice(0, m.index).split("\n").length - 1, t, "text");
}
/* 2 — attributes a user reads */
for (const m of src.matchAll(/\b(placeholder|title|aria-label)=\{?"([^"]{4,90})"/g)) {
  const t = strip(m[2]);
  if (!WORDS.test(t) || SKIP.test(t)) continue;
  if (isWrapped(m.index)) continue;
  push(src.slice(0, m.index).split("\n").length - 1, t, m[1]);
}
/* 3 — toasts and alerts */
for (const m of src.matchAll(/\btoast\(\s*"([^"]{4,120})"/g)) {
  const t = strip(m[1]);
  if (SKIP.test(t)) continue;
  if (isWrapped(m.index)) continue;
  push(src.slice(0, m.index).split("\n").length - 1, t, "toast");
}

const ROLES = ["customer", "company", "cleaner", "admin", "shared"];
const byRole = Object.fromEntries(ROLES.map((r) => [r, hits.filter((h) => h.role === r)]));

console.log("UNTRANSLATED USER-FACING TEXT\n");
let total = 0;
for (const r of ROLES) {
  const list = byRole[r];
  total += list.length;
  console.log(`  ${r.padEnd(9)} ${String(list.length).padStart(3)} ${list.length ? "✗" : "✓"}`);
}
if (process.argv.includes("--all") && total) {
  for (const r of ROLES) {
    if (!byRole[r].length) continue;
    console.log(`\n── ${r} ──`);
    for (const h of byRole[r]) console.log(`  ${String(h.line).padStart(5)}  ${h.comp.padEnd(22)} [${h.kind}] ${h.text}`);
  }
}
console.log(`\n════ ${total} untranslated string${total === 1 ? "" : "s"} across the four interfaces ════`);
process.exit(0);
