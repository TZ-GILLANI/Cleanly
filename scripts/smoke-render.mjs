import { JSDOM } from "jsdom";
import fs from "fs";
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { get: () => dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.MutationObserver = dom.window.MutationObserver;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.CustomEvent = dom.window.CustomEvent;
window.requestAnimationFrame = global.requestAnimationFrame;
process.on("uncaughtException", (e) => { console.log("CRASH:", e.message); console.log((e.stack||"").split("\n").slice(0,4).join("\n")); process.exit(1); });
// The bundle is code-split (Capacitor push chunks) — load the REAL entry from index.html, like a browser.
const htmlSrc = fs.readFileSync("dist/index.html", "utf8");
const entry = (htmlSrc.match(/src="\/assets\/([^"]+\.js)"/) || [])[1] || fs.readdirSync("dist/assets").find(f => f.startsWith("index-") && f.endsWith(".js"));
await import(process.cwd() + "/dist/assets/" + entry);
await new Promise(r => setTimeout(r, 500));
const html = document.getElementById("root").innerHTML;
console.log(html ? "RENDERED OK — " + html.replace(/<[^>]+>/g, " ").trim().slice(0, 120) : "EMPTY ROOT = white page reproduced");
