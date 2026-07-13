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

// customer home (address bar) + profile panel
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "musa@cleanly.hu", "customer123");
  await page.getByText("Companies near you").waitFor({ timeout: 20000 });
  await shot(page, "70-home-address-bar");
  await page.locator("button", { hasText: /Set your home address|Debrecen/ }).first().click();
  await page.getByText("Payment method").waitFor({ timeout: 8000 });
  await shot(page, "71-profile-panel", true);
  await ctx.close(); console.log("✔ customer profile");
} catch (e) { console.log("✗ customer:", e.message); }

// company team — invite/access-code sheet: is the button reachable?
try {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await login(page, "spark@cleanly.hu", "company123");
  await page.getByRole("button", { name: /Team/ }).click(); await pause(700);
  await page.getByText("+ Invite employee").click();
  const btn = page.getByRole("button", { name: /Generate invite code/ });
  await btn.waitFor({ timeout: 8000 });
  const box = await btn.boundingBox();
  const vh = page.viewportSize().height;
  console.log("invite button:", JSON.stringify(box), "vh", vh, box && box.y + box.height <= vh + 1 ? "VISIBLE ✓" : "BELOW FOLD ✗");
  await shot(page, "72-invite-sheet");
  await ctx.close(); console.log("✔ invite");
} catch (e) { console.log("✗ invite:", e.message); }

await browser.close();
console.log("done");
