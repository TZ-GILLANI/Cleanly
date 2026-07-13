import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5173";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 };
async function shot(p, n, full = false) { await pause(600); await p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: full }); console.log("📸", n); }
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

// 1) subscription booking → real calendar
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await page.getByText("SparkClean Debrecen").click();
  await page.getByText("Weekly upkeep plan").click();
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.getByText("Pick your first visit on the calendar").waitFor({ timeout: 8000 });
  await shot(page, "90-sub-calendar", true);
  await ctx.close(); console.log("✔ calendar");
} catch (e) { console.log("✗ calendar:", e.message); }

// 2) company schedule tab + job filters
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByText("Incoming & active jobs").waitFor({ timeout: 20000 });
  await shot(page, "91-company-jobs-filters");
  await page.getByRole("button", { name: /Schedule/ }).click(); await pause(900);
  await page.getByText("Your whole pipeline on a calendar", { exact: false }).waitFor({ timeout: 8000 });
  await shot(page, "92-company-schedule", true);
  await ctx.close(); console.log("✔ company pipeline");
} catch (e) { console.log("✗ company:", e.message); }

// 3) company signup shows document upload
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }); await pause(800);
  await page.getByText("I run a company").click();
  await page.getByText("Verification documents").waitFor({ timeout: 8000 });
  await shot(page, "93-signup-docs", true);
  await ctx.close(); console.log("✔ signup docs");
} catch (e) { console.log("✗ signup docs:", e.message); }

// 4) admin docs button
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "admin@cleanly.hu", "admin123");
  await page.getByRole("button", { name: /Companies/ }).click(); await pause(900);
  await page.getByText("📄 Docs", { exact: false }).first().waitFor({ timeout: 8000 });
  await shot(page, "94-admin-docs");
  await ctx.close(); console.log("✔ admin docs");
} catch (e) { console.log("✗ admin docs:", e.message); }

await browser.close();
console.log("done");
