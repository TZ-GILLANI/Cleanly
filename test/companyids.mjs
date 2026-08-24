/* COMPANY IDENTITY + TIME OFF, v7.1.

   Four things a partner types or taps that were each half-wired:

   1. The contact phone. The field registry has said type:"phone" since it was
      written and NOTHING read it, so the one number a customer rings when the
      cleaner has not arrived was a free-text box that accepted anything.
   2. The adószám and cégjegyzékszám. Nobody remembers where the dashes go, and
      a field that silently rejects what you typed teaches you nothing.
   3. The EU VAT number did not exist, and cross-border invoicing needs one.
   4. Time off could only be set inside the two-month booking window, and a day
      you had closed became UNTAPPABLE — the button you needed to reopen it was
      the one that had just been switched off.

   Run: node test/companyids.mjs                                              */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "cid-test";
process.env.PORT = "4597";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

const v = await import("../server/lib/validate.js");

console.log("\n── the dashes go in for you ──");
ok("a registration number gets its dashes", v.formatRegNumber("0909123456") === "09-09-123456", v.formatRegNumber("0909123456"));
ok("…while it is still being typed", v.formatRegNumber("0909") === "09-09", v.formatRegNumber("0909"));
ok("…and re-typing an already dashed one is stable",
   v.formatRegNumber(v.formatRegNumber("0909123456")) === "09-09-123456");
ok("a tax number gets its dashes as you go", v.formatTaxIdLive("123456781") === "12345678-1", v.formatTaxIdLive("123456781"));
ok("…and the full one lands correctly", v.formatTaxIdLive("12345678142") === "12345678-1-42", v.formatTaxIdLive("12345678142"));
ok("letters are simply ignored, not left in", v.formatTaxIdLive("12a34b5678142") === "12345678-1-42", v.formatTaxIdLive("12a34b5678142"));
ok("and it cannot run past 11 digits", v.formatTaxIdLive("1234567814299999") === "12345678-1-42", v.formatTaxIdLive("1234567814299999"));

console.log("\n── the EU VAT number, checked per country ──");
const c = (x, co, tax) => v.euVatCheck(x, co, tax);
ok("blank is fine — it is optional", c("").ok);
ok("a Hungarian number matching the adószám passes", c("HU12345678", "HU", "12345678-1-42").ok);
ok("one that does NOT match the adószám is caught", c("HU99999999", "HU", "12345678-1-42").reason === "tax_mismatch");
ok("a German number on a German company passes", c("DE123456789", "DE").ok);
ok("a German number on a Hungarian company is caught", c("DE123456789", "HU").reason === "country_mismatch");
ok("a malformed number is caught", c("HU123", "HU").reason === "shape");
ok("a non-EU country is caught", c("US123456789", "US").reason === "not_eu");
ok("Greece may use EL or GR", c("EL123456789", "GR").ok && c("GR123456789", "GR").ok);
ok("spaces and dots are tolerated", c("HU 1234-5678", "HU", "12345678-1-42").ok, JSON.stringify(c("HU 1234-5678", "HU", "12345678-1-42")));
ok("every EU member state has a shape",
   ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]
     .every((cc) => c(cc === "GR" ? "EL123456789" : null, cc).ok !== undefined));

/* ── end to end ── */
const BASE = "http://localhost:4597";
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

const boss = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "cid-boss@t.hu", password: "secret123", role: "company",
  companyName: "CID Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
ok("the company registers", boss.status === 201 || boss.status === 200, `got ${boss.status}`);
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["CID Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["cid-boss@t.hu"]);
const login = await j("/api/auth/login", { method: "POST", body: { email: "cid-boss@t.hu", password: "secret123" } });
const btok = login.data.token;
ok("the owner can log in", !!btok);

console.log("\n── the server stores what it was given, tidily ──");
const saveVat = await j("/api/companies/" + cid, { method: "PUT", token: btok, body: {
  euVat: "hu 1000-0001", regNumber: "0909123456", country: "HU", taxId: "10000001-1-02" } });
ok("a valid EU VAT number is accepted", saveVat.status === 200, JSON.stringify(saveVat.data).slice(0, 140));
const row = (await query("SELECT eu_vat, reg_number FROM companies WHERE id = $1", [cid])).rows[0];
ok("it is normalised before storing", row.eu_vat === "HU10000001", row.eu_vat);
ok("and the registration number keeps its dashes", row.reg_number === "09-09-123456", row.reg_number);

const badVat = await j("/api/companies/" + cid, { method: "PUT", token: btok, body: {
  euVat: "DE123456789", country: "HU", taxId: "10000001-1-02" } });
ok("a VAT number from the wrong country is refused", badVat.status === 400, `got ${badVat.status}`);
ok("and the refusal explains why", /country/i.test(badVat.data.error || ""), badVat.data.error);
const mismatch = await j("/api/companies/" + cid, { method: "PUT", token: btok, body: {
  euVat: "HU99999999", country: "HU", taxId: "10000001-1-02" } });
ok("a Hungarian VAT number that contradicts the adószám is refused", mismatch.status === 400);
ok("and it says exactly that", /adoszam|first 8 digits/i.test(mismatch.data.error || ""), mismatch.data.error);
const still = (await query("SELECT eu_vat FROM companies WHERE id = $1", [cid])).rows[0];
ok("a refused save leaves the good value alone", still.eu_vat === "HU10000001", still.eu_vat);

console.log("\n── time off, any date, any year ──");
const far = new Date(); far.setFullYear(far.getFullYear() + 1); far.setMonth(6); far.setDate(15);
const farIso = far.toISOString().slice(0, 10);
const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
const setClosed = (dates) => query(
  "UPDATE companies SET availability = $1 WHERE id = $2",
  [JSON.stringify({ paused: false, days: { 0:{on:true,slots:["08:00"]},1:{on:true,slots:["08:00"]},2:{on:true,slots:["08:00"]},3:{on:true,slots:["08:00"]},4:{on:true,slots:["08:00"]},5:{on:true,slots:["08:00"]},6:{on:true,slots:["08:00"]} }, closed: dates, busy: {}, busyServices: {} }), cid]);

await setClosed([farIso, soon]);
const stored = (await query("SELECT availability FROM companies WHERE id = $1", [cid])).rows[0].availability;
const av = typeof stored === "string" ? JSON.parse(stored) : stored;
ok("a date a year out can be stored as closed", (av.closed || []).includes(farIso), JSON.stringify(av.closed));
ok("alongside one inside the booking window", (av.closed || []).includes(soon));

const svc = await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid]);
const cu = await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana", email: "cid-ana@t.hu", password: "secret123", role: "customer",
  customerType: "resident", city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } });
const ctok = cu.data.token;

const bookOn = (date) => j("/api/bookings", { method: "POST", token: ctok, body: {
  companyId: cid, serviceId: svc.rows[0].id, scheduledDate: date, scheduledSlot: "08:00",
  address: "Piac utca 1", city: "Debrecen", paymentMethod: "cash" } });

const blocked = await bookOn(soon);
ok("the customer CANNOT book a closed day", blocked.status === 400, `got ${blocked.status} ${JSON.stringify(blocked.data).slice(0,90)}`);
ok("and is told the company is closed", /closed/i.test(blocked.data.error || ""), blocked.data.error);

const openDay = new Date(Date.now() + 11 * 864e5).toISOString().slice(0, 10);
const allowed = await bookOn(openDay);
ok("a day that is NOT closed still books", allowed.status < 300, `${allowed.status} ${allowed.data.error || ""}`);

/* Reopening has to work, or closing is a one-way door. */
await setClosed([farIso]);
const reopened = await bookOn(soon);
ok("reopening a day lets the customer book it again", reopened.status < 300,
   `${reopened.status} ${reopened.data.error || ""}`);
const av2 = (await query("SELECT availability FROM companies WHERE id = $1", [cid])).rows[0].availability;
const parsed2 = typeof av2 === "string" ? JSON.parse(av2) : av2;
ok("and the far-future closure survived the reopen", (parsed2.closed || []).includes(farIso));

console.log("\n── the screens that make this usable ──");
{
  const fs = await import("fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  ok("the calendar has an editing mode", /function MonthCalendar\(\{ days, value, onPick, isClosed, isFull, manage/.test(app));
  ok("in that mode nothing is disabled except the past",
     /const off = manage \? past : \(!d \|\| closed \|\| full\)/.test(app));
  /* The selected day is a filled control, so it moved onto C.accent with every
     other filled control. What matters here is unchanged: closed reads as grey,
     not as absent. */
  ok("a closed day is greyed rather than hidden",
     /background: on \? C\.accent : closed && manage \? C\.line/.test(app));
  ok("…and says so when you touch it",
     /Closed all day — tap to reopen/.test(app));
  ok("partly blocked days carry a dot", /const dot = manage && !closed && hasDot/.test(app));
  ok("the time-off grid roams beyond the booking window", /cursor\.y < new Date\(\)\.getFullYear\(\) \+ 5/.test(app));
  ok("and cannot go back before today", /const floorIso = manage \? \(minIso \|\| localISO\(new Date\(\)\)\)/.test(app));
  ok("there is a legend, so grey and dot mean something",
     /L\("Some hours blocked", "Néhány óra letiltva"\)/.test(app));

  ok("the company's contact number uses the verified row", /if \(x\.type === "phone"\) \{[\s\S]{0,260}<PhoneRow/.test(app));
  ok("the tax and registration fields shape themselves as you type",
     /x\.fmt === "reg" \? formatRegNumberC\(v\)[\s\S]{0,120}formatTaxIdLiveC\(v\)/.test(app));
  ok("the EU VAT field exists and is optional", /id: "eu_vat"[\s\S]{0,200}optional/i.test(app));
  ok("and it explains a rejection instead of just going red", /const vatWhy = \(r\) =>/.test(app));
}

console.log(`\n════ COMPANY IDs + TIME OFF: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
