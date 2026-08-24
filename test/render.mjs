/* RENDER — actually mount the app, as each of the four roles, and fail if
   anything throws.

   This layer did not exist. There were 793 tests and every one of them stopped
   at the API boundary: the server was proven correct in enormous detail and the
   screens were never rendered once. So `useEffect` could be used without being
   imported, and `savedAddresses` could be assumed to be an array, and the whole
   suite stayed green while every user got a blank screen two seconds after
   opening the app.

   Mounting is the difference. A component that throws during render takes the
   entire tree down with it, so "did it mount" is close to "does the app work".

   Run: node test/render.mjs                                                   */
process.env.PGMEM = "1"; process.env.DEMO_SEED = "1";
process.env.JWT_SECRET = "t"; process.env.PORT = "4512";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

import { execFileSync } from "child_process";
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

/* ── the two mistakes that caused it, guarded at the source ───────────────── */
console.log("\n── the crashes that blanked the app ──");
const app = fs.readFileSync("src/App.jsx", "utf8");
/* Only React's own hooks. useStore, useToast and friends are defined in this
   file and would otherwise look like missing imports forever. */
const REACT_HOOKS = ["useState", "useEffect", "useMemo", "useRef", "useCallback",
  "useContext", "useReducer", "useLayoutEffect", "useTransition", "useId"];
const bare = [...app.matchAll(/[^.\w](use[A-Z]\w+)\(/g)].map((m) => m[1])
  .filter((h) => REACT_HOOKS.includes(h));
const imported = (/import React, \{([^}]*)\} from "react"/.exec(app)?.[1] || "")
  .split(",").map((x) => x.trim());
const missing = [...new Set(bare)].filter((h) => !imported.includes(h));
ok("every bare hook is actually imported from React", missing.length === 0, missing.join(", "));
ok("useEffect specifically — it was used once and imported never", imported.includes("useEffect"));
ok("savedAddresses is never assumed to be an array",
   !/session\.savedAddresses \|\| \[\]/.test(app));
ok("and the store normalises it at the boundary",
   /Array\.isArray\(user\.saved_addresses\)/.test(fs.readFileSync("src/store.jsx", "utf8")));

console.log("\n── nothing references a name that does not exist ──");
/* Every crash found today was this: an identifier that is simply not in scope.
   useEffect used but never imported. `detail` copied into a component that has
   no such state. stars() called from two components that cannot see it.
   upsertBooking(), a store function deleted long ago.

   None of it is visible to the bundler — esbuild and Vite happily compile a
   ReferenceError. It only appears when that line runs, which for a click
   handler can be months later. A scope check finds all of them at once. */
const CLIENT_FILES = ["src/App.jsx", "src/store.jsx", "src/lib/i18n.js",
                      "src/lib/translations.js", "src/lib/api.js"];
const runEslint = (files) => {
  /* Pinned to 9. Unpinned, npx fetches whatever is newest — ESLint 10 refuses
     to load a .json config at all, and the failure looked exactly like a pass
     (see the canary below). */
  try {
    execFileSync("npx", ["eslint@9", "-c", "scripts/eslint-undef.mjs", ...files],
      { encoding: "utf8", stdio: "pipe" });
    return "";
  } catch (e) { return String(e.stdout || "") + String(e.stderr || e.message || ""); }
};

/* A checker you have not seen fail is not a checker. This one silently reported
   "clean" for a while because the way it detects a problem — a line containing
   "no-undef" — is also absent when eslint crashes before reading a single file.
   So: plant a file with a known error and require that it is caught. If the
   canary comes back clean, the tool is broken, not the code. */
const canary = ".render-canary.jsx";
fs.writeFileSync(canary, "export const boom = () => thisNameDoesNotExistAnywhere(1);\n");
const canaryOut = runEslint([canary]);
fs.unlinkSync(canary);
ok("the scope checker itself works (canary caught)", /no-undef/.test(canaryOut),
   canaryOut.split("\n").slice(0, 3).join(" | ").slice(0, 200));

const undef = runEslint(CLIENT_FILES);
const undefLines = undef.split("\n").filter((l) => l.includes("no-undef"));
ok("no undefined identifiers anywhere in the client", undefLines.length === 0,
   undefLines.slice(0, 4).map((l) => l.trim()).join(" | "));

console.log("\n── a thrown error must not blank the app ──");
ok("there is an error boundary", /getDerivedStateFromError/.test(app));
ok("it wraps the whole tree", /<Crash>[\s\S]*<StoreProvider>/.test(app));
ok("it offers a way out", /window\.location\.reload/.test(app));
ok("and it reports the crash to the operator", /api\/client-error/.test(app));
ok("the server accepts those reports", /app\.post\("\/api\/client-error"/.test(fs.readFileSync("server/index.js", "utf8")));
ok("and rate-limits them, so a crash loop cannot flood the inbox",
   /crashSeen/.test(fs.readFileSync("server/index.js", "utf8")));

/* ── mount it ─────────────────────────────────────────────────────────────── */
console.log("\n── every role mounts without throwing ──");
let jsdomOk = true;
try { await import("jsdom"); } catch { jsdomOk = false; }
if (!jsdomOk) {
  console.log("  · jsdom not installed — skipping the mount (run npm install)");
} else {
  await import("../server/index.js");
  await new Promise((r) => setTimeout(r, 1500));

  execFileSync("npx", ["esbuild", "src/App.jsx", "--loader:.jsx=jsx", "--jsx=automatic",
    "--bundle", "--format=esm", "--outfile=.probe/App.mjs",
    "--external:react", "--external:react-dom", "--external:react/jsx-runtime",
    `--define:import.meta.env={"VITE_API_BASE":"http://127.0.0.1:4512","VITE_USE_API":"true","MODE":"production"}`,
    "--log-level=error"], { stdio: "inherit" });

  const { JSDOM } = await import("jsdom");
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");

  for (const role of ["customer", "company", "cleaner", "admin"]) {
    const login = await (await fetch("http://127.0.0.1:4512/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${role}@demo.hu`, password: "demo1234" }),
    })).json();
    if (!login.token) { ok(`${role} can log in`, false, JSON.stringify(login).slice(0, 80)); continue; }

    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
    const w = dom.window;
    global.window = w; global.document = w.document;
    Object.defineProperty(global, "navigator", { value: w.navigator, configurable: true });
    global.localStorage = w.localStorage; global.HTMLElement = w.HTMLElement;
    global.Element = w.Element; global.Node = w.Node;
    global.CustomEvent = w.CustomEvent; global.Event = w.Event;
    global.getComputedStyle = w.getComputedStyle;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    global.matchMedia = w.matchMedia;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    w.scrollTo = () => {};
    w.localStorage.setItem("cleanly_jwt", login.token);
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const thrown = [];
    const { default: App } = await import(`../.probe/App.mjs?v=${role}${Date.now()}`);
    class B extends React.Component {
      constructor(p) { super(p); this.state = {}; }
      static getDerivedStateFromError(e) { return { e }; }
      componentDidCatch(e) { thrown.push(e); }
      render() { return this.state.e ? null : this.props.children; }
    }
    createRoot(w.document.getElementById("root")).render(React.createElement(B, null, React.createElement(App)));
    await new Promise((r) => setTimeout(r, 2500));

    const html = w.document.getElementById("root").innerHTML;
    ok(`${role} mounts without throwing`, thrown.length === 0, thrown[0]?.message || "");
    ok(`${role} renders something, not a blank screen`, html.length > 500, `${html.length} chars`);

    const nav = w.document.querySelector(".cl-nav");

    /* Tabs are not enough. Tapping a company opens the booking flow, and that
       screen crashed for every customer on `Cannot access 'svc' before
       initialization` — a const read nine lines above its own declaration.
       No linter worth keeping catches that; opening the screen does. */
    if (role === "customer") {
      const before = thrown.length;
      const card = [...w.document.querySelectorAll("button, div.cl-card, [role='button']")]
        .filter((el) => !nav || !nav.contains(el))
        .filter((el) => (el.textContent || "").length > 20)
        .pop();
      if (card) {
        try { card.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); } catch (e) { thrown.push(e); }
        await new Promise((r) => setTimeout(r, 1600));
        const body = w.document.getElementById("root").textContent || "";
        ok("opening a company does not crash the booking flow",
           thrown.length === before && !/Something broke|Valami elromlott/.test(body),
           thrown[thrown.length - 1]?.message || "error screen");
      } else ok("a company card is on the customer's home screen", false, "none found");
    }

    /* Two things built this session that only exist behind a click, which is
       precisely where this codebase hides its broken wiring: a button that
       renders perfectly and throws the instant someone does the one thing it
       exists for. Mounting the tab is not enough — open the thing. */
    const clickText = async (needle, ms = 1200) => {
      const el = [...w.document.querySelectorAll("button")]
        .find((b) => (b.textContent || "").includes(needle));
      if (!el) return null;
      try { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
      catch (e) { thrown.push(e); }
      await new Promise((r) => setTimeout(r, ms));
      return w.document.getElementById("root").textContent || "";
    };
    /* The bottom nav shows a label only for the tab you are on — every other
       button is an icon with no text at all. Matching on button text finds
       exactly one tab, the one already open, so this walks the tabs and stops
       when the screen itself says it arrived. */
    const goTab = async (marker) => {
      const btns = (nav ? [...nav.querySelectorAll("button")] : []);
      for (const b of btns) {
        try { b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); } catch { continue; }
        /* Poll rather than guess. Admin lists fetch on mount, so a fixed wait
           either flakes or slows every role down to the worst case. */
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 400));
          if (marker.test(w.document.getElementById("root").textContent || "")) return true;
        }
      }
      if (process.env.NAVDEBUG) {
        const txt = (w.document.getElementById("root").textContent || "").replace(/[\s\S]*?display: swap'\);/, "").replace(/\.[a-z-]+\s*\{[^}]*\}/g, "").replace(/\s+/g, " ");
        console.log(`  [${role} last screen]`, JSON.stringify(txt.slice(0, 260)));
      }
      return false;
    };

    if (role === "admin") {
      const before = thrown.length;
      if (await goTab(/Unlist|Re-list/)) {
        const body = await clickText("Details", 1600);
        ok("admin — the company dossier opens", body !== null && thrown.length === before,
           body === null ? "no Details button rendered" : thrown[thrown.length - 1]?.message || "");
        ok("admin — the dossier actually shows billing fields, not an empty sheet",
           !!body && /Tax number/i.test(body) && /Invoice email/i.test(body),
           (body || "").slice(0, 120));
        /* v7.1: "Cities served in full" and a radius row were two views of a
           model that no longer exists. One row, showing the real list. */
        ok("admin — and the coverage the customer is actually judged against",
           !!body && /Areas served|Ellátott területek/i.test(body), (body || "").slice(0, 160));
      } else ok("admin — the Companies screen is reachable", false, "no tab rendered a company list");
    }

    if (role === "company") {
      const before = thrown.length;
      /* Settings is no longer a bottom-nav tab — it lives behind Manage, along
         with Services, Team, Reviews and Issues. Eight tabs on a phone was a
         horizontal scroll nobody reached the end of. So: open Manage, then
         pick Settings, the way a partner now does. */
      let reached = await goTab(/Cities you serve in full/i);
      if (!reached) {
        await clickText("Manage", 900);
        await clickText("Settings", 1400);
        reached = /Where you work/i.test(w.document.getElementById("root").textContent || "");
      }
      if (reached) {
        const body = w.document.getElementById("root").textContent || "";
        /* v7.1: one list of named places replaced a free pin + a flat city
           list. The anchor moved with it; the promise did not. */
        ok("company — the service-area section is on the settings screen",
           /Where you work/i.test(body), body.slice(0, 120));
        ok("company — it explains that only people inside can book",
           /Only customers inside these places can book you|Csak az ezeken bel/i.test(body), body.slice(0, 160));
        const before2 = thrown.length;
        const after = await clickText("Add a place", 1200);
        ok("company — the add-a-place button opens without throwing",
           after !== null && thrown.length === before2,
           after === null ? "button not rendered" : thrown[thrown.length - 1]?.message || "");
        ok("company — it asks for a town first, so a pin cannot float free",
           !!after && /Town or city|Település/i.test(after), (after || "").slice(0, 140));

        /* There is no network in here, so suggestPlaces() returns nothing —
           which is exactly the state a Hungarian partner was permanently in
           while the app sent Photon `lang=hu` (a 400). If the only way to add
           an area is to pick a suggestion, that partner can never be found by
           anyone. Type a town, get an escape hatch. */
        /* The settings screen behind the sheet ALSO has a city box with this
           placeholder. The sheet renders last, so take the last match — my
           first version typed into the field underneath and nothing happened. */
        const boxes = [...w.document.querySelectorAll("input")].filter((i) => /Debrecen/.test(i.placeholder || ""));
        const box = boxes[boxes.length - 1];
        ok("company — the add-area sheet has a town box", !!box);
        if (box) {
          const k = Object.keys(box).find((x) => x.startsWith("__reactProps$"));
          /* This harness has no act() — it renders and then waits, like the
             other clicks in this file do. */
          if (k) box[k].onChange({ target: { value: "Debrecen" }, currentTarget: { value: "Debrecen" } });
          await new Promise((r) => setTimeout(r, 900));
          const t2 = w.document.getElementById("root").textContent || "";
          ok("company — with no suggestions, you can still use what you typed",
             /Use .Debrecen.|Debrecen.* haszn/i.test(t2) || /No suggestions right now|Most nincs javaslat/i.test(t2),
             t2.slice(t2.indexOf("Town or city"), t2.indexOf("Town or city") + 200));
        }

        const setupTxt = w.document.getElementById("root").textContent || "";
        ok("company — the setup screen says what is still missing",
           /things left before customers can book you|Everything is set up|Add a place/i.test(setupTxt),
           setupTxt.slice(0, 90));
      } else ok("company — the Settings screen is reachable", false, "no tab rendered the settings form");
    }

    /* The landing screen is the one screen most likely to be right. Every crash
       found today was one tab deeper. */
    const tabs = nav ? [...nav.querySelectorAll("button")] : [];
    let broken = [];
    for (let i = 1; i < tabs.length; i++) {
      const before = thrown.length;
      try { tabs[i].dispatchEvent(new w.MouseEvent("click", { bubbles: true })); } catch (e) { thrown.push(e); }
      await new Promise((r) => setTimeout(r, 800));
      const body = w.document.getElementById("root").textContent || "";
      if (thrown.length > before || /Something broke|Valami elromlott/.test(body)) {
        broken.push(`${(tabs[i].textContent || i).toString().trim().slice(0, 14)}: ${thrown[thrown.length - 1]?.message || "error screen"}`);
      }
    }
    ok(`${role} — all ${Math.max(0, tabs.length - 1)} other tabs open cleanly`, broken.length === 0, broken.slice(0, 2).join(" | "));


  }
}

console.log(`\n════ RENDER: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
