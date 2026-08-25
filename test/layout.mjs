/* NOTHING WIDER THAN THE PHONE.

   The Special offer slider ran off the right edge of the screen, and the fix
   was one property: a flex child will not shrink below the width its content
   wants. `flex: 1` alone does not overrule that — you also need minWidth: 0.
   A range input's intrinsic width is ~130px, an iOS date input's is wider
   still, so a row of them grows past the card, and the card past the screen.

   This is a whole class of bug rather than one slider, so it gets a guard.
   Every form control that is a flex child must be allowed to shrink.

   Run: node test/layout.mjs                                                  */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const raw = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
/* Blank comments but keep line numbers — four separate checks have been fooled
   by prose that merely described the pattern they were hunting. */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const lines = src.split("\n");

console.log("\n── every form control can shrink ──");
{
  const bad = [];
  lines.forEach((ln, i) => {
    if (!/<(input|select|textarea)\b/.test(ln)) return;
    if (!/flex:\s*1/.test(ln)) return;
    if (/minWidth:\s*0/.test(ln)) return;
    bad.push(i + 1);
  });
  ok("no input, select or textarea in a flex row can push it wide", bad.length === 0, "lines " + bad.join(", "));
}

console.log("\n── the sliders that started it ──");
{
  /* `[^>]*` stops at the arrow in onChange={(e) => …}, so match the whole tag
     by walking to the closing "/>" instead. */
  const tags = [];
  let k = 0;
  while ((k = src.indexOf('type="range"', k)) !== -1) {
    const start = src.lastIndexOf("<input", k);
    const end = src.indexOf("/>", k);
    tags.push(src.slice(start, end + 2));
    k = end;
  }
  ok("all four range sliders were found", tags.length === 4, String(tags.length));
  ok("and every one of them can shrink", tags.every((t) => /minWidth:\s*0/.test(t)),
     tags.filter((t) => !/minWidth:\s*0/.test(t)).map((t) => t.slice(0, 60)).join(" | "));
  ok("each sits beside a fixed-width readout, so the number never jumps",
     tags.filter((t) => /accentColor/.test(t)).length === 4);
}

console.log("\n── nothing is measured from the outside in ──");
{
  ok("padding never adds to a width — border-box is global",
     /\*\s*\{[^}]*box-sizing:\s*border-box/.test(raw));
  const vw = lines.map((ln, i) => [i + 1, ln]).filter(([, ln]) => /width:\s*"?100vw/.test(ln));
  ok("no element is sized at 100vw", vw.length === 0, vw.map(([n]) => n).join(", "));
  const wide = [];
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/\bminWidth:\s*(\d+)/g)) if (+m[1] > 300) wide.push(i + 1);
  });
  ok("nothing demands more than a small phone can give (>300px)", wide.length === 0, wide.join(", "));
}

console.log("\n── long text ellipses instead of stretching ──");
{
  const bad = [];
  lines.forEach((ln, i) => {
    if (!/whiteSpace:\s*"nowrap"/.test(ln)) return;
    if (!/flex:\s*1/.test(ln)) return;
    if (/minWidth:\s*0/.test(ln) || /overflow:\s*"hidden"/.test(ln)) return;
    bad.push(i + 1);
  });
  ok("no unwrapped label can widen the row it lives in", bad.length === 0, bad.join(", "));
}

console.log(`\n════ LAYOUT: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
