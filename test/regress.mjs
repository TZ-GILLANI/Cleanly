/* REGRESSION SUITE — one test per bug we have actually shipped or nearly shipped.
   If any of these fails, a bug we already paid for has come back.
   Run: node test/regress.mjs                                                     */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4502";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4502${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/* ── cast ── */
await j("/api/auth/register", { method: "POST", body: { email: "co@r.hu", password: "secret123", role: "company", fullName: "Owner", companyName: "Regress Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cu@r.hu", password: "secret123", role: "customer", fullName: "Cust", phone: "+36301112233", city: "Debrecen", address: "Kossuth u 1", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const bcrypt = (await import("bcryptjs")).default;
await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status, city) VALUES ('ceo@r.hu', $1, 'Ceo', 'admin', true, 'approved', 'Debrecen')", [bcrypt.hashSync("secret123", 8)]);
await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status, city) VALUES ('plainadmin@r.hu', $1, 'Plain Admin', 'admin', false, 'approved', 'Debrecen')", [bcrypt.hashSync("secret123", 8)]);
const co = (await j("/api/auth/login", { method: "POST", body: { email: "co@r.hu", password: "secret123" } })).data;
const cu = (await j("/api/auth/login", { method: "POST", body: { email: "cu@r.hu", password: "secret123" } })).data;
const ceo = (await j("/api/auth/login", { method: "POST", body: { email: "ceo@r.hu", password: "secret123" } })).data;
const cid = co.user.company_id;

console.log("\n── BUG 1: the company's city silently never saved ──");
const put = await j("/api/companies/" + cid, { method: "PUT", token: co.token, body: { name: "Regress Co", city: "Szeged" } });
ok("PUT city is persisted", put.data.company?.city === "Szeged", put.data.company?.city);
ok("and it survives a re-read", (await j("/api/companies/" + cid)).data.company?.city === "Szeged");

console.log("\n── BUG 2: users had no city column, so city targeting failed ──");
const uc = await query("SELECT city FROM users WHERE email = 'cu@r.hu'");
ok("a customer's city is stored on the user row", uc.rows[0].city === "Debrecen", JSON.stringify(uc.rows[0]));
const cnt = await j("/api/notifications/broadcast", { method: "POST", token: ceo.token, body: { title: "t", city: "Debrecen", preview: true } });
ok("targeting by city returns a real count", (cnt.data.count || 0) >= 1, JSON.stringify(cnt.data));

console.log("\n── BUG 3: a failed refund left the booking stuck forever ──");
const svc = (await j("/api/services", { method: "POST", token: co.token, body: { name: "Clean", pricingType: "flat", priceHuf: 10000, durationMin: 60 } })).data.service;
const soon = new Date().toISOString().slice(0, 10);
const stuck = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: soon, scheduledSlot: "23:00", address: "Kossuth u 1" } })).data.booking;
// mark it paid with a payment reference that CANNOT be refunded — the exact failure case
await query("UPDATE bookings SET payment_status='paid', barion_payment_id='stripe:cs_does_not_exist', created_at = NOW() - INTERVAL '30 hours' WHERE id = $1", [stuck.id]);
const { sweepUnaccepted } = await import("../server/lib/reminders.js");
await sweepUnaccepted();
const after = (await query("SELECT status FROM bookings WHERE id = $1", [stuck.id])).rows[0];
ok("the booking is cancelled even though the refund could not run", Number(after.status) === 9, JSON.stringify(after));

console.log("\n── BUG 4: a removed review came back into the rating ──");
const b2 = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(30), scheduledSlot: "10:00", address: "Kossuth u 1" } })).data.booking;
await query("UPDATE bookings SET status = 4 WHERE id = $1", [b2.id]);
const rv = (await j("/api/reviews", { method: "POST", token: cu.token, body: { bookingId: b2.id, stars: 1, body: "abusive" } })).data.review;
await j(`/api/reviews/${rv.id}/report`, { method: "POST", token: co.token, body: { reason: "abusive language" } });
await j(`/api/reviews/${rv.id}/remove`, { method: "POST", token: ceo.token, body: { reason: "breaks the rules" } });
// now a second, good review arrives — the trigger must not resurrect the removed one
const b3 = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(31), scheduledSlot: "10:00", address: "Kossuth u 1" } })).data.booking;
await query("UPDATE bookings SET status = 4 WHERE id = $1", [b3.id]);
await j("/api/reviews", { method: "POST", token: cu.token, body: { bookingId: b3.id, stars: 5, body: "great" } });
const pub = await j("/api/reviews");
ok("the removed review stays out of the public list", !(pub.data.reviews || []).some((r) => r.id === rv.id));
const coList = await j("/api/reviews/company", { token: co.token });
ok("and out of the company's own list", !(coList.data.reviews || []).some((r) => r.id === rv.id));
const sqlHasGuard = (await import("fs")).readFileSync("schema.sql", "utf8");
const lastTrigger = sqlHasGuard.lastIndexOf("FUNCTION refresh_company_rating()");
ok("the rating trigger excludes removed reviews",
   sqlHasGuard.slice(lastTrigger).includes("removed_at IS NULL"),
   "the newest refresh_company_rating definition must filter removed_at");

console.log("\n── BUG 5: a job scheduled for TODAY was skipped by the sweeper ──");
const todayIso = new Date().toISOString().slice(0, 10);
const todayBk = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: todayIso, scheduledSlot: "22:00", address: "Kossuth u 1" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid', created_at = NOW() - INTERVAL '30 hours' WHERE id = $1", [todayBk.id]);
await sweepUnaccepted();
const todayAfter = (await query("SELECT status FROM bookings WHERE id = $1", [todayBk.id])).rows[0];
ok("a booking scheduled for today is swept", Number(todayAfter.status) === 9, JSON.stringify(todayAfter));

console.log("\n── BUG 6: non-CEO admins could see other admins by searching email ──");
const src = (await import("fs")).readFileSync("src/App.jsx", "utf8");
const filt = src.slice(src.indexOf("const filtered = (adminAllUsers"), src.indexOf("const filtered = (adminAllUsers") + 320);
ok("the admin list filter parenthesises the name/email OR",
   filt.includes('((u.full_name || "").toLowerCase().includes(q.toLowerCase()) ||'), filt.slice(0, 200));

console.log("\n── BUG 7 (Update 1): the booking whitelist dropped requirementsAck ──");
const storeSrc = (await import("fs")).readFileSync("src/store.jsx", "utf8");
ok("createBooking still forwards requirementsAck", storeSrc.includes("requirementsAck: b.requirementsAck === true"));
ok("updateCompany still forwards city and requirements",
   storeSrc.includes("city: fields.city") && storeSrc.includes("requirements: fields.requirements"));


console.log("\n── NEW GUARDS (Update 1, second pass) ──");
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const past = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: yesterday, scheduledSlot: "10:00", address: "Kossuth u 1" } });
ok("a booking in the past is refused", past.status === 400, JSON.stringify(past.data));
const today = new Date().toISOString().slice(0, 10);
const todayOk = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: today, scheduledSlot: "07:00", address: "Kossuth u 1" } });
ok("today is still allowed", todayOk.status === 201, JSON.stringify(todayOk.data).slice(0, 120));
const farOff = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(500), scheduledSlot: "10:00", address: "Kossuth u 1" } });
ok("a booking 500 days out is refused as a typo", farOff.status === 400, JSON.stringify(farOff.data));

/* capacity: a one-person company cannot be in two places at once */
const slotDay = dPlus(40);
const first = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("the first booking of a slot is accepted", first.status === 201, JSON.stringify(first.data).slice(0, 120));
const second = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("a second booking of the same slot is refused", second.status === 400, JSON.stringify(second.data));
/* Capacity is the size of the team, minimum one. A one-person business can take
   one job at 11:00; a two-person team can take two. Hiring one cleaner keeps the
   cap at one, because that cleaner IS the one person doing the work. */
const bcrypt2 = (await import("bcryptjs")).default;
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('hire@r.hu', $1, 'Hired', 'employee', $2, 'approved', true)", [bcrypt2.hashSync("secret123", 8), cid]);
const stillOne = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("one cleaner still means one job at a time", stillOne.status === 400, JSON.stringify(stillOne.data).slice(0, 120));
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('hire2@r.hu', $1, 'Hired Two', 'employee', $2, 'approved', true)", [bcrypt2.hashSync("secret123", 8), cid]);
const third = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("a second cleaner opens the slot for a second booking", third.status === 201, JSON.stringify(third.data).slice(0, 120));
/* a pending cleaner is not staff yet and must not raise the cap */
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('pend@r.hu', $1, 'Pending', 'employee', $2, 'pending', true)", [bcrypt2.hashSync("secret123", 8), cid]);
const pendBlocked = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("a cleaner still awaiting approval does not raise capacity", pendBlocked.status === 400, JSON.stringify(pendBlocked.data).slice(0, 120));
/* a cancelled booking must release its slot */
await query("UPDATE bookings SET status = 9 WHERE id = $1", [third.data.booking.id]);
const fourth = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: slotDay, scheduledSlot: "11:00", address: "Kossuth u 1" } });
ok("cancelling frees the slot again", fourth.status === 201, JSON.stringify(fourth.data).slice(0, 120));

/* services validation */
const badHours = await j("/api/services", { method: "POST", token: co.token, body: { name: "Bad", pricingType: "hourly", hourlyRateHuf: 4000, minHours: 8, maxHours: 2 } });
ok("min hours above max hours is refused", badHours.status === 400, JSON.stringify(badHours.data));
const negPrice = await j("/api/services", { method: "POST", token: co.token, body: { name: "Neg", pricingType: "flat", priceHuf: -5000 } });
ok("a negative price is refused", negPrice.status === 400, JSON.stringify(negPrice.data));
const badPeriod = await j("/api/services", { method: "POST", token: co.token, body: { name: "P", pricingType: "subscription", priceHuf: 9000, period: "fortnightly" } });
ok("an unknown billing period is refused", badPeriod.status === 400, JSON.stringify(badPeriod.data));

/* the public services list must not advertise companies nobody can book */
await query("UPDATE companies SET is_listed = false WHERE id = $1", [cid]);
const hidden = await j("/api/services");
ok("services of an unlisted company are not public", !(hidden.data.services || []).some((x) => x.company_id === cid), String((hidden.data.services || []).length));
await query("UPDATE companies SET is_listed = true WHERE id = $1", [cid]);
ok("and they come back when the company is listed again",
   ((await j("/api/services")).data.services || []).some((x) => x.company_id === cid));

/* a zero-priced service cannot become an unchargéable booking */
const freeSvc = (await j("/api/services", { method: "POST", token: co.token, body: { name: "Free", pricingType: "flat", priceHuf: 0 } })).data.service;
const freeBk = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: freeSvc.id, scheduledDate: dPlus(45), scheduledSlot: "12:00", address: "Kossuth u 1" } });
ok("a zero-total booking is refused rather than left unpayable", freeBk.status === 400, JSON.stringify(freeBk.data));

/* the schema loader must survive semicolons inside SQL comments */
const dbSrc = (await import("fs")).readFileSync("server/db.js", "utf8");
ok("the schema loader strips comments before splitting on ';'", /replace\(\/\^\[ \\t\]\*--/.test(dbSrc) || dbSrc.includes("Strip line comments BEFORE splitting"));


console.log("\n── per-service availability: one service full, the others still open ──");
const svcB = (await j("/api/services", { method: "POST", token: co.token, body: { name: "Laundry", pricingType: "flat", priceHuf: 8000 } })).data.service;
const psDay = dPlus(50);
/* Cleaning at 13:00 fills up. Laundry at 13:00 must stay bookable. */
const cA = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: psDay, scheduledSlot: "13:00", address: "Kossuth u 1" } });
ok("first booking of a service takes its slot", cA.status === 201, JSON.stringify(cA.data).slice(0, 120));
/* The team is two cleaners by now, so two of the same service fit — the third
   must not, because there is nobody left to send. */
await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: psDay, scheduledSlot: "13:00", address: "Kossuth u 1" } });
const cB = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: psDay, scheduledSlot: "13:00", address: "Kossuth u 1" } });
ok("the SAME service stops once the team is fully committed", cB.status === 400, JSON.stringify(cB.data).slice(0, 120));
const lA = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svcB.id, scheduledDate: psDay, scheduledSlot: "13:00", address: "Kossuth u 1" } });
ok("a DIFFERENT service is still bookable at the same hour", lA.status === 201, JSON.stringify(lA.data).slice(0, 140));

/* Blocking one service by hand must not close the hour for the others. */
const psDay2 = dPlus(51);
await j("/api/companies/" + cid, { method: "PUT", token: co.token, body: { name: "Regress Co", availability: {
  paused: false, closed: [], busy: {},
  busyServices: { [svc.id]: { [psDay2]: ["14:00"] } },
  days: { "0": { on: true, slots: ["13:00","14:00"] }, "1": { on: true, slots: ["13:00","14:00"] }, "2": { on: true, slots: ["13:00","14:00"] }, "3": { on: true, slots: ["13:00","14:00"] }, "4": { on: true, slots: ["13:00","14:00"] }, "5": { on: true, slots: ["13:00","14:00"] }, "6": { on: true, slots: ["13:00","14:00"] } } } } });
const savedAv = (await j("/api/companies/" + cid)).data.company?.availability;
ok("the per-service block is stored", !!savedAv?.busyServices?.[svc.id]?.[psDay2], JSON.stringify(savedAv?.busyServices));
const blocked = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: psDay2, scheduledSlot: "14:00", address: "Kossuth u 1" } });
ok("the blocked service is refused at that hour", blocked.status === 400, JSON.stringify(blocked.data));
const notBlocked = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svcB.id, scheduledDate: psDay2, scheduledSlot: "14:00", address: "Kossuth u 1" } });
ok("the other service is still bookable at that hour", notBlocked.status === 201, JSON.stringify(notBlocked.data).slice(0, 140));

/* A company-wide block still shuts everything. */
const psDay3 = dPlus(52);
await j("/api/companies/" + cid, { method: "PUT", token: co.token, body: { name: "Regress Co", availability: {
  paused: false, closed: [], busyServices: {}, busy: { [psDay3]: ["13:00"] },
  days: { "0": { on: true, slots: ["13:00","14:00"] }, "1": { on: true, slots: ["13:00","14:00"] }, "2": { on: true, slots: ["13:00","14:00"] }, "3": { on: true, slots: ["13:00","14:00"] }, "4": { on: true, slots: ["13:00","14:00"] }, "5": { on: true, slots: ["13:00","14:00"] }, "6": { on: true, slots: ["13:00","14:00"] } } } } });
ok("a company-wide block stops service A", (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: psDay3, scheduledSlot: "13:00", address: "K 1" } })).status === 400);
ok("and service B too", (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svcB.id, scheduledDate: psDay3, scheduledSlot: "13:00", address: "K 1" } })).status === 400);

console.log("\n── the per-service discount is no longer a dead input ──");
const withDisc = await j("/api/services", { method: "POST", token: co.token, body: { name: "Disc", pricingType: "flat", priceHuf: 10000, promoPct: 20 } });
ok("a service can be created with a discount", Number(withDisc.data.service?.promo_pct) === 20, JSON.stringify(withDisc.data.service?.promo_pct));
const dBk = await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: withDisc.data.service.id, scheduledDate: dPlus(53), scheduledSlot: "13:00", address: "K 1" } });
/* 10000 less 20% = 8000, plus 10% fee = 8800 */
ok("the discount is applied to the price the customer pays",
   Number(dBk.data.booking?.total_huf) === 8800, String(dBk.data.booking?.total_huf));
ok("and the platform fee is taken on the discounted amount",
   Number(dBk.data.booking?.service_fee_huf) === 800, String(dBk.data.booking?.service_fee_huf));
const cleared = await j("/api/services/" + withDisc.data.service.id, { method: "PUT", token: co.token, body: { promoPct: 0 } });
ok("sending 0 clears the discount", cleared.data.service?.promo_pct == null, JSON.stringify(cleared.data.service?.promo_pct));

const appSrc = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the services form actually sends promo_pct", /promo_pct: f\.promo_pct === ""/.test(appSrc));
ok("photos are shrunk rather than refused", appSrc.includes("async function compressImage("));
ok("uploads go through one prepare step", appSrc.includes("async function prepareUpload("));


console.log("\n── Cleano is not a website ──");
/* The API address used to hand the whole app to anyone who found the URL — a
   second, unversioned copy of the product with no store review behind it. */
const idxSrc = (await import("fs")).readFileSync("server/index.js", "utf8");
ok("the browser build is not served by default", /SERVE_WEB_APP === "1"/.test(idxSrc));
ok("and there is no catch-all handing back the app shell",
   !/app\.get\("\*"[\s\S]{0,120}index\.html/.test(idxSrc.split('SERVE_WEB_APP === "1"')[0]));
ok("the pages the stores require are still public",
   ["/terms", "/privacy", "/partner-terms", "/delete-account"].every((r) => idxSrc.includes(`app.get("${r}"`)));
ok("so is the page a payment provider redirects to", idxSrc.includes('app.get("/payment-result"'));
ok("the root points at the stores instead", /Google Play/.test(idxSrc));
ok("and it can be turned back on with one variable", /SERVE_WEB_APP/.test(idxSrc));


console.log("\n── the local walkthrough cannot poison a store build ──");
/* TEST-WEB.bat points the app at localhost. Vite reads .env.local in EVERY
   mode, so a file left behind by a force-closed window would have baked
   "http://localhost:3001" into the bundle that goes to Apple and Google —
   an app that installs, opens, and can reach nothing. Naming it
   .env.development.local makes that structurally impossible: a production
   build does not read it. */
const bat = (await import("fs")).existsSync("TEST-WEB.bat")
  ? (await import("fs")).readFileSync("TEST-WEB.bat", "utf8") : "";
ok("the walkthrough writes a dev-only env file", !bat || /\.env\.development\.local/.test(bat));
ok("and never the one a production build would read", !/> \.env\.local\b/.test(bat));
const prod = (await import("fs")).readFileSync(".env.production", "utf8");
ok("the shipped bundle points at the real API", /VITE_API_BASE=https:\/\//.test(prod), prod.trim());
ok("and is in API mode, not demo mode", /VITE_USE_API=true/.test(prod));
ok("no stray .env.local is sitting in the folder", !(await import("fs")).existsSync(".env.local"));


console.log("\n── either Stripe secret is enough ──");
const paySrcW = (await import("fs")).readFileSync("server/routes/payments.js", "utf8");
/* The guard used to demand STRIPE_WEBHOOK_SECRET by name. With only the
   Connect secret set, every event would have been refused with a 503 —
   payments succeeding, bookings never marked paid, and nothing in the logs
   that reads like a payment fault. */
ok("the webhook accepts either signing secret",
   /STRIPE_WEBHOOK_SECRET \|\| process\.env\.STRIPE_CONNECT_WEBHOOK_SECRET/.test(paySrcW));
ok("and still verifies the signature against both", /const secrets = \[process\.env\.STRIPE_WEBHOOK_SECRET, process\.env\.STRIPE_CONNECT_WEBHOOK_SECRET\]/.test(paySrcW));
ok("Connect events carry the partner's account through", /const connectAcct = event\.account/.test(paySrcW));

console.log(`\n════ REGRESSIONS: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
