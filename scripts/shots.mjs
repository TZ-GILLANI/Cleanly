/**
 * Captures real screenshots of the running Cleanly app across all 4 roles.
 * Requires the full stack running on http://localhost:5173 (npm run dev).
 * Run: node scripts/shots.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const BASE = "http://localhost:5173";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await pause(500);
  await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
  console.log("  📸", name);
}

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Already have an account?").click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Min. 6 characters").fill(password);
  await page.getByRole("button", { name: /Log in/ }).click();
  await page.getByText("Log out").waitFor({ timeout: 20000 });
  await pause(1500); // data fetch + entrance animations
}

async function run() {
  const browser = await chromium.launch();
  const ctxOpts = { viewport: { width: 430, height: 924 }, deviceScaleFactor: 2 };

  // ── ADMIN ──────────────────────────────────────────────────
  try {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    await login(page, "admin@cleanly.hu", "admin123");
    await page.getByText("Platform dashboard").waitFor({ timeout: 20000 });
    await shot(page, "01-admin-dashboard");
    await page.getByRole("button", { name: /Companies/ }).click();
    await shot(page, "02-admin-companies");
    await page.getByRole("button", { name: /Users/ }).click();
    await shot(page, "03-admin-users");
    await page.getByRole("button", { name: /Bookings/ }).click();
    await shot(page, "04-admin-bookings");
    await ctx.close();
    console.log("✔ admin done");
  } catch (e) { console.log("✗ admin failed:", e.message); }

  // ── COMPANY ────────────────────────────────────────────────
  try {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    await login(page, "spark@cleanly.hu", "company123");
    await page.getByText("Incoming & active jobs").waitFor({ timeout: 20000 });
    await shot(page, "05-company-jobs");
    await page.getByRole("button", { name: /Services/ }).click();
    await shot(page, "06-company-services");
    await page.getByRole("button", { name: /Team/ }).click();
    await shot(page, "07-company-team");
    await page.getByRole("button", { name: /Settings/ }).click();
    await shot(page, "08-company-settings");
    await ctx.close();
    console.log("✔ company done");
  } catch (e) { console.log("✗ company failed:", e.message); }

  // ── CLEANER ────────────────────────────────────────────────
  try {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    await login(page, "eszter@cleanly.hu", "employee123");
    await page.getByText("My jobs").first().waitFor({ timeout: 20000 });
    await pause(800);
    await shot(page, "09-cleaner-jobs");
    await page.getByRole("button", { name: /Notices/ }).click();
    await shot(page, "10-cleaner-notices");
    await ctx.close();
    console.log("✔ cleaner done");
  } catch (e) { console.log("✗ cleaner failed:", e.message); }

  // ── CUSTOMER ───────────────────────────────────────────────
  try {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    await login(page, "musa@cleanly.hu", "customer123");
    await page.getByText("Companies near you").waitFor({ timeout: 20000 });
    await shot(page, "11-customer-home");
    await page.getByText("SparkClean Debrecen").click();
    await page.getByText("Service", { exact: true }).waitFor({ timeout: 10000 });
    await shot(page, "12-customer-booking");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Log out").waitFor({ timeout: 20000 });
    await pause(1200);
    await page.getByRole("button", { name: /Bookings/ }).click();
    await shot(page, "13-customer-bookings");
    await ctx.close();
    console.log("✔ customer done");
  } catch (e) { console.log("✗ customer failed:", e.message); }

  await browser.close();
  console.log("\nAll screenshots in:", OUT);
}

run().catch((e) => { console.error(e); process.exit(1); });
