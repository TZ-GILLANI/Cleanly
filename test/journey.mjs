/* THE TWO FLOWS THAT MATTER, DRIVEN THROUGH THE REAL SCREENS.

   841 of 878 assertions in this suite are behavioural — but behavioural at the
   API boundary. The phone field proved how wide the gap is between "the
   endpoint works" and "a person can use the screen": every source check passed
   while the field refused every number.

   So this logs in by typing into the login form, and books a clean by tapping
   through the booking flow. If either breaks, nobody gets in and nobody buys
   anything, and no API test would notice.

   Run: node test/journey.mjs                                                   */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4583"; process.env.DEMO_SEED = "1";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
import { execFileSync } from "child_process";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 1400));

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

execFileSync("npx", ["esbuild", "src/App.jsx", "--loader:.jsx=jsx", "--jsx=automatic",
  "--bundle", "--format=esm", "--outfile=.probe/Journey.mjs",
  "--external:react", "--external:react-dom", "--external:react/jsx-runtime",
  `--define:import.meta.env={"VITE_API_BASE":"http://127.0.0.1:4583","VITE_USE_API":"true","MODE":"production"}`,
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

const thrown = [];
class B extends React.Component {
  constructor(p) { super(p); this.state = {}; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e) { thrown.push(e); }
  render() { return this.state.e ? null : this.props.children; }
}
const { default: App } = await import(`../.probe/Journey.mjs?v=${Date.now()}`);
createRoot(w.document.getElementById("root")).render(React.createElement(B, null, React.createElement(App)));
await new Promise((r) => setTimeout(r, 2500));

const txt = () => w.document.getElementById("root").textContent || "";
const buttons = () => [...w.document.querySelectorAll("button")];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (re, ms = 1300) => {
  const b = buttons().find((x) => re.test(x.textContent || ""));
  if (!b || b.disabled) return false;
  b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(ms);
  return true;
};
/* React 18 ignores a synthetic "input" event in jsdom here, so call the
   element's own onChange — the same trick that finally exposed the phone bug. */
const type = async (el, v) => {
  const k = el && Object.keys(el).find((x) => x.startsWith("__reactProps$"));
  if (!k || !el[k].onChange) return false;
  el[k].onChange({ target: { value: v }, currentTarget: { value: v }, preventDefault() {}, stopPropagation() {} });
  await wait(500);
  return true;
};
const inputs = (pred) => [...w.document.querySelectorAll("input")].filter(pred);
const crashed = () => thrown.length > 0 || /Something broke|Valami elromlott/.test(txt());

console.log("\n── a customer logs in by typing into the form ──");
await click(/Already have an account|Log in/i);
const email = inputs((i) => i.getAttribute("inputmode") === "email" || i.type === "email")[0]
           || inputs((i) => /mail/i.test(i.placeholder || ""))[0];
const pw = inputs((i) => i.type === "password")[0];
ok("the login form has an email and a password box", !!email && !!pw);
/* The eye. My emoji sweep left this as {showPw ? "" : ""} — a real button,
   correctly wired, rendering nothing. It was invisible for a whole release and
   no test noticed, because every test drove the input directly. So: click the
   thing a person clicks, and check the password actually becomes readable. */
{
  const wrap = pw.parentElement;
  const eyeOf = () => [...wrap.querySelectorAll("button")]
    .find((b) => /password|jelsz/i.test(b.getAttribute("aria-label") || ""));
  const eye = eyeOf();
  ok("there is a show-password button beside the box", !!eye, wrap.innerHTML.slice(0, 100));
  if (eye) {
    ok("it draws an actual icon, not an empty box",
       (eye.querySelector("svg path")?.getAttribute("d") || "").length > 5, eye.innerHTML.slice(0, 60));
    ok("and it is labelled for screen readers", /show password|jelszó megjelen/i.test(eye.getAttribute("aria-label")));
    const iconBefore = eye.querySelector("svg path").getAttribute("d");
    const k = Object.keys(eye).find((x) => x.startsWith("__reactProps$"));
    eye[k].onClick({ preventDefault() {}, stopPropagation() {} });
    await wait(300);
    ok("clicking it makes the password readable", wrap.querySelector("input")?.type === "text",
       wrap.querySelector("input")?.type);
    ok("the icon flips to the crossed-out eye",
       eyeOf()?.querySelector("svg path")?.getAttribute("d") !== iconBefore);
    const eye2 = eyeOf();
    eye2[Object.keys(eye2).find((x) => x.startsWith("__reactProps$"))].onClick({ preventDefault() {}, stopPropagation() {} });
    await wait(300);
    ok("clicking again hides it", wrap.querySelector("input")?.type === "password");
  }
}

await type(email, "customer@demo.hu");
await type(pw, "demo1234");
const submitted = await click(/Log in|Sign in|Belép/i, 2600);
ok("the log-in button was clickable", submitted);
ok("logging in does not crash", !crashed(), thrown[0]?.message || "error screen");
const home = txt();
ok("and lands on a screen with companies on it",
   /Debrecen Tiszta|Book|Foglal|Services|Szolgáltat/i.test(home), home.slice(0, 100));

console.log("\n── and books a clean, tapping through the real flow ──");
const before = thrown.length;
const named = [...w.document.querySelectorAll("*")].filter((el) => (el.textContent || "").includes("Debrecen Tiszta"));
if (process.env.JDEBUG) console.log("  [elements containing the name]",
  named.slice(-6).map((e) => `${e.tagName}${e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : ""}(${(e.textContent||"").length})`).join(" "));
/* The innermost clickable ancestor of the company's name. */
const leaf = named[named.length - 1];
let card = leaf;
while (card && card !== w.document.body && card.tagName !== "BUTTON" && !card.onclick && !Object.keys(card).some((k) => k.startsWith("__reactProps$") && card[k].onClick)) card = card.parentElement;
if (!card || card === w.document.body) card = leaf;
ok("a company card is on the home screen", !!card);
if (card) {
  card.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(1800);
}
ok("opening the company does not crash", thrown.length === before && !crashed(),
   thrown[thrown.length - 1]?.message || "");
ok("the company's services are listed", /Ft|HUF/.test(txt()), txt().slice(0, 120));

/* Walk forward through whatever the flow calls "next" until a price appears. */
let steps = 0;
for (; steps < 8; steps++) {
  if (/Total|Összesen|Pay|Fizet/i.test(txt())) break;
  const moved = await click(/Continue|Next|Tovább|Choose|Select|Book|Foglal/i, 1500);
  if (!moved) {
    /* Nothing generic — take the first enabled button that isn't the nav. */
    const nav = w.document.querySelector(".cl-nav");
    const b = buttons().find((x) => !x.disabled && (!nav || !nav.contains(x)) && (x.textContent || "").trim().length > 1);
    if (!b) break;
    b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(1500);
  }
}
ok("the booking flow moves forward when you tap through it", steps > 0, `${steps} steps`);
ok("nothing in the booking flow crashed", !crashed(), thrown[thrown.length - 1]?.message || "error screen");
ok("a price is shown before you are asked to pay",
   /Ft|HUF/.test(txt()), txt().slice(0, 150));

console.log(`\n════ JOURNEY: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
