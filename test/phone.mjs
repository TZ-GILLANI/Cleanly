/* THE PHONE FIELD, DRIVEN LIKE A PERSON.

   Every earlier check on this field read the source and asked "does the right
   code exist?" — and every one of them passed while the field on the actual
   phone refused every number. Three separate faults hid behind those green
   ticks:

     1. The fix went into PhoneField; the signup screen uses VerifiedField.
     2. Widening the country list from 21 to 245 made DIAL_CODES[0] Ascension
        Island instead of Hungary, so every fallback dial code was +247, and
        "en-US" — the locale on half the phones in Hungary — started matching a
        real country, so Hungarian numbers were judged against +1.
     3. isValidPhoneNumber("+3606703031941") returns TRUE: the library strips
        Hungary's 06 trunk prefix before judging. The number is real, the string
        is not, and the string is what Twilio receives.

   None of that is visible in the source. It is visible the moment you type.

   Run: node test/phone.mjs                                                    */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4581"; process.env.DEMO_SEED = "1";
process.env.RESEND_API_KEY = "re_test_key"; process.env.EMAIL_FROM = "Cleano <no-reply@example.com>";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
import { execFileSync } from "child_process";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 1400));

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

execFileSync("npx", ["esbuild", "src/App.jsx", "--loader:.jsx=jsx", "--jsx=automatic",
  "--bundle", "--format=esm", "--outfile=.probe/Phone.mjs",
  "--external:react", "--external:react-dom", "--external:react/jsx-runtime",
  `--define:import.meta.env={"VITE_API_BASE":"http://127.0.0.1:4581","VITE_USE_API":"true","MODE":"production"}`,
  "--log-level=error"], { stdio: "inherit" });

const { JSDOM } = await import("jsdom");
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
global.window = w; global.document = w.document;
Object.defineProperty(global, "navigator", { value: w.navigator, configurable: true });
global.localStorage = w.localStorage; global.HTMLElement = w.HTMLElement;
global.Element = w.Element; global.Node = w.Node; global.CustomEvent = w.CustomEvent; global.Event = w.Event;
global.getComputedStyle = w.getComputedStyle;
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
global.matchMedia = w.matchMedia;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
w.scrollTo = () => {};
global.IS_REACT_ACT_ENVIRONMENT = true;

const { default: App } = await import(`../.probe/Phone.mjs?v=${Date.now()}`);
createRoot(w.document.getElementById("root")).render(React.createElement(App));
await new Promise((r) => setTimeout(r, 2500));

const txt = () => w.document.getElementById("root").textContent || "";
const buttons = () => [...w.document.querySelectorAll("button")];
const click = async (re, ms = 1300) => {
  const b = buttons().find((x) => re.test(x.textContent || ""));
  if (!b) return false;
  b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, ms));
  return true;
};

console.log("\n── getting to the signup form ──");
for (let i = 0; i < 4 && !/Phone number/i.test(txt()); i++) {
  if (!(await click(/I need cleaning|sign ?up|create account/i))) break;
}
ok("the customer signup form opens", /Phone number/i.test(txt()));

const telInput = () => [...w.document.querySelectorAll("input")].find((i) => i.getAttribute("inputmode") === "tel");
const sel = () => w.document.querySelector("select");

console.log("\n── the country code is a real control ──");
ok("there is a country dropdown next to the number", !!sel() && !!telInput());
ok("it lists every country, not a hand-picked few", (sel()?.options.length || 0) > 200,
   String(sel()?.options.length));
ok("it starts on Hungary, not whatever sorts first alphabetically", sel()?.value === "HU",
   `got ${sel()?.value} — DIAL_CODES[0] is Ascension Island once the list is complete`);
ok("the markets we serve are at the top of the list",
   [...(sel()?.options || [])].slice(0, 5).map((o) => o.textContent).join("").includes("+36"));

/* React 18 does not see a synthetic "input" event in this harness — the email
   field ignored it too, which is how I know it is the harness and not the
   component. Call the element's own onChange. */
const type = async (el, v) => {
  const k = Object.keys(el).find((x) => x.startsWith("__reactProps$"));
  if (!k || !el[k].onChange) throw new Error("no React onChange on the input");
  el[k].onChange({ target: { value: v }, currentTarget: { value: v }, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 600));
};
const sendBtn = () => buttons().find((b) => /Send code|Kód kérése/.test(b.textContent || ""));

console.log("\n── typing a number the way people actually write them ──");
for (const [typed, expect, why] of [
  ["06 70 303 1941",  "+36 70 303 1941", "06 is how Hungarians write their own number"],
  ["+36 70 303 1941", "+36 70 303 1941", "pasted from a contact card"],
  ["0036 70 303 1941","+36 70 303 1941", "the 00 international prefix"],
  ["70 303 1941",     "+36 70 303 1941", "spaces"],
  ["703031941",       "+36 70 303 1941", "plain and correct"],
]) {
  await type(telInput(), typed);
  const shown = (txt().match(/We'll send the code to: ([+0-9 ]+)/) || [])[1]?.trim();
  const btn = sendBtn();
  ok(`"${typed}" → ${expect}  (${why})`, shown === expect && !!btn && !btn.disabled,
     `showed ${JSON.stringify(shown)}, button ${btn && !btn.disabled ? "enabled" : "disabled"}`);
}

console.log("\n── and refusing the ones that cannot exist ──");
for (const [typed, why] of [
  ["70303194149", "the number from the bug report — 11 national digits, Hungary has 9"],
  ["12345",       "far too short"],
  ["7030319411234","far too long"],
]) {
  await type(telInput(), typed);
  const btn = sendBtn();
  ok(`"${typed}" is refused before any SMS is spent  (${why})`,
     /doesn't look like a valid number/.test(txt()) && (!btn || btn.disabled));
}

console.log("\n── the server refuses the same things ──");
const j = async (p, body) => {
  const r = await fetch(`http://127.0.0.1:4581${p}`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(9000) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
for (const [num, why] of [
  ["+3670303194149", "the bug report"],
  ["+3606703031941", "valid number, but the 06 is still in the string we would store"],
  ["+9999999999999", "no such country"],
]) {
  const r = await j("/api/verify/signup/start", { phone: num });
  ok(`server refuses ${num}  (${why})`, r.status === 400 && /country code/i.test(r.data.error || ""),
     `${r.status} ${JSON.stringify(r.data.error || "")}`);
}
const good = await j("/api/verify/signup/start", { phone: "+36703031941" });
ok("and lets a real number through to the provider", good.status !== 400,
   `${good.status} ${JSON.stringify(good.data.error || "")}`);

console.log("\n── the code goes out by SMS, not WhatsApp ──");
/* The server read `channel === "sms" ? "sms" : "whatsapp"`, so no channel at
   all meant WhatsApp — which needs an approved sender at our end and the app
   installed at theirs. Every signup code was being requested over a channel
   almost nobody could receive, and the customer just saw "we couldn't send the
   code". A default nobody states is a default nobody checks. */
const vs = (await import("fs")).readFileSync("server/routes/verify.js", "utf8");
ok("the server falls back to SMS, not WhatsApp",
   (vs.match(/Channel: (?:req\.body\.)?channel === "whatsapp" \? "whatsapp" : "sms"/g) || []).length === 2,
   "both the signup and logged-in paths must default to SMS");
/* Matched inside the comment that explains the bug, which is exactly the kind
   of false alarm that teaches people to ignore a checker. Anchor on the actual
   parameter. */
ok("and no Channel parameter still defaults to WhatsApp",
   !/Channel: [^\n]*\? "sms" : "whatsapp"/.test(vs));
const ap = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the signup screen asks for SMS by name", /phone: composed, channel: "sms"/.test(ap));
ok("a failure to send raises an alert, not just a red box",
   /verification codes are failing/.test(vs));

console.log(`\n════ PHONE: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
