import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5173";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// realistic Safari-on-phone visible height
const opts = { viewport: { width: 430, height: 720 }, deviceScaleFactor: 2 };
async function shot(p, n) { await pause(500); await p.screenshot({ path: path.join(OUT, n + ".png") }); console.log("📸", n); }
async function login(p, e, pw) {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.getByText("Already have an account?").click();
  await p.getByPlaceholder("you@example.com").fill(e);
  await p.getByPlaceholder("Min. 6 characters").fill(pw);
  await p.getByRole("button", { name: /Log in/ }).click();
  await p.getByText("Log out").waitFor({ timeout: 20000 });
  await pause(1300);
}
const browser = await chromium.launch();

// Company signup (long form) — is the submit button reachable?
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }); await pause(800);
  await page.getByText("I run a company").click(); await pause(700);
  await shot(page, "50-signup-viewport");
  const btn = page.getByRole("button", { name: /Register company/ });
  const box = await btn.boundingBox().catch(() => null);
  const vh = page.viewportSize().height;
  console.log("signup submit btn box:", JSON.stringify(box), "viewportH:", vh, box ? (box.y + box.height > vh ? "BELOW FOLD" : "visible") : "not found");
  await ctx.close();
} catch (e) { console.log("✗ signup:", e.message); }

// Service editor sheet (long) — is Save reachable?
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByRole("button", { name: /Services/ }).click(); await pause(700);
  await page.getByText("+ New service").click(); await pause(700);
  await shot(page, "51-service-editor-viewport");
  const btn = page.getByRole("button", { name: /Add service/ });
  const box = await btn.boundingBox().catch(() => null);
  const vh = page.viewportSize().height;
  console.log("service Add btn box:", JSON.stringify(box), "viewportH:", vh, box ? (box.y + box.height > vh ? "BELOW FOLD" : "visible") : "not found");
  await ctx.close();
} catch (e) { console.log("✗ service:", e.message); }

// Company settings (long) — is Save reachable above the bottom nav?
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByRole("button", { name: /Settings/ }).click(); await pause(700);
  await shot(page, "52-settings-viewport");
  await ctx.close();
} catch (e) { console.log("✗ settings:", e.message); }

await browser.close();
console.log("done");
