import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5173";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { viewport: { width: 430, height: 924 }, deviceScaleFactor: 2 };
async function shot(p, n) { await pause(600); await p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: true }); console.log("📸", n); }
async function login(p, e, pw) {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.getByText("Already have an account?").click();
  await p.getByPlaceholder("you@example.com").fill(e);
  await p.getByPlaceholder("Min. 6 characters").fill(pw);
  await p.getByRole("button", { name: /Log in/ }).click();
  await p.getByText("Log out").waitFor({ timeout: 20000 });
  await pause(1400);
}
const browser = await chromium.launch();

// Hourly → time step
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await page.getByText("SparkClean Debrecen").click();
  await page.getByText("Cleaning by the hour").click();
  await page.getByText("How many hours do you need?").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.getByText("Choose the day and start time", { exact: false }).waitFor({ timeout: 8000 });
  await shot(page, "40-hourly-time-step");
  await ctx.close(); console.log("✔ hourly time");
} catch (e) { console.log("✗ hourly:", e.message); }

// Company decline sheet
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByText("Incoming & active jobs").waitFor({ timeout: 20000 });
  const dec = page.getByText("Decline — not available", { exact: false }).first();
  await dec.waitFor({ timeout: 8000 });
  await dec.click();
  await page.getByText("Decline this booking?", { exact: false }).waitFor({ timeout: 8000 });
  await shot(page, "41-company-decline");
  await ctx.close(); console.log("✔ decline");
} catch (e) { console.log("✗ decline:", e.message); }

await browser.close();
console.log("done");
