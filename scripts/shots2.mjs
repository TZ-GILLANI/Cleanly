import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "shots");
const BASE = "http://localhost:5173";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { viewport: { width: 430, height: 924 }, deviceScaleFactor: 2 };

async function shot(page, name) { await pause(600); await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true }); console.log("📸", name); }
async function login(page, email, pw) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Already have an account?").click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Min. 6 characters").fill(pw);
  await page.getByRole("button", { name: /Log in/ }).click();
  await page.getByText("Log out").waitFor({ timeout: 20000 });
  await pause(1400);
}

const browser = await chromium.launch();

// 1) Welcome (white logo) + 2) company onboarding form
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" }); await pause(1200);
  await shot(page, "30-welcome-white-logo");
  await page.getByText("I run a company").click();
  await page.getByText("Tax ID", { exact: false }).first().waitFor({ timeout: 8000 });
  await shot(page, "31-company-onboarding");
  await ctx.close(); console.log("✔ welcome+onboarding");
} catch (e) { console.log("✗ welcome/onboarding:", e.message); }

// 3) company services (pricing types) + 4) service editor + 5) settings
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByRole("button", { name: /Services/ }).click(); await pause(900);
  await shot(page, "32-company-services");
  await page.getByText("+ New service").click();
  await page.getByText("Pricing model").waitFor({ timeout: 8000 }); await pause(500);
  await shot(page, "33-service-editor");
  await page.getByRole("button", { name: /Settings/ }).click(); await pause(900);
  await shot(page, "34-company-settings");
  await ctx.close(); console.log("✔ company");
} catch (e) { console.log("✗ company:", e.message); }

// 6) customer hourly booking (hours stepper)
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await page.getByText("SparkClean Debrecen").click();
  await page.getByText("Cleaning by the hour").click();
  await page.getByText("How many hours", { exact: false }).waitFor({ timeout: 8000 }); await pause(500);
  await shot(page, "35-booking-hourly");
  await ctx.close(); console.log("✔ booking");
} catch (e) { console.log("✗ booking:", e.message); }

await browser.close();
console.log("done");
