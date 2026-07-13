import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5173";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { viewport: { width: 430, height: 720 }, deviceScaleFactor: 2 };
async function shot(p, n, full = false) { await pause(500); await p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: full }); console.log("📸", n); }
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

// signup submit reachable now?
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }); await pause(700);
  await page.getByText("I run a company").click(); await pause(700);
  const btn = page.getByRole("button", { name: /Register company/ });
  const box = await btn.boundingBox().catch(() => null);
  const vh = page.viewportSize().height;
  console.log("signup submit:", JSON.stringify(box), "vh", vh, box ? (box.y + box.height <= vh + 1 ? "VISIBLE ✓" : "BELOW FOLD ✗") : "missing");
  await shot(page, "60-signup-fixed");
  await ctx.close();
} catch (e) { console.log("✗ signup:", e.message); }

// weekly schedule chooser
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await page.getByText("SparkClean Debrecen").click();
  await page.getByText("Weekly upkeep plan").click();
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.getByText("Which day each", { exact: false }).waitFor({ timeout: 8000 });
  await shot(page, "61-sub-weekly", true);
  await ctx.close();
} catch (e) { console.log("✗ weekly:", e.message); }

// monthly day-of-month chooser
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await page.getByText("Tiszta Otthon").click();
  await page.getByText("Monthly deep plan").click();
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.getByText("Day of the month", { exact: false }).waitFor({ timeout: 8000 });
  await shot(page, "62-sub-monthly", true);
  await ctx.close();
} catch (e) { console.log("✗ monthly:", e.message); }

await browser.close();
console.log("done");
