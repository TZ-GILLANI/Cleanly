/* WORKFLOWS — the four journeys walked end to end, in order, as a real person
   would. The other suites test features in isolation; this one checks that the
   handovers between roles actually line up: what the company sets is what the
   customer sees, what the customer books is what the cleaner is sent to, and
   what the cleaner finishes is what gets invoiced.

   Run: node test/workflows.mjs                                                 */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4508";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const bcrypt = (await import("bcryptjs")).default;
let pass = 0, fail = 0, step = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log(`   ${++step}. ✓ ${n}`); } else { fail++; console.log(`   ${++step}. ✗ ${n}`, e); } };
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4508${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const login = async (e, p = "secret123") => (await j("/api/auth/login", { method: "POST", body: { email: e, password: p } })).data;
const ALL_HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"];
const OPEN_WEEK = Object.fromEntries([0,1,2,3,4,5,6].map((d) => [String(d), { on: true, slots: ALL_HOURS }]));

/* ═══════════════════════════════════════════════════════════════
   JOURNEY 1 — A COMPANY GOES FROM SIGNUP TO TAKING BOOKINGS
   ═══════════════════════════════════════════════════════════════ */
console.log("\n═══ JOURNEY 1 · Company: signs up → approved → open for business ═══");
const reg = await j("/api/auth/register", { method: "POST", body: { email: "co@w.hu", password: "secret123", role: "company", fullName: "Owner", companyName: "Walk Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
ok("company registers and is told it is pending", reg.status === 201 && reg.data.pendingApproval === true, JSON.stringify(reg.data));
const blockedLogin = await j("/api/auth/login", { method: "POST", body: { email: "co@w.hu", password: "secret123" } });
ok("it cannot log in before an admin approves it", blockedLogin.status !== 200 || !blockedLogin.data.token, String(blockedLogin.status));

await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status) VALUES ('ceo@w.hu', $1, 'CEO', 'admin', true, 'approved')", [bcrypt.hashSync("secret123", 8)]);
const CEO = await login("ceo@w.hu");
/* The admin company list uses correlated subqueries for booking counts, which the
   in-memory test database cannot plan. Check the state it reports on instead. */
const pendingRow = await query("SELECT is_approved, is_listed FROM companies WHERE name = 'Walk Co'");
ok("the company exists but is not yet approved",
   pendingRow.rows[0] && pendingRow.rows[0].is_approved === false, JSON.stringify(pendingRow.rows[0]));
const cidRow = await query("SELECT id FROM companies WHERE name = 'Walk Co'");
const cid = cidRow.rows[0].id;
const appr = await j(`/api/admin/companies/${cid}`, { method: "PUT", token: CEO.token, body: { isApproved: true, isListed: true } });
ok("the admin approves it", appr.status === 200 && appr.data.company?.is_approved === true, JSON.stringify(appr.data).slice(0, 120));
await query("UPDATE users SET approval_status = 'approved' WHERE email = 'co@w.hu'");
const CO = await login("co@w.hu");
ok("once approved it can log in", !!CO.token);

const avail = await j("/api/companies/" + cid, { method: "PUT", token: CO.token, body: {
  name: "Walk Co", availability: { paused: false, closed: [dPlus(3)], busy: {}, busyServices: {}, days: OPEN_WEEK } } });
ok("it sets its working hours and a day off", avail.status === 200 && (avail.data.company?.availability?.closed || []).includes(dPlus(3)));
const area = await j("/api/companies/" + cid, { method: "PUT", token: CO.token, body: {
  name: "Walk Co", serviceLat: 47.5316, serviceLng: 21.6273, serviceRadiusKm: 25,
  billingName: "Walk Co Kft.", billingZip: "4032", billingCity: "Debrecen", billingAddress: "Bolyai utca 11.", billingEmail: "szamla@walk.hu" } });
ok("it drops a pin and sets a 25 km service circle", Number(area.data.company?.service_radius_km) === 25);
ok("and fills in the billing address the fee invoice needs", area.data.company?.billing_zip === "4032");
const reqSet = await j("/api/companies/" + cid, { method: "PUT", token: CO.token, body: { name: "Walk Co", requirements: ["Parking for our van", "Hot running water"] } });
ok("it writes what customers must have ready", (reqSet.data.company?.requirements || []).length === 2);
const svc = (await j("/api/services", { method: "POST", token: CO.token, body: { name: "Deep clean", description: "Kitchen, bathroom, floors", pricingType: "flat", priceHuf: 10000, minutes: 120, tasks: ["Kitchen", "Bathroom", "Floors"] } })).data.service;
ok("it publishes a service", !!svc?.id && Number(svc.price_huf) === 10000);

/* ═══════════════════════════════════════════════════════════════
   JOURNEY 2 — A CLEANER JOINS THAT COMPANY
   ═══════════════════════════════════════════════════════════════ */
console.log("\n═══ JOURNEY 2 · Cleaner: invite code → approved → ready for work ═══");
const invite = await j("/api/employees/invites", { method: "POST", token: CO.token, body: { label: "Anna" } });
const code = invite.data?.code || invite.data?.invite?.code;
ok("the company generates an invite code", !!code, JSON.stringify(invite.data).slice(0, 120));
const clReg = await j("/api/auth/register", { method: "POST", body: { email: "cl@w.hu", password: "secret123", role: "employee", fullName: "Anna Nagy", phone: "+36301230001", address: "Piac utca 5", inviteCode: code, termsAccepted: true } });
ok("the cleaner signs up with that code", clReg.status === 201, JSON.stringify(clReg.data).slice(0, 120));
const clBlocked = await j("/api/auth/login", { method: "POST", body: { email: "cl@w.hu", password: "secret123" } });
ok("but cannot log in until the company approves them", clBlocked.status !== 200 || !clBlocked.data.token);
const pend = await j("/api/employees/pending", { token: CO.token });
ok("the company sees them waiting", (pend.data.pending || []).length >= 1, JSON.stringify(pend.data).slice(0, 120));
const clId = (await query("SELECT id FROM users WHERE email='cl@w.hu'")).rows[0].id;
await j(`/api/employees/${clId}/approval`, { method: "PUT", token: CO.token, body: { decision: "approved" } });
const CL = await login("cl@w.hu");
ok("approved, the cleaner can log in", !!CL.token);
ok("and starts with an empty job list", ((await j("/api/bookings", { token: CL.token })).data.bookings || []).length === 0);

/* ═══════════════════════════════════════════════════════════════
   JOURNEY 3 — A CUSTOMER BOOKS, PAYS, IS SERVED, REVIEWS
   ═══════════════════════════════════════════════════════════════ */
console.log("\n═══ JOURNEY 3 · Customer: finds the company → books → is cleaned → reviews ═══");
await j("/api/auth/register", { method: "POST", body: { email: "cu@w.hu", password: "secret123", role: "customer", fullName: "Béla Kis", phone: "+36301230002", city: "Debrecen", address: "Kossuth utca 1", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved' WHERE email='cu@w.hu'");
const CU = await login("cu@w.hu");
ok("the customer registers and logs straight in", !!CU.token);

const browse = await j("/api/companies");
const found = (browse.data.companies || []).find((c) => c.id === cid);
ok("the company is visible in the marketplace", !!found);
ok("the customer can see the requirements before choosing", (found.requirements || []).length === 2);
const svcList = await j("/api/services");
ok("and its services", (svcList.data.services || []).some((s) => s.id === svc.id));

const closedDay = await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(3), scheduledSlot: "10:00", address: "Kossuth utca 1" } });
ok("booking on the company's day off is refused", closedDay.status === 400, JSON.stringify(closedDay.data));
const badHour = await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(5), scheduledSlot: "22:00", address: "Kossuth utca 1" } });
ok("booking outside working hours is refused", badHour.status === 400, JSON.stringify(badHour.data));

const bk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(5), scheduledSlot: "10:00", address: "Kossuth utca 1", note: "Ring twice", requirementsAck: true } })).data.booking;
ok("a valid booking is created", !!bk?.id && Number(bk.status) === 0);
ok("the price is 10,000 + 10% fee = 11,000", Number(bk.total_huf) === 11000, String(bk.total_huf));
ok("the acknowledgement of the requirements is recorded", !!bk.requirements_ack_at);
ok("it starts unpaid", bk.payment_status === "unpaid");

const coSeesUnpaid = await j("/api/bookings", { token: CO.token });
ok("an unpaid booking is not yet shown to the company as work", !(coSeesUnpaid.data.bookings || []).some((b) => b.id === bk.id));
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [bk.id]);
const coSeesPaid = await j("/api/bookings", { token: CO.token });
ok("once paid, the company sees it", (coSeesPaid.data.bookings || []).some((b) => b.id === bk.id));
ok("the customer's note came through", (coSeesPaid.data.bookings || []).find((b) => b.id === bk.id)?.note === "Ring twice");

/* ── the same hour is now spent for that service ── */
const clash = await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(5), scheduledSlot: "10:00", address: "Kossuth utca 1" } });
ok("a second booking of the same service at the same hour is refused", clash.status === 400, JSON.stringify(clash.data));
const svcB = (await j("/api/services", { method: "POST", token: CO.token, body: { name: "Laundry", pricingType: "flat", priceHuf: 6000 } })).data.service;
const other = await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svcB.id, scheduledDate: dPlus(5), scheduledSlot: "10:00", address: "Kossuth utca 1" } });
ok("but a different service at that hour is still available", other.status === 201, JSON.stringify(other.data).slice(0, 120));

/* ── the ladder: New → Assigned → On the way → Cleaning → Done ── */
console.log("\n   — the job moves through its five stages —");
const assign = await j(`/api/bookings/${bk.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: clId } });
ok("company assigns the cleaner  (New → Assigned)", assign.status === 200 && Number((await query("SELECT status FROM bookings WHERE id=$1", [bk.id])).rows[0].status) === 1, JSON.stringify(assign.data).slice(0, 100));
const clJobs = await j("/api/bookings", { token: CL.token });
ok("the job appears in the cleaner's list", (clJobs.data.bookings || []).some((b) => b.id === bk.id));
ok("the cleaner is given the address", (clJobs.data.bookings || []).find((b) => b.id === bk.id)?.address === "Kossuth utca 1");

await j(`/api/bookings/${bk.id}/status`, { method: "PUT", token: CL.token, body: { status: 2 } });
ok("cleaner sets off            (Assigned → On the way)", Number((await query("SELECT status FROM bookings WHERE id=$1", [bk.id])).rows[0].status) === 2);
const loc = await j(`/api/bookings/${bk.id}/location`, { method: "PUT", token: CL.token, body: { lat: 47.53, lng: 21.62 } });
ok("live location can be shared while on the way", loc.status === 200, JSON.stringify(loc.data).slice(0, 100));
const custSees = await j(`/api/bookings/${bk.id}/location`, { token: CU.token });
ok("and the customer can watch it", custSees.status === 200 && custSees.data.lat != null, JSON.stringify(custSees.data));

await j(`/api/bookings/${bk.id}/status`, { method: "PUT", token: CL.token, body: { status: 3 } });
ok("cleaning starts             (On the way → Cleaning)", Number((await query("SELECT status FROM bookings WHERE id=$1", [bk.id])).rows[0].status) === 3);
await j(`/api/bookings/${bk.id}/status`, { method: "PUT", token: CL.token, body: { status: 4 } });
const done = (await query("SELECT status FROM bookings WHERE id=$1", [bk.id])).rows[0];
ok("job finished               (Cleaning → Done)", Number(done.status) === 4);

/* ── review, then invoice ── */
console.log("\n   — after the job —");
const early = await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: other.data.booking.id, stars: 5 } });
ok("a job that is not finished cannot be reviewed", early.status === 403, String(early.status));
const rev = await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: bk.id, stars: 5, body: "Spotless, thank you" } });
ok("the finished job can be reviewed", rev.status === 201, JSON.stringify(rev.data).slice(0, 100));
ok("a second review of the same job is refused", (await j("/api/reviews", { method: "POST", token: CU.token, body: { bookingId: bk.id, stars: 1 } })).status === 400);
/* The rating is kept up to date by a Postgres trigger, and the in-memory test
   database cannot run triggers — so assert the review landed and that the trigger
   which maintains the rating is actually defined, including the guard that keeps
   removed reviews out of the average. */
const reviewRow = (await query("SELECT stars, company_id FROM reviews ORDER BY created_at DESC LIMIT 1")).rows[0];
ok("the review is stored against the right company", Number(reviewRow.stars) === 5 && reviewRow.company_id === cid);
const schema = (await import("fs")).readFileSync("schema.sql", "utf8");
const lastTrigger = schema.slice(schema.lastIndexOf("FUNCTION refresh_company_rating()"));
ok("the rating trigger exists and ignores removed reviews",
   /review_count = \(SELECT COUNT/.test(lastTrigger) && /removed_at IS NULL/.test(lastTrigger));

const noInvoiceYet = await j(`/api/invoices/${bk.id}`, { token: CU.token });
ok("the customer sees no invoice until the company issues one", !noInvoiceYet.data.partner);
const outstanding = await j("/api/invoices/company/outstanding", { token: CO.token });
ok("the company is reminded it still owes an invoice", (outstanding.data.bookings || []).some((b) => b.id === bk.id));
await j(`/api/invoices/${bk.id}/partner`, { method: "POST", token: CO.token, body: { invoiceNumber: "WALK-2026-1", issuedAt: dPlus(0), pdf: "data:application/pdf;base64,SGk=" } });
const nowInvoiced = await j(`/api/invoices/${bk.id}`, { token: CU.token });
ok("once uploaded the customer can see it", nowInvoiced.data.partner?.number === "WALK-2026-1");
ok("and it drops off the company's outstanding list",
   !((await j("/api/invoices/company/outstanding", { token: CO.token })).data.bookings || []).some((b) => b.id === bk.id));

/* ═══════════════════════════════════════════════════════════════
   JOURNEY 4 — THINGS GOING WRONG
   ═══════════════════════════════════════════════════════════════ */
console.log("\n═══ JOURNEY 4 · When it does not go to plan ═══");
const bk2 = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(6), scheduledSlot: "11:00", address: "Kossuth utca 1" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [bk2.id]);
const decline = await j(`/api/bookings/${bk2.id}/status`, { method: "PUT", token: CO.token, body: { status: 8, declineReason: "Fully booked that morning" } });
ok("a company can decline with a reason", decline.status === 200, JSON.stringify(decline.data).slice(0, 100));
const declined = (await query("SELECT status, decline_reason FROM bookings WHERE id=$1", [bk2.id])).rows[0];
ok("the booking is marked declined and the reason kept", Number(declined.status) === 8 && /Fully booked/.test(declined.decline_reason || ""));
ok("the declined hour is free again",
   (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(6), scheduledSlot: "11:00", address: "Kossuth utca 1" } })).status === 201);

const bk3 = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(7), scheduledSlot: "12:00", address: "Kossuth utca 1" } })).data.booking;
const cancel = await j(`/api/bookings/${bk3.id}/status`, { method: "PUT", token: CU.token, body: { status: 9 } });
ok("a customer can cancel their own booking", cancel.status === 200, JSON.stringify(cancel.data).slice(0, 100));

const bk4 = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(8), scheduledSlot: "13:00", address: "Kossuth utca 1" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid', created_at = NOW() - INTERVAL '30 hours' WHERE id=$1", [bk4.id]);
const { sweepUnaccepted } = await import("../server/lib/reminders.js");
await sweepUnaccepted();
ok("a booking nobody accepted is auto-cancelled rather than left hanging",
   Number((await query("SELECT status FROM bookings WHERE id=$1", [bk4.id])).rows[0].status) === 9);

const complaint = await j("/api/complaints", { method: "POST", token: CU.token, body: { subject: "Cleaner was late", body: "Arrived 40 minutes after the slot", bookingId: bk.id } });
ok("a customer can raise a complaint", complaint.status === 201 || complaint.status === 200, JSON.stringify(complaint.data).slice(0, 100));
ok("the admin sees it", ((await j("/api/complaints", { token: CEO.token })).data.complaints || []).length >= 1);

/* ═══════════════════════════════════════════════════════════════
   JOURNEY 5 — THE ADMIN'S DAY
   ═══════════════════════════════════════════════════════════════ */
console.log("\n═══ JOURNEY 5 · Admin: moderation, targeting, oversight ═══");
const revId = (await query("SELECT id FROM reviews ORDER BY created_at DESC LIMIT 1")).rows[0].id;
await j(`/api/reviews/${revId}/report`, { method: "POST", token: CO.token, body: { reason: "Not a genuine customer" } });
ok("the company can report a review", ((await j("/api/reviews/reported", { token: CEO.token })).data.reviews || []).length === 1);
await j(`/api/reviews/${revId}/dismiss`, { method: "POST", token: CEO.token });
ok("the admin can dismiss the report and keep the review", ((await j("/api/reviews/reported", { token: CEO.token })).data.reviews || []).length === 0);

const count = await j("/api/notifications/broadcast", { method: "POST", token: CEO.token, body: { title: "Hello Debrecen", city: "Debrecen", preview: true } });
ok("the admin sees the recipient count before sending", typeof count.data.count === "number" && count.data.count >= 1, JSON.stringify(count.data));
const sent = await j("/api/notifications/broadcast", { method: "POST", token: CEO.token, body: { title: "Hello Debrecen", city: "Debrecen" } });
ok("and the announcement goes only to that city", sent.data.count === count.data.count);
const full = await j(`/api/admin/users/${CU.user.id}/full`, { token: CEO.token });
ok("the admin can open a customer's whole record", full.data.user?.email === "cu@w.hu" && Array.isArray(full.data.bookings));
ok("with their bookings and reviews attached", full.data.bookings.length >= 1 && Array.isArray(full.data.reviews));
const health = await j("/api/invoices/admin/health", { token: CEO.token });
ok("and can see where invoicing is incomplete platform-wide", Array.isArray(health.data.awaitingPartnerInvoice));


console.log("\n═══ JOURNEY 6 · Timing, and reporting a customer ═══");
/* The real clock, not the slot that was booked. */
const timed = (await query("SELECT enroute_at, started_at, finished_at FROM bookings WHERE id = $1", [bk.id])).rows[0];
ok("the moment the cleaner set off is recorded", !!timed.enroute_at, JSON.stringify(timed));
ok("the moment work started is recorded", !!timed.started_at);
ok("the moment work finished is recorded", !!timed.finished_at);
ok("start comes before finish", new Date(timed.started_at) <= new Date(timed.finished_at));
const adminSeesTimes = await j(`/api/admin/users/${CU.user.id}/full`, { token: CEO.token });
const timedRow = (adminSeesTimes.data.bookings || []).find((x) => x.id === bk.id);
ok("the admin can see those times on the customer's record", !!timedRow?.started_at, JSON.stringify(timedRow?.started_at));
const coSeesTimes = await j("/api/bookings", { token: CO.token });
ok("and so can the company on its own job", !!(coSeesTimes.data.bookings || []).find((x) => x.id === bk.id)?.started_at);

/* A company reports a customer. */
const tooShort = await j("/api/customer-reports", { method: "POST", token: CO.token, body: { bookingId: bk.id, category: "abusive", detail: "bad" } });
ok("a one-word report is refused", tooShort.status === 400, JSON.stringify(tooShort.data));
const badCat = await j("/api/customer-reports", { method: "POST", token: CO.token, body: { bookingId: bk.id, category: "nonsense", detail: "Something happened here" } });
ok("an unknown category is refused", badCat.status === 400);
const rep = await j("/api/customer-reports", { method: "POST", token: CO.token, body: { bookingId: bk.id, category: "abusive", detail: "Shouted at our cleaner and refused to let her leave." } });
ok("a company can report a customer it worked for", rep.status === 201, JSON.stringify(rep.data).slice(0, 120));
ok("the same booking cannot be reported twice",
   (await j("/api/customer-reports", { method: "POST", token: CO.token, body: { bookingId: bk.id, category: "other", detail: "Trying to report this again" } })).status === 400);

/* The customer must never learn of it. */
const custBookings = await j("/api/bookings", { token: CU.token });
ok("the report does not appear anywhere in the customer's own data", !JSON.stringify(custBookings.data).toLowerCase().includes("shouted"));
ok("a customer cannot read the report queue", (await j("/api/customer-reports", { token: CU.token })).status === 403);
ok("a customer cannot file one either", (await j("/api/customer-reports", { method: "POST", token: CU.token, body: { bookingId: bk.id, category: "other", detail: "I am reporting myself" } })).status === 403);

/* Another company cannot report someone else's customer. */
await j("/api/auth/register", { method: "POST", body: { email: "rival@w.hu", password: "secret123", role: "company", fullName: "Rival", companyName: "Rival Co", taxId: "12345676-1-02", regNumber: "09-09-999999", city: "Debrecen", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved' WHERE email='rival@w.hu'");
await query("UPDATE companies SET is_approved=true, is_listed=true WHERE name='Rival Co'");
const RIVAL = await login("rival@w.hu");
ok("a company cannot report a customer it never served",
   (await j("/api/customer-reports", { method: "POST", token: RIVAL.token, body: { bookingId: bk.id, category: "abusive", detail: "Not my customer at all" } })).status === 404);

/* The admin handles it. */
const queue = await j("/api/customer-reports", { token: CEO.token });
ok("the admin sees it in the queue", (queue.data.reports || []).some((r) => r.id === rep.data.report.id));
ok("with a count of how many reports exist about that person", Number((queue.data.reports || [])[0]?.reports_about_them) >= 1);
ok("a decision needs a note", (await j(`/api/customer-reports/${rep.data.report.id}/handle`, { method: "POST", token: CEO.token, body: { decision: "reviewed", note: "" } })).status === 400);
const handled = await j(`/api/customer-reports/${rep.data.report.id}/handle`, { method: "POST", token: CEO.token, body: { decision: "reviewed", note: "Called the customer and warned them" } });
ok("the admin can record a decision", handled.status === 200, JSON.stringify(handled.data));
ok("and it is written to the audit log",
   (await query("SELECT COUNT(*)::int n FROM admin_log WHERE action LIKE 'customer_report%'")).rows[0].n >= 1);
ok("a company cannot close its own report", (await j(`/api/customer-reports/${rep.data.report.id}/handle`, { method: "POST", token: CO.token, body: { decision: "dismissed", note: "never mind" } })).status === 403);
const mine = await j("/api/customer-reports/mine", { token: CO.token });
ok("the company can see what it reported, and the outcome", (mine.data.reports || []).some((r) => r.status === "reviewed"));


console.log("\n═══ JOURNEY 7 · Who may see what in a review ═══");
/* The company sees who wrote it and which cleaner earned it. */
const coRevs = await j("/api/reviews/company", { token: CO.token });
const myRev = (coRevs.data.reviews || [])[0];
ok("the company sees the review", !!myRev, JSON.stringify(coRevs.data).slice(0, 120));
ok("it names the customer who wrote it", myRev.customer_name === "Béla Kis", String(myRev.customer_name));
ok("and the cleaner who earned it", myRev.cleaner_name === "Anna Nagy", String(myRev.cleaner_name));
ok("the company gets a per-cleaner breakdown", Array.isArray(coRevs.data.cleaners) && coRevs.data.cleaners.length >= 1);
ok("with an average per cleaner", coRevs.data.cleaners[0].average != null, JSON.stringify(coRevs.data.cleaners[0]));
ok("and its own headline rating, the one customers see",
   coRevs.data.company && coRevs.data.company.reviewCount != null, JSON.stringify(coRevs.data.company));

/* The customer sees a review OF THE COMPANY — never which cleaner. */
const publicRevs = await j("/api/reviews");
const pub = (publicRevs.data.reviews || []).find((r) => r.company_id === cid);
ok("the review is public", !!pub);
ok("the public review never names the cleaner",
   !JSON.stringify(publicRevs.data).includes("Anna Nagy"), "a customer must not learn who cleaned for someone else");
ok("nor exposes a cleaner id", pub.cleaner_id === undefined && pub.assigned_to === undefined, JSON.stringify(Object.keys(pub)));
ok("nor the raw customer id", pub.customer_id === undefined, JSON.stringify(Object.keys(pub)));
ok("nor the reason a company gave when reporting", pub.reported_reason === undefined && pub.removed_reason === undefined);
ok("but it does show the company it belongs to", !!pub.company_id);

/* Only the admin may remove one. */
const rId = myRev.id;
ok("a company cannot delete a review about itself",
   (await j(`/api/reviews/${rId}/remove`, { method: "POST", token: CO.token, body: { reason: "I do not like it" } })).status === 403);
ok("a customer cannot delete one either",
   (await j(`/api/reviews/${rId}/remove`, { method: "POST", token: CU.token, body: { reason: "changed my mind" } })).status === 403);
ok("a cleaner cannot delete the review they earned",
   (await j(`/api/reviews/${rId}/remove`, { method: "POST", token: CL.token, body: { reason: "unfair" } })).status === 403);
const adminRemove = await j(`/api/reviews/${rId}/remove`, { method: "POST", token: CEO.token, body: { reason: "Test removal — abusive language" } });
ok("only the admin can remove it", adminRemove.status === 200, JSON.stringify(adminRemove.data));
ok("and it disappears from the public list",
   !((await j("/api/reviews")).data.reviews || []).some((r) => r.id === rId));
ok("and from the company's own list",
   !((await j("/api/reviews/company", { token: CO.token })).data.reviews || []).some((r) => r.id === rId));


/* ═══════════════════════════════════════════════════════════════════════════
   THE ACCEPTANCE CLOCK

   A paid booking sitting unaccepted is auto-cancelled and refunded. The company
   had no way to see that clock, so paid work could evaporate on a deadline
   nobody had told them about. The deadline is now sent with the booking — and
   the same function drives the sweep, so what is shown and what is enforced
   cannot drift apart.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\n── the company can see what needs them ──");
const rem = await import("../server/lib/reminders.js");

const far = rem.acceptDeadline({ created_at: new Date().toISOString(), scheduled_date: dPlus(30), scheduled_slot: "10:00" });
const hoursOut = (far ? Date.parse(far) - Date.now() : 0) / 3600e3;
ok("a job far off gives the company the full response window",
   Math.abs(hoursOut - Number(process.env.ACCEPT_TIMEOUT_H || 12)) < 0.2, String(hoursOut));

/* This used to assert that a job starting within 12 hours had its deadline
   pulled back to "12h before it starts" — which for anything booked at short
   notice was a moment already in the past. The sweep then cancelled and
   refunded it before the partner's phone had finished buzzing, and short-notice
   work could never be accepted by anyone.

   The rule now: the company always gets a real window, and it never outlives
   the job itself. */
const minH = Number(process.env.ACCEPT_MIN_H || 3);
const soon = rem.acceptDeadline({ created_at: new Date().toISOString(), scheduled_date: dPlus(1), scheduled_slot: "10:00" });
const soonH = (Date.parse(soon) - Date.now()) / 3600e3;
ok("a job at short notice still leaves time to accept it",
   soon && soonH >= minH - 0.2, `${soonH.toFixed(1)}h — must be at least ${minH}h`);
/* No comparison between `soon` and `far` here: both are derived from separate
   Date.now() calls a few statements apart, so at millisecond precision the
   result depends on how fast the machine got between two lines. It failed by
   exactly 1ms. A test that can lose on timing is noise, not evidence. */
/* Starting in one hour: the window shrinks to the job, and no further. */
const hourAway = new Date(Date.now() + 60 * 60e3);
const pad = (n) => String(n).padStart(2, "0");
const imminent = rem.acceptDeadline({ created_at: new Date().toISOString(),
  scheduled_date: `${hourAway.getFullYear()}-${pad(hourAway.getMonth() + 1)}-${pad(hourAway.getDate())}`,
  scheduled_slot: `${pad(hourAway.getHours())}:00` });
ok("a deadline never outlives the job it belongs to",
   imminent && Date.parse(imminent) <= hourAway.getTime() + 60e3, imminent);
ok("an unparseable booking never invents a deadline",
   rem.acceptDeadline({ created_at: "nonsense", scheduled_date: null, scheduled_slot: null }) === null);

const wBk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(25), scheduledSlot: "09:00", address: "Fő tér 1" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [wBk.id]);
const coList = (await j("/api/bookings", { token: CO.token })).data.bookings || [];
const coRow = coList.find((b) => b.id === wBk.id);
ok("the company is told when an unaccepted booking expires", !!coRow?.accept_deadline, JSON.stringify(coRow?.accept_deadline));

const cuRow = ((await j("/api/bookings", { token: CU.token })).data.bookings || []).find((b) => b.id === wBk.id);
ok("the customer is not shown a clock on somebody else's obligation", cuRow && cuRow.accept_deadline === undefined);

await j(`/api/bookings/${wBk.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
const afterAccept = ((await j("/api/bookings", { token: CO.token })).data.bookings || []).find((b) => b.id === wBk.id);
ok("once accepted the countdown disappears", afterAccept && afterAccept.accept_deadline === undefined,
   JSON.stringify(afterAccept?.accept_deadline));

/* The whole point of exporting it: one rule, two consumers. */
const remSrc = (await import("fs")).readFileSync("server/lib/reminders.js", "utf8");
ok("the auto-cancel sweep enforces the very deadline it displays", /now >= Date\.parse\(deadline\)/.test(remSrc));

const appSrc = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the company screen groups what needs them", /const needsAttention = attention\.length/.test(appSrc));
ok("including jobs starting soon with nobody assigned", /unassignedSoon/.test(appSrc));
ok("and jobs that should already have started", /const overdue = open\.filter/.test(appSrc));
ok("the filter chips are translated, not hard-coded English", !/label: `All \(\$\{open\.length\}\)`/.test(appSrc));

console.log(`\n════ WORKFLOWS: ${pass} passed, ${fail} failed  (${step} steps walked) ════`);
process.exit(fail ? 1 : 0);
