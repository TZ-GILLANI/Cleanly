/* COLLECTION SERVICES — laundry, ironing, anything taken away and brought back.
   Run: node test/collection.mjs                                                */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4509";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const bcrypt = (await import("bcryptjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4509${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: { email: "co@c.hu", password: "secret123", role: "company", fullName: "O", companyName: "Wash Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cu@c.hu", password: "secret123", role: "customer", fullName: "Cust", phone: "+36301114455", city: "Debrecen", address: "Kossuth u 1", customerType: "resident", termsAccepted: true } });
/* A second customer, because capacity is about how many DIFFERENT jobs fit —
   and the same person asking twice for the same service, hour and address is
   now correctly treated as retrying one booking rather than wanting two. */
await j("/api/auth/register", { method: "POST", body: { email: "cu2@c.hu", password: "secret123", role: "customer", fullName: "Másik", phone: "+36301114466", city: "Debrecen", address: "Piac u 9", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const login = async (e) => (await j("/api/auth/login", { method: "POST", body: { email: e, password: "secret123" } })).data;
const CO = await login("co@c.hu"), CU = await login("cu@c.hu"), CU2 = await login("cu2@c.hu");
const cid = CO.user.company_id;
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('cl@c.hu', $1, 'Driver', 'employee', $2, 'approved', true)", [bcrypt.hashSync("secret123", 8), cid]);
const CL = await login("cl@c.hu");

console.log("\n── a company creates a collection service ──");
const laundry = (await j("/api/services", { method: "POST", token: CO.token, body: {
  name: "Laundry & ironing", pricingType: "flat", priceHuf: 6000, minutes: 30,
  fulfilment: "collection", turnaroundDays: 3, slotCapacity: 8 } })).data.service;
ok("it saves as a collection service", laundry?.fulfilment === "collection", laundry?.fulfilment);
ok("with a stated turnaround", Number(laundry.turnaround_days) === 3, String(laundry.turnaround_days));
ok("and its own pickups-per-hour", Number(laundry.slot_capacity) === 8, String(laundry.slot_capacity));
const cleaning = (await j("/api/services", { method: "POST", token: CO.token, body: { name: "Home clean", pricingType: "flat", priceHuf: 10000 } })).data.service;
ok("an ordinary service still defaults to on-site", cleaning.fulfilment === "onsite", cleaning.fulfilment);
ok("and has no capacity override", cleaning.slot_capacity == null, String(cleaning.slot_capacity));
ok("a made-up fulfilment type is refused",
   (await j("/api/services", { method: "POST", token: CO.token, body: { name: "X", pricingType: "flat", priceHuf: 1000, fulfilment: "teleport" } })).status === 400);
ok("an absurd turnaround is refused",
   (await j("/api/services", { method: "POST", token: CO.token, body: { name: "X", pricingType: "flat", priceHuf: 1000, fulfilment: "collection", turnaroundDays: 999 } })).status === 400);

console.log("\n── booking one tells the customer when it comes back ──");
const day = dPlus(9);
const bk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: laundry.id, scheduledDate: day, scheduledSlot: "10:00", address: "Kossuth u 1" } })).data.booking;
ok("the booking is marked as a collection", bk.fulfilment === "collection", bk.fulfilment);
const expected = new Date(day + "T00:00:00Z"); expected.setUTCDate(expected.getUTCDate() + 3);
ok("the return date is the pickup plus the turnaround",
   String(bk.return_date).slice(0, 10) === expected.toISOString().slice(0, 10),
   `${String(bk.return_date).slice(0, 10)} vs ${expected.toISOString().slice(0, 10)}`);
const cleanBk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: cleaning.id, scheduledDate: day, scheduledSlot: "11:00", address: "Kossuth u 1" } })).data.booking;
ok("an on-site booking has no return date", cleanBk.return_date == null && cleanBk.fulfilment === "onsite");

console.log("\n── one van can call at several houses in an hour ──");
/* The team is one person, so an on-site service allows one job at 10:00.
   The laundry service says 8 pickups, so it must allow more. */
for (let i = 0; i < 5; i++) {
  await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: laundry.id, scheduledDate: day, scheduledSlot: "10:00", address: `Street ${i}` } });
}
const madeAt10 = await query("SELECT COUNT(*)::int n FROM bookings WHERE service_id=$1 AND scheduled_slot='10:00' AND status NOT IN (8,9)", [laundry.id]);
ok("six pickups fit into the same hour", madeAt10.rows[0].n === 6, String(madeAt10.rows[0].n));
const cleanClash = await j("/api/bookings", { method: "POST", token: CU2.token, body: { companyId: cid, serviceId: cleaning.id, scheduledDate: day, scheduledSlot: "11:00", address: "Piac u 9" } });
ok("but the on-site service is still one job per person per hour", cleanClash.status === 400, JSON.stringify(cleanClash.data));

console.log("\n── the collection ladder, in order ──");
await j(`/api/bookings/${bk.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
const step = async (to) => (await j(`/api/bookings/${bk.id}/status`, { method: "PUT", token: CL.token, body: { status: to } })).status;
const at = async () => Number((await query("SELECT status FROM bookings WHERE id=$1", [bk.id])).rows[0].status);
ok("assigned", await at() === 1);
ok("a driver cannot jump straight to returned", await step(4) === 400);
ok("nor mark it collected before setting off", await step(5) === 400);
ok("on the way", await step(2) === 200 && await at() === 2);
ok("collected", await step(5) === 200 && await at() === 5);
const collectedAt = (await query("SELECT collected_at FROM bookings WHERE id=$1", [bk.id])).rows[0].collected_at;
ok("the moment of collection is recorded", !!collectedAt);
ok("in progress", await step(3) === 200 && await at() === 3);
ok("out for return", await step(6) === 200 && await at() === 6);
ok("returned", await step(4) === 200 && await at() === 4);
const returnedAt = (await query("SELECT returned_at FROM bookings WHERE id=$1", [bk.id])).rows[0].returned_at;
ok("the moment of return is recorded", !!returnedAt);

console.log("\n── the job is only finished when the items are back ──");
const bk2 = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: laundry.id, scheduledDate: dPlus(12), scheduledSlot: "12:00", address: "Kossuth u 1" } })).data.booking;
await j(`/api/bookings/${bk2.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
await j(`/api/bookings/${bk2.id}/status`, { method: "PUT", token: CL.token, body: { status: 2 } });
await j(`/api/bookings/${bk2.id}/status`, { method: "PUT", token: CL.token, body: { status: 5 } });
const earlyReview = await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: bk2.id, stars: 5, body: "?" } });
ok("a customer cannot review a job whose items are still away", earlyReview.status === 403, String(earlyReview.status));
const outstanding = await j("/api/invoices/company/outstanding", { token: CO.token });
ok("and it is not yet chased for an invoice", !(outstanding.data.bookings || []).some((b) => b.id === bk2.id));
const doneReview = await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: bk.id, stars: 5, body: "Lovely" } });
ok("but the returned job can be reviewed", doneReview.status === 201, JSON.stringify(doneReview.data).slice(0, 100));

console.log("\n── an on-site job still behaves exactly as before ──");
const onsite = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: cleaning.id, scheduledDate: dPlus(14), scheduledSlot: "09:00", address: "Kossuth u 1" } })).data.booking;
await j(`/api/bookings/${onsite.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
const oStep = async (to) => (await j(`/api/bookings/${onsite.id}/status`, { method: "PUT", token: CL.token, body: { status: to } })).status;
ok("on the way", await oStep(2) === 200);
ok("a cleaning job cannot be 'collected'", [400, 403].includes(await oStep(5)));
ok("cleaning", await oStep(3) === 200);
ok("done", await oStep(4) === 200 && Number((await query("SELECT status FROM bookings WHERE id=$1", [onsite.id])).rows[0].status) === 4);
ok("and no return timestamps were invented", (await query("SELECT collected_at, returned_at FROM bookings WHERE id=$1", [onsite.id])).rows[0].returned_at == null);

console.log("\n── duration can be entered in hours ──");
const src = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the form offers minutes or hours", /dur_unit/.test(src) && /Math\.round\(Number\(v\) \* 60\)/.test(src));
ok("minutes stay the stored unit", /minutes: f\.dur_unit === "h"/.test(src));
const hourly = (await j("/api/services", { method: "POST", token: CO.token, body: { name: "Three hour clean", pricingType: "flat", priceHuf: 20000, minutes: 180 } })).data.service;
ok("a 3-hour service stores 180 minutes", Number(hourly.minutes) === 180, String(hourly.minutes));


console.log("\n── priced by the kilo, and by the square metre ──");
const perKg = (await j("/api/services", { method: "POST", token: CO.token, body: {
  name: "Wash & fold", pricingType: "unit", unitLabel: "kg", unitPriceHuf: 1200, minUnits: 2, maxUnits: 20,
  fulfilment: "collection", turnaroundDays: 2 } })).data.service;
ok("a per-kilo service is created", perKg?.pricing_type === "unit" && perKg.unit_label === "kg", JSON.stringify(perKg?.pricing_type));
ok("with its rate stored", Number(perKg.unit_price_huf) === 1200 && Number(perKg.min_units) === 2 && Number(perKg.max_units) === 20);
const perM2 = (await j("/api/services", { method: "POST", token: CO.token, body: {
  name: "Carpet cleaning", pricingType: "unit", unitLabel: "m²", unitPriceHuf: 900, minUnits: 5, maxUnits: 200 } })).data.service;
ok("a per-square-metre service is created", perM2.unit_label === "m²" && Number(perM2.unit_price_huf) === 900);
ok("a per-unit service with no unit name is refused",
   (await j("/api/services", { method: "POST", token: CO.token, body: { name: "X", pricingType: "unit", unitPriceHuf: 500 } })).status === 400);
ok("and one with no rate is refused",
   (await j("/api/services", { method: "POST", token: CO.token, body: { name: "X", pricingType: "unit", unitLabel: "kg" } })).status === 400);
ok("a minimum above the maximum is refused",
   (await j("/api/services", { method: "POST", token: CO.token, body: { name: "X", pricingType: "unit", unitLabel: "kg", unitPriceHuf: 100, minUnits: 20, maxUnits: 5 } })).status === 400);

const kgBk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perKg.id, scheduledDate: dPlus(20), scheduledSlot: "09:00", address: "Kossuth u 1", units: 5 } })).data.booking;
ok("5 kg at 1,200 Ft is 6,000 Ft plus the 10% fee = 6,600", Number(kgBk.total_huf) === 6600, String(kgBk.total_huf));
ok("the quantity and unit are recorded on the booking", Number(kgBk.units) === 5 && kgBk.unit_label === "kg", JSON.stringify([kgBk.units, kgBk.unit_label]));
ok("it is still a collection job with a return date", kgBk.fulfilment === "collection" && !!kgBk.return_date);

const m2Bk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perM2.id, scheduledDate: dPlus(21), scheduledSlot: "09:00", address: "Kossuth u 1", units: 12 } })).data.booking;
ok("12 m² at 900 Ft is 10,800 plus fee = 11,880", Number(m2Bk.total_huf) === 11880, String(m2Bk.total_huf));

const noQty = await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perKg.id, scheduledDate: dPlus(22), scheduledSlot: "09:00", address: "Kossuth u 1" } });
ok("booking a per-unit service without a quantity is refused", noQty.status === 400, JSON.stringify(noQty.data));
const tooMuch = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perKg.id, scheduledDate: dPlus(23), scheduledSlot: "09:00", address: "Kossuth u 1", units: 9999 } })).data.booking;
ok("an absurd quantity is clamped to the company's maximum", Number(tooMuch.units) === 20, String(tooMuch.units));
const tooLittle = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perKg.id, scheduledDate: dPlus(24), scheduledSlot: "09:00", address: "Kossuth u 1", units: 0.1 } })).data.booking;
ok("and below the minimum is raised to it", Number(tooLittle.units) === 2, String(tooLittle.units));
ok("the client cannot dictate the total for a per-unit job",
   Number((await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: perKg.id, scheduledDate: dPlus(25), scheduledSlot: "09:00", address: "K 1", units: 3, total_huf: 1 } })).data.booking?.total_huf) === 3960);


console.log("\n── tracking works on BOTH legs of a collection ──");
const trackBk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: laundry.id, scheduledDate: dPlus(30), scheduledSlot: "14:00", address: "Kossuth u 1" } })).data.booking;
await j(`/api/bookings/${trackBk.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
const stepT = async (to) => (await j(`/api/bookings/${trackBk.id}/status`, { method: "PUT", token: CL.token, body: { status: to } })).status;
const post = async () => (await j(`/api/bookings/${trackBk.id}/location`, { method: "PUT", token: CL.token, body: { lat: 47.53, lng: 21.62 } })).status;
const read = async () => (await j(`/api/bookings/${trackBk.id}/location`, { token: CU.token })).data;

await stepT(2);
ok("outbound: the driver can share their location", await post() === 200);
ok("outbound: the customer can see it", (await read()).lat != null);
await stepT(5); await stepT(3);
await stepT(6);
ok("return leg: the driver can still share", await post() === 200);
const back = await read();
ok("return leg: the customer can watch it come back", back.lat != null, JSON.stringify(back));
ok("someone else still cannot read the location",
   (await j(`/api/bookings/${trackBk.id}/location`, { token: CO.token })).status === 200);

/* Comments blanked out, line numbers preserved. Counting call sites in raw
   source counts the sentences that MENTION them too — the paragraph explaining
   when the tracker unmounts names canTrack(b), and this check reported five
   entry points where there are four. Fourth time today this exact shape of
   mistake has bitten; strip properly. */
const appRaw = (await import("fs")).readFileSync("src/App.jsx", "utf8");
const appSrc = appRaw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
ok("the app offers tracking on both legs of a collection", /fulfilment === "collection" \? \(st === 2 \|\| st === 6\)/.test(appSrc));
ok("and not while the items are at the company's premises", !/st === 5/.test(appSrc.slice(appSrc.indexOf("const canTrack"), appSrc.indexOf("const canTrack") + 400)));
ok("every tracking entry point uses the same rule", (appSrc.match(/canTrack\(b\)/g) || []).length === 4, String((appSrc.match(/canTrack\(b\)/g) || []).length));

console.log(`\n════ COLLECTION SERVICES: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
