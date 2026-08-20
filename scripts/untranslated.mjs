/* UNTRANSLATED SWEEP — English that never reaches the translator.

   The first version of this script looked at JSX text nodes, placeholders and
   toasts. It reported zero while entire screens were still English, because
   most of this app's copy is not JSX text at all — it is strings passed as
   props (label=, hint=, sub=) and strings inside object literals (the stat
   cards, the filter chips, the empty states).

   A checker that answers "clean" while the screen is visibly English is worse
   than no checker: it turns an open question into false confidence.

   This version reads every string literal and asks a simpler question: does
   this look like something a person reads? If so, it must be inside L() or t().

   Run: node scripts/untranslated.mjs [--all]                                  */
import fs from "fs";

const src = fs.readFileSync("src/App.jsx", "utf8");
const lines = src.split("\n");

const ROLE = (name) =>
  /^CustomerReportQueue$/.test(name) ? "admin" :
  /^Customer/.test(name) ? "customer" :
  /^Company/.test(name) ? "company" :
  /^Employee/.test(name) ? "cleaner" :
  /^(Admin|Billing|ReviewReports)/.test(name) ? "admin" : "shared";

const comps = [];
lines.forEach((ln, i) => {
  const m = /^function ([A-Z]\w+)\s*\(/.exec(ln);
  if (m) comps.push({ name: m[1], role: ROLE(m[1]), start: i });
});
comps.forEach((c, i) => { c.end = i + 1 < comps.length ? comps[i + 1].start : lines.length; });
const owner = (i) => comps.find((c) => i >= c.start && i < c.end);

/* Ranges already inside L( ... ) or t( ... ), matched by brace depth so a
   nested call cannot end the range early. */
/* Comments are not copy. Block comments in this file are long and full of
   ordinary English sentences, and counting them buried the real findings. */
const comments = [];
for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) comments.push([m.index, m.index + m[0].length]);
for (const m of src.matchAll(/\/\/[^\n]*/g)) comments.push([m.index, m.index + m[0].length]);
const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);

const covered = [];
for (const m of src.matchAll(/\b([Lt])\(/g)) {
  let d = 1, i = m.index + m[0].length;
  while (i < src.length && d > 0) {
    const ch = src[i];
    if (ch === "(") d++;
    else if (ch === ")") d--;
    else if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
    }
    i++;
  }
  covered.push([m.index, i]);
}
const inside = (i) => covered.some(([a, b]) => i > a && i < b);

const SKIPPED_KEY = /\b(style|className|class|key|id|type|href|src|accept|autoComplete|inputMode|pattern|rel|target|method|role|fill|stroke|viewBox|xmlns|transform|points|icon|emoji|bg|color|url|status|code|lang|locale|currency|padding|margin|gap|inset|borderRadius|border|width|height|top|left|right|bottom|transition|animation|flex|grid|gridTemplateColumns|fontFamily|background|border|boxShadow|display|position|textAlign|flexDirection|justifyContent|alignItems|objectFit|whiteSpace|wordBreak|textDecoration|overflow|cursor)\s*[:=]\s*$/;
const LOOKS_LIKE_DATA = /^(https?:|data:|\/|#|[\d\s.,:%+-]+$|[a-z0-9_-]+$|[A-Z_]+$)/;

/* CSS values and code fragments are the bulk of the string literals in a file
   like this. Neither is copy, and a list full of "11px 8px" is a list nobody
   reads to the end. */
const CSS_VALUE = /(^|\s)(\d+(\.\d+)?(px|rem|em|vh|vw|%|s|ms)\b|rgba?\(|calc\(|var\(|#[0-9a-f]{3,8}\b)/i;
const CODE_FRAGMENT = /(=>|\)\s*\{|\bconst\b|\bMath\.|<\/|\/>|\$\{|\breturn\b|\bfunction\b|\.map\(|\.split\(|\bnew [A-Z])/;
const HAS_WORDS = /[A-Za-zÀ-ſ][a-zà-ſ]+(\s+\S+){1,}/;

const hits = [];
for (const m of src.matchAll(/"((?:[^"\\\n]|\\.){4,120})"/g)) {
  const raw = m[1];
  const text = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!HAS_WORDS.test(text) || LOOKS_LIKE_DATA.test(text)) continue;
  if (CSS_VALUE.test(text) || CODE_FRAGMENT.test(text)) continue;
  /* Country names are endonyms — Magyarország, Österreich, Türkiye. Translating
     them is wrong, not missing. A leading flag marks them unambiguously. */
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}/u.test(raw)) continue;
  /* A quoted run that begins with code punctuation is not a string at all —
     it is the gap between two empty strings that the regex matched across. */
  if (/^[,).?|:;=&+\]}]/.test(raw.trimStart()) || /[,({[]$/.test(raw.trim())) continue;
  /* JS operators inside the run mean the regex matched across two empty
     strings and captured the expression between them. */
  if (/===|!==|\?\s|\s\?|><|\+\s*$|^\s*\+/.test(raw)) continue;
  if (/\b(co|f|p|b|s|u|r|d)\?\.|\|\||\?\?/.test(raw)) continue;
  if (/^[a-z]+([A-Z]\w+)+$/.test(text)) continue;
  const before = src.slice(Math.max(0, m.index - 60), m.index);
  if (SKIPPED_KEY.test(before)) continue;
  if (/\/\/[^\n]*$/.test(before)) continue;
  if (inside(m.index) || inComment(m.index)) continue;
  /* Errors thrown for our own logs are not shown to anyone. */
  if (/new Error\($/.test(before)) continue;
  const line = src.slice(0, m.index).split("\n").length - 1;
  const o = owner(line);
  if (!o) continue;
  hits.push({ role: o.role, comp: o.name, line: line + 1, text: raw.slice(0, 80) });
}

const ROLES = ["customer", "company", "cleaner", "admin", "shared"];
const byRole = Object.fromEntries(ROLES.map((r) => [r, hits.filter((h) => h.role === r)]));
console.log("UNTRANSLATED USER-FACING TEXT\n");
let total = 0;
for (const r of ROLES) {
  total += byRole[r].length;
  console.log(`  ${r.padEnd(9)} ${String(byRole[r].length).padStart(3)} ${byRole[r].length ? "✗" : "✓"}`);
}
if (process.argv.includes("--all") && total) {
  for (const r of ROLES) {
    if (!byRole[r].length) continue;
    console.log(`\n── ${r} ──`);
    for (const h of byRole[r]) console.log(`  ${String(h.line).padStart(5)}  ${h.comp.padEnd(20)} ${h.text}`);
  }
}
console.log(`\n════ ${total} untranslated string${total === 1 ? "" : "s"} across the four interfaces ════`);
