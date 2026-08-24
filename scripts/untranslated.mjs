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

/* Every file under src/, not just App.jsx.

   The sweep read one file. store.jsx and the lib modules — which carry their
   own toasts and error text — were never looked at, so "0 untranslated" meant
   "0 in App.jsx", which is not the claim anyone reads it as. */
const FILES = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = d + "/" + e.name;
    if (e.isDirectory()) walk(f);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) FILES.push(f);
  }
})("src");

const hits = [];
for (const FILE of FILES) {
const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");

const ROLE = (name) =>
  /^CustomerReportQueue$/.test(name) ? "admin" :
  /^Customer/.test(name) ? "customer" :
  /^Company/.test(name) ? "company" :
  /^Employee/.test(name) ? "cleaner" :
  /^(Admin|Billing|ReviewReports)/.test(name) ? "admin" : "shared";

const comps = [];
lines.forEach((ln, i) => {
  /* `export function Foo(` and `export default function Foo(` count too. The
     old pattern demanded the line begin with `function`, so every exported
     component — which is all of store.jsx — had no owner, and a string with no
     owner was skipped silently rather than reported. */
  const m = /^(?:export\s+(?:default\s+)?)?function ([A-Z]\w+)\s*\(/.exec(ln)
         || /^(?:export\s+(?:default\s+)?)?const ([A-Z]\w+)\s*=\s*(?:\(|function|React\.memo)/.exec(ln);
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

const SKIPPED_KEY = /\b(style|className|class|key|id|type|href|src|accept|autoComplete|inputMode|pattern|rel|target|method|role|fill|stroke|viewBox|xmlns|transform|points|icon|emoji|bg|color|url|status|code|lang|locale|currency|padding|margin|gap|inset|borderRadius|border|width|height|top|left|right|bottom|transition|animation|flex|grid|gridTemplateColumns|fontFamily|background|border|boxShadow|display|position|textAlign|flexDirection|justifyContent|alignItems|objectFit|whiteSpace|wordBreak|textDecoration|overflow|cursor|scrollSnapType|scrollSnapAlign|WebkitOverflowScrolling)\s*[:=]\s*$/;
const LOOKS_LIKE_DATA = /^(https?:|data:|\/|#|[\d\s.,:%+-]+$|[a-z0-9_-]+$|[A-Z_]+$)/;

/* CSS values and code fragments are the bulk of the string literals in a file
   like this. Neither is copy, and a list full of "11px 8px" is a list nobody
   reads to the end. */
const CSS_VALUE = /(^|\s)(\d+(\.\d+)?(px|rem|em|vh|vw|%|s|ms)\b|rgba?\(|calc\(|var\(|#[0-9a-f]{3,8}\b)/i;
const CODE_FRAGMENT = /(=>|\)\s*\{|\bconst\b|\bMath\.|<\/|\/>|\$\{|\breturn\b|\bfunction\b|\.map\(|\.split\(|\bnew [A-Z])/;
/* A single word is still copy.

   This used to demand two or more words, on the theory that one word is
   usually an identifier. That quietly excused every nav label, tab, heading
   and button in the app — "Dashboard", "Team", "Services", "Log", "Orders" —
   and the checker reported the admin interface as fully translated while its
   entire bottom navigation was hardcoded English.

   Now: three or more letters counts, and the noise that used to be filtered by
   the word count is filtered by LOOKS_LIKE_DATA (lowercase identifiers,
   ALL_CAPS constants), CSS_VALUE and CODE_FRAGMENT instead — which is where it
   should have been done in the first place. */
const HAS_WORDS = /[A-Za-zÀ-ſ][a-zà-ſ]{2,}/;

/* `hits` is declared once, above the per-file loop. A second `const hits = []`
   used to sit here — legal, because the loop body is its own scope, and
   therefore silent: every file collected its findings into a fresh array that
   was discarded at the end of the iteration, and the report read the outer one,
   which nothing ever wrote to. The sweep printed a clean zero for the entire
   app. Shadowing is the quietest way to break a checker. */
/* Match EVERY quoted string, then filter by length — never filter inside the
   pattern.

   The old regex demanded 4–120 characters between the quotes. On this line

       { id: "student", icon: "🎓", t: "Student", s: "Uni email verification…" }

   the emoji is two characters, so the scanner could not close on it, skipped
   past, and paired the *closing* quote of one string with the *opening* quote
   of the next — matching ", t: " instead of "Student". Everything after a short
   string on the same line became invisible, which is why a signup screen full
   of English reported clean. Length is a property of a token, not a way to find
   one. */
for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
  const raw = m[1];
  if (raw.length < 4 || raw.length > 120) continue;
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
  /* Machine strings that happen to contain English words. Widening HAS_WORDS to
     accept single words let these in; they are not copy and never reach a
     screen. Filtered by shape rather than by word count, so a real one-word
     label like "Team" still gets caught. */
  if (/^(blur|rotate|scale|translate|saturate|linear-gradient|radial-gradient|drop-shadow)\s*\(/.test(text)) continue;
  if (/^(image|application|text|audio|video|font)\//.test(text)) continue;   // MIME
  if (/^@[a-z][\w-]*\//.test(raw)) continue;                                 // @capacitor/core
  if (/^\/[a-z][\w/-]*$/.test(raw)) continue;                                // /calendar/me — API paths
  if (/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(raw)) continue;                   // you@example.com
  if (/e\.key\s*===?\s*$/.test(before)) continue;                            // "Enter" the keyboard key
  /* Place names are data, not copy. Translating "Debrecen" is wrong, not
     missing — these sit in the markets table and in field placeholders. */
  if (/^(Budapest|Debrecen|Szeged|Miskolc|Pécs|Győr|Nyíregyháza|Kecskemét|Székesfehérvár|Szombathely|Magyarország)$/.test(raw)) continue;
  /* Example company name in a placeholder. Translating an invented Hungarian
     firm is wrong in the same way translating "Debrecen" is. */
  if (/^Tiszta Otthon Kft$/.test(raw)) continue;
  if (/^(Bearer|Content-Type|Authorization|application\/json)\b/.test(text)) continue;
  if (/^\(prefers-/.test(raw)) continue;                                      // media queries
  if (/^[a-z][\w+.-]*:\/\//.test(text)) continue;                            // itms-apps://, https://
  if (/^\s*[a-zA-Z]+=/.test(raw)) continue;                                   // " max=", " style={{ …
  if (/^[\d.]+\s+[\d.]+\s+auto$/.test(text)) continue;                       // flex shorthand
  if (/^Cleano$/.test(text)) continue;                                        // the brand is the brand
  /* Country endonyms in the dial-code table: `f: "🇷🇴", n: "România"`. The flag
     is a separate field here, so the leading-flag rule above cannot see it. */
  if (/f: "[\u{1F1E6}-\u{1F1FF}]{2}", n: $/u.test(before)) continue;
  /* Demo-mode affordances and seed data. isApiMode is true in every shipped
     build, so these strings are unreachable outside a local walkthrough. */
  if (/^(Live mode only|Demo mode — use the sign-up buttons instead\.|Password change not available in demo mode)$/.test(raw)) continue;
  if (/^(Musa Gillani|Eszter Kovács|Bálint Erdős|Platform Admin|Kassai út 26, Debrecen)$/.test(raw)) continue;
  if (SKIPPED_KEY.test(before)) continue;
  if (/\/\/[^\n]*$/.test(before)) continue;
  if (inside(m.index) || inComment(m.index)) continue;
  /* Errors thrown for our own logs are not shown to anyone. */
  if (/new Error\($/.test(before)) continue;
  const line = src.slice(0, m.index).split("\n").length - 1;
  const o = owner(line);
  if (!o) continue;
  hits.push({ role: o.role, comp: o.name, line: line + 1, text: raw.slice(0, 80),
              file: FILE.replace(/^src\//, "") });
}
}   /* ── end of per-file loop ── */

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
    for (const h of byRole[r]) console.log(`  ${(h.file + ":" + h.line).padEnd(22)} ${h.comp.padEnd(20)} ${h.text}`);
  }
}
console.log(`\n════ ${total} untranslated string${total === 1 ? "" : "s"} across the four interfaces ════`);
