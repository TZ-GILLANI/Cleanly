/* CHANGING THE NUMBER ON AN ACCOUNT.

   The hole this closes: PUT /api/auth/profile wrote whatever phone was posted
   and left phone_verified alone. So any logged-in customer or cleaner could
   type a stranger's number, press Save, and end up with an account claiming a
   verified number they had never proved. It also meant a stolen session could
   quietly move an account onto the thief's SIM.

   Twilio is stubbed — we are testing our logic, not theirs. "000000" is the
   code the fake accepts.

   Run: node test/phone-change.mjs                                            */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "pc-test-secret";
process.env.PORT = "4588";
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "tok";
process.env.TWILIO_VERIFY_SID = "VAtest";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

const BASE = "http://localhost:4588";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

/* ── Fake Twilio Verify ──
   Records every number we send a code to, so we can prove the code went to the
   NEW number and never to the old one. */
const sentTo = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("verify.twilio.com")) {
    const body = new URLSearchParams(opts?.body || "");
    if (u.endsWith("/Verifications")) {
      sentTo.push(body.get("To"));
      return new Response(JSON.stringify({ sid: "VE1", status: "pending", channel: body.get("Channel") }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const approved = body.get("Code") === "000000";
    return new Response(JSON.stringify({ status: approved ? "approved" : "pending" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");

const OLD = "+36703031941";
const NEW = "+36201234567";
const OTHER = "+36305556677";

console.log("\n── two accounts, both with a number on file ──");
const reg = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana Test", email: "pc-ana@test.hu", password: "secret123",
  role: "customer", customerType: "resident", phone: OLD, city: "Debrecen", address: "Piac utca 1", termsAccepted: true } });
ok("customer registers", reg.status === 201 && !!reg.data.token, JSON.stringify(reg.data).slice(0, 160));
const tok = reg.data.token;
const meId = reg.data.user?.id;

const reg2 = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Bela Test", email: "pc-bela@test.hu", password: "secret123",
  role: "customer", customerType: "resident", phone: OTHER, city: "Debrecen", address: "Piac utca 2", termsAccepted: true } });
ok("a second customer registers, holding another number", reg2.status === 201);

await query("UPDATE users SET phone_verified = true WHERE id = $1", [meId]);
const phoneOf = async () => (await query("SELECT phone, phone_verified FROM users WHERE id = $1", [meId])).rows[0];

console.log("\n── the old hole: writing a new number through the profile ──");
const sneak = await j("/api/auth/profile", { method: "PUT", token: tok, body: { fullName: "Ana Test", phone: NEW } });
ok("profile save REFUSES to change the phone", sneak.status === 400, `got ${sneak.status}`);
ok("and says why, in a code the app can translate",
   sneak.data.error === "phone_change_needs_verification", JSON.stringify(sneak.data));
let row = await phoneOf();
ok("the number in the database is untouched", row.phone === OLD, row.phone);
ok("and it is still marked verified", row.phone_verified === true);

console.log("\n── saving the profile without touching the phone still works ──");
const save = await j("/api/auth/profile", { method: "PUT", token: tok, body: { fullName: "Ana Renamed", phone: OLD, lang: "hu" } });
ok("posting the SAME number back is a no-op, not an error", save.status === 200, JSON.stringify(save.data).slice(0, 140));
ok("the rest of the profile did save", save.data.user?.full_name === "Ana Renamed");
const noPhone = await j("/api/auth/profile", { method: "PUT", token: tok, body: { fullName: "Ana Renamed 2" } });
ok("omitting the phone entirely is fine too", noPhone.status === 200);
ok("phone survives a save that never mentioned it", (await phoneOf()).phone === OLD);

console.log("\n── the new flow: prove the new number ──");
const badNum = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: "70303194149" } });
ok("a nonsense number is rejected before any SMS", badNum.status === 400, `got ${badNum.status}`);
ok("no code was sent for it", !sentTo.includes("70303194149"));

const same = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: OLD } });
ok("asking to change to the number you already have is refused", same.status === 400);

const taken = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: OTHER } });
ok("someone else's number is refused with 409", taken.status === 409, `got ${taken.status}`);
ok("and no code was sent to that stranger", !sentTo.includes(OTHER));

const anon = await j("/api/verify/phone-change/start", { method: "POST", body: { phone: NEW } });
ok("a logged-out caller cannot start a change at all", anon.status === 401, `got ${anon.status}`);

const start = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: NEW } });
ok("starting a real change is accepted", start.status === 200 && start.data.sent === true, JSON.stringify(start.data));
ok("the code went to the NEW number", sentTo[sentTo.length - 1] === NEW, sentTo.join(","));
ok("the code did NOT go to the old number", !sentTo.includes(OLD));
ok("nothing changed yet — start alone writes nothing", (await phoneOf()).phone === OLD);

console.log("\n── the code is what does the writing ──");
const wrong = await j("/api/verify/phone-change/check", { method: "POST", token: tok, body: { phone: NEW, code: "111111" } });
ok("a wrong code is rejected", wrong.status === 400, `got ${wrong.status}`);
ok("and still nothing is written", (await phoneOf()).phone === OLD);

const noCode = await j("/api/verify/phone-change/check", { method: "POST", token: tok, body: { phone: NEW } });
ok("a missing code is rejected", noCode.status === 400);

const good = await j("/api/verify/phone-change/check", { method: "POST", token: tok, body: { phone: NEW, code: "000000" } });
ok("the right code is accepted", good.status === 200 && good.data.verified === true, JSON.stringify(good.data));
ok("the response hands back the number now on file", good.data.phone === NEW);
row = await phoneOf();
ok("the database now holds the new number", row.phone === NEW, row.phone);
ok("and phone_verified is true — set in the same statement", row.phone_verified === true);

console.log("\n── it moved everywhere, because nothing keeps a copy ──");
const me = await j("/api/auth/me", { token: tok });
ok("the session reads the new number", me.data.user?.phone === NEW, JSON.stringify(me.data.user?.phone));
const stale = await query("SELECT COUNT(*)::int AS n FROM users WHERE phone = $1", [OLD]);
ok("no row anywhere still carries the old number", stale.rows[0].n === 0, String(stale.rows[0].n));

console.log("\n── the released number, and the one that got away ──");
const reuse = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: OLD } });
ok("the number they just left can be claimed back", reuse.status === 200, `got ${reuse.status}`);

/* Race: the number is free when they ask for a code, taken by the time they
   type it back. Without the second check this hits the unique index and
   becomes a 500 nobody can act on. */
await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: "+36707778899" } });
await query("UPDATE users SET phone = $1 WHERE email = $2", ["+36707778899", "pc-bela@test.hu"]);
const raced = await j("/api/verify/phone-change/check", { method: "POST", token: tok, body: { phone: "+36707778899", code: "000000" } });
ok("a number claimed mid-flow gives 409, not a 500", raced.status === 409, `got ${raced.status}`);
ok("the account keeps the number it had", (await phoneOf()).phone === NEW);

console.log("\n── a cleaner is held to the same rule ──");
const co = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "pc-boss@test.hu", password: "secret123", role: "company", termsAccepted: true,
  companyName: "PC Clean Kft", phone: "+36301112233", city: "Debrecen", taxId: "10000001-1-02" } });
ok("a company registers", co.status === 201 || co.status === 200, `got ${co.status} ${JSON.stringify(co.data)}`);
const coId = (await query("SELECT id FROM companies WHERE name = $1", ["PC Clean Kft"])).rows[0]?.id;
const invite = "PCTEST-01";
await query("INSERT INTO invite_codes (code, company_id, label) VALUES ($1,$2,$3)", [invite, coId, "Cleaner One"]);
const cl = await j("/api/auth/register", { method: "POST", body: {
  inviteCode: invite,
  fullName: "Cleaner One", email: "pc-cleaner@test.hu", password: "secret123",
  role: "employee", termsAccepted: true, phone: "+36302223344", city: "Debrecen", companyId: co.data.user?.company_id || co.data.company?.id } });
ok("a cleaner registers", cl.status === 201 || cl.status === 200, `got ${cl.status} ${JSON.stringify(cl.data)}`);
if (cl.data.token) {
  const clSneak = await j("/api/auth/profile", { method: "PUT", token: cl.data.token, body: { fullName: "Cleaner One", phone: "+36309998877" } });
  ok("the cleaner cannot change their number through the profile either", clSneak.status === 400, `got ${clSneak.status}`);
  const clRow = await query("SELECT phone FROM users WHERE email = $1", ["pc-cleaner@test.hu"]);
  ok("the cleaner's number is untouched", clRow.rows[0].phone === "+36302223344", clRow.rows[0].phone);
}

console.log("\n── SMS costs money: the change form is capped like signup ──");
/* rateLimit() multiplies every cap by 50 under PGMEM so the API suite can
   hammer one IP. That is fine, but it means a test that loops 8 times proves
   nothing — my first version of this check passed 8 requests and concluded the
   limiter worked. It isn't wired to a cap of 3 here; it's wired to 150. */
const { rateLimit } = await import("../server/routes/auth.js");
const k = "pc-selftest-" + Date.now();
const cap = 50;                       // 1 × the PGMEM multiplier
let allowed = 0;
for (let i = 0; i < cap + 5; i++) if (rateLimit(k, 1, 60e3)) allowed++;
ok("the limiter allows exactly the cap and then refuses", allowed === cap, String(allowed));
ok("a fresh key starts with its own budget", rateLimit(k + "-b", 1, 60e3) === true);

let limited = false, tries = 0;
for (let i = 0; i < 220; i++) {
  tries++;
  const r = await j("/api/verify/phone-change/start", { method: "POST", token: tok, body: { phone: "+36301" + String(230000 + i) } });
  if (r.status === 429) { limited = true; break; }
  if (r.status !== 200) { ok("every probe number is one the validator accepts", false, `${r.status} ${JSON.stringify(r.data)}`); break; }
}
ok("the endpoint does eventually refuse — it is wired to the limiter", limited, `gave up after ${tries}`);
ok("and it refused near the test-inflated cap, not at random", tries > 100 && tries < 200, String(tries));

console.log(`\n════ PHONE CHANGE: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
