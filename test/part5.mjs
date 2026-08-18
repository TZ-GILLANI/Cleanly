/* UPDATE 1 · PART 5 — the ten product fixes, proved against a real database.
   Run: node test/part5.mjs                                                    */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4492";
process.env.REQUIRE_SIGNUP_VERIFY = "0";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.message || e); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);


const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4492${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/* ── cast ── */
await j("/api/auth/register", { method: "POST", body: { email: "co@s.hu", password: "secret123", role: "company", fullName: "Owner", companyName: "P5 Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cust@s.hu", password: "secret123", role: "customer", fullName: "Cust One", phone: "+36301112233", city: "Debrecen", address: "Kossuth u 1", customerType: "resident", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cust2@s.hu", password: "secret123", role: "customer", fullName: "Cust Two", phone: "+36301112244", city: "Szeged", address: "Fő tér 2", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
await query("UPDATE users SET country='HU'");
await query("UPDATE users SET city='Debrecen' WHERE email='co@s.hu'");
await query("UPDATE users SET city='Debrecen' WHERE email='cust@s.hu'");
await query("UPDATE users SET city='Szeged' WHERE email='cust2@s.hu'");

const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "co@s.hu", password: "secret123" } })).data;
const cuTok = (await j("/api/auth/login", { method: "POST", body: { email: "cust@s.hu", password: "secret123" } })).data;
const cid = coTok.user.company_id;

/* an admin with CEO powers, made directly so we don't depend on the grant flow */
await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status, terms_accepted_at) VALUES ('boss@s.hu', $1, 'Boss', 'admin', true, 'approved', NOW())",
  [(await import("bcryptjs")).default.hashSync("secret123", 8)]);
const adminTok = (await j("/api/auth/login", { method: "POST", body: { email: "boss@s.hu", password: "secret123" } })).data.token;

console.log("\n── 5.4 requirements: company sets them, customer must acknowledge ──");
const putReq = await j("/api/companies/" + cid, { method: "PUT", token: coTok.token, body: { name: "P5 Co", requirements: ["Parking space", "Hot water"] } });
ok("requirements persist on the company", JSON.stringify(putReq.data.company?.requirements) === '["Parking space","Hot water"]', JSON.stringify(putReq.data.company?.requirements));
const pubCo = await j("/api/companies/" + cid);
ok("customers can see them before booking", Array.isArray(pubCo.data.company?.requirements) && pubCo.data.company.requirements.length === 2);

const svc = await j("/api/services", { method: "POST", token: coTok.token, body: { name: "Deep clean", pricingType: "flat", priceHuf: 12000, durationMin: 120 } });
const svcId = svc.data.service?.id;
ok("service created for the booking tests", !!svcId, JSON.stringify(svc.data).slice(0, 120));

const bk = await j("/api/bookings", { method: "POST", token: cuTok.token, body: { companyId: cid, serviceId: svcId, scheduledDate: dPlus(30), scheduledSlot: "10:00", address: "Kossuth u 1", requirementsAck: true } });
ok("booking stores the acknowledgement timestamp", !!bk.data.booking?.requirements_ack_at, String(bk.data.booking?.requirements_ack_at));
const bkNo = await j("/api/bookings", { method: "POST", token: cuTok.token, body: { companyId: cid, serviceId: svcId, scheduledDate: dPlus(31), scheduledSlot: "10:00", address: "Kossuth u 1" } });
ok("no tick, no timestamp — we never fake consent", bkNo.data.booking?.requirements_ack_at === null, String(bkNo.data.booking?.requirements_ack_at));

console.log("\n── 5.5 targeted announcements ──");
const preview = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Hi", preview: true } });
ok("preview returns a count and sends nothing", typeof preview.data.count === "number" && preview.data.count >= 3, JSON.stringify(preview.data));
const before = (await query("SELECT COUNT(*)::int n FROM notifications WHERE type='announcement'")).rows[0].n;
ok("preview really sent nothing", before === 0, String(before));

const byCity = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Hi", city: "Szeged", preview: true } });
ok("city filter narrows to one person", byCity.data.count === 1, JSON.stringify(byCity.data));
const byRole = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Hi", audience: "company", preview: true } });
ok("role filter narrows to the company", byRole.data.count === 1, JSON.stringify(byRole.data));
const byPerson = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Hi", userId: cuTok.user.id, preview: true } });
ok("single-person filter matches exactly one", byPerson.data.count === 1, JSON.stringify(byPerson.data));
const byCountry = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Hi", country: "DE", preview: true } });
ok("a country with nobody in it counts zero", byCountry.data.count === 0, JSON.stringify(byCountry.data));

const sendReal = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Szeged only", body: "Hello", city: "Szeged" } });
ok("targeted send reports its count", sendReal.data.count === 1, JSON.stringify(sendReal.data));
const got = await query("SELECT u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type='announcement'");
ok("only the targeted user got it", got.rows.length === 1 && got.rows[0].email === "cust2@s.hu", JSON.stringify(got.rows));
const logged = await query("SELECT action, detail FROM admin_log WHERE action = 'broadcast.send'");
ok("the send is written to the audit log", logged.rows.length === 1 && logged.rows[0].detail.includes("recipients=1"), JSON.stringify(logged.rows));
const emptyAud = await j("/api/notifications/broadcast", { method: "POST", token: adminTok, body: { title: "Nobody", country: "DE" } });
ok("refuses to send to an empty audience", emptyAud.status === 400, String(emptyAud.status));
const notAdmin = await j("/api/notifications/broadcast", { method: "POST", token: cuTok.token, body: { title: "Hack" } });
ok("a customer cannot broadcast", notAdmin.status === 403, String(notAdmin.status));

console.log("\n── 5.9 review moderation ──");
const bId = bk.data.booking.id;
await query("UPDATE bookings SET status = 4 WHERE id = $1", [bId]);
const rev = await j("/api/reviews", { method: "POST", token: cuTok.token, body: { bookingId: bId, stars: 1, body: "you are all idiots" } });
const revId = rev.data.review?.id;
ok("review created", !!revId, JSON.stringify(rev.data).slice(0, 140));

const shortReason = await j(`/api/reviews/${revId}/report`, { method: "POST", token: coTok.token, body: { reason: "bad" } });
ok("a one-word report is rejected", shortReason.status === 400, String(shortReason.status));
const report = await j(`/api/reviews/${revId}/report`, { method: "POST", token: coTok.token, body: { reason: "abusive language, not about our work" } });
ok("company can report a review", report.status === 200, JSON.stringify(report.data));
const queue = await j("/api/reviews/reported", { token: adminTok });
ok("it lands in the admin queue with rating + comment", queue.data.reviews?.length === 1 && queue.data.reviews[0].rating === 1 && !!queue.data.reviews[0].comment, JSON.stringify(queue.data.reviews));
ok("the queue shows the company's reason", (queue.data.reviews?.[0]?.reported_reason || "").includes("abusive"), JSON.stringify(queue.data.reviews?.[0]?.reported_reason));
const stillPublic = await j("/api/reviews");
ok("a merely reported review is still public", (stillPublic.data.reviews || []).some((r) => r.id === revId));

const dismissed = await j(`/api/reviews/${revId}/dismiss`, { method: "POST", token: adminTok });
ok("admin can dismiss the report", dismissed.status === 200);
ok("the flag is cleared", (await j("/api/reviews/reported", { token: adminTok })).data.reviews.length === 0);
const afterDismiss = await j("/api/reviews");
ok("the review survives a dismissal", (afterDismiss.data.reviews || []).some((r) => r.id === revId));

await j(`/api/reviews/${revId}/report`, { method: "POST", token: coTok.token, body: { reason: "abusive language again" } });
const noReason = await j(`/api/reviews/${revId}/remove`, { method: "POST", token: adminTok, body: { reason: "" } });
ok("removal without a reason is refused", noReason.status === 400, String(noReason.status));
const removed = await j(`/api/reviews/${revId}/remove`, { method: "POST", token: adminTok, body: { reason: "personal abuse, breaks the rules" } });
ok("admin can remove it with a reason", removed.status === 200, JSON.stringify(removed.data));
const gone = await j("/api/reviews");
ok("it disappears from the public list", !(gone.data.reviews || []).some((r) => r.id === revId));
const coView = await j("/api/reviews/company", { token: coTok.token });
ok("and from the company's own list", !(coView.data.reviews || []).some((r) => r.id === revId));
const removeLog = await query("SELECT detail FROM admin_log WHERE action = 'review.remove'");
ok("the removal is logged with the reason", removeLog.rows.length === 1 && removeLog.rows[0].detail.includes("breaks the rules"), JSON.stringify(removeLog.rows));
const rating = await query("SELECT rating, review_count FROM companies WHERE id = $1", [cid]);
ok("the company's rating is recomputed without it", Number(rating.rows[0].review_count) === 0, JSON.stringify(rating.rows[0]));
const coRemove = await j(`/api/reviews/${revId}/remove`, { method: "POST", token: coTok.token, body: { reason: "I dislike it" } });
ok("a company cannot remove its own bad reviews", coRemove.status === 403, String(coRemove.status));

console.log("\n── 5.10 admin sees the whole record ──");
const full = await j(`/api/admin/users/${cuTok.user.id}/full`, { token: adminTok });
ok("account block returned", full.data.user?.email === "cust@s.hu", JSON.stringify(full.data.user).slice(0, 120));
ok("bookings included, with order numbers", full.data.bookings?.length === 2 && full.data.bookings[0].order_no != null, JSON.stringify(full.data.bookings?.[0]).slice(0, 120));
ok("reviews included", Array.isArray(full.data.reviews) && full.data.reviews.length === 1);
ok("complaints query does not blow up", Array.isArray(full.data.complaints), JSON.stringify(full.data.complaints));
ok("no password hash leaks", !JSON.stringify(full.data).includes("password_hash"));
const fullCo = await j(`/api/admin/users/${coTok.user.id}/full`, { token: adminTok });
ok("a company owner's company is attached", fullCo.data.company?.id === cid, JSON.stringify(fullCo.data.company).slice(0, 120));
ok("company block carries the editable fields", "tax_id" in (fullCo.data.company || {}) && "service_radius_km" in (fullCo.data.company || {}));
const custPeek = await j(`/api/admin/users/${coTok.user.id}/full`, { token: cuTok.token });
ok("a customer cannot read someone's record", custPeek.status === 403, String(custPeek.status));

console.log("\n── 5.11 admin edits company details, safely and on the record ──");
const edit = await j(`/api/admin/companies/${cid}/details`, { method: "PUT", token: adminTok, body: { name: "P5 Co Renamed", city: "Szeged", tax_id: "99999999-1-02", service_radius_km: 25 } });
ok("edit accepted", edit.status === 200, JSON.stringify(edit.data).slice(0, 140));
const after = (await query("SELECT name, city, tax_id, service_radius_km FROM companies WHERE id = $1", [cid])).rows[0];
ok("the change actually landed", after.name === "P5 Co Renamed" && after.city === "Szeged" && Number(after.service_radius_km) === 25, JSON.stringify(after));
const editLog = await query("SELECT detail FROM admin_log WHERE action LIKE 'company%' ORDER BY created_at DESC LIMIT 1");
ok("before → after is in the audit log", editLog.rows.length === 1 && editLog.rows[0].detail.includes("P5 Co Renamed"), JSON.stringify(editLog.rows));
const ratingBefore = Number((await query("SELECT rating FROM companies WHERE id = $1", [cid])).rows[0].rating);
const sneaky = await j(`/api/admin/companies/${cid}/details`, { method: "PUT", token: adminTok, body: { stripe_account_id: "acct_evil", password_hash: "x", rating: 1.2, student_discount: 99 } });
const unchanged = (await query("SELECT stripe_account_id, rating, student_discount FROM companies WHERE id = $1", [cid])).rows[0];
ok("the payout account cannot be rewritten by an admin", !unchanged.stripe_account_id, JSON.stringify(unchanged));
ok("the rating cannot be hand-edited", Number(unchanged.rating) === ratingBefore, `${unchanged.rating} vs ${ratingBefore}`);
const coEdit = await j(`/api/admin/companies/${cid}/details`, { method: "PUT", token: coTok.token, body: { name: "Nope" } });
ok("a company cannot use the admin edit route", coEdit.status === 403, String(coEdit.status));

console.log("\n── 5.7 deleted customers are not leaked to companies ──");
await j("/api/auth/register", { method: "POST", body: { email: "gone@s.hu", password: "secret123", role: "customer", fullName: "Ghost Person", phone: "+36301119999", city: "Debrecen", address: "X 1", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved' WHERE email='gone@s.hu'");
const ghost = (await j("/api/auth/login", { method: "POST", body: { email: "gone@s.hu", password: "secret123" } })).data;
const ghostBk = await j("/api/bookings", { method: "POST", token: ghost.token, body: { companyId: cid, serviceId: svcId, scheduledDate: dPlus(60), scheduledSlot: "09:00", address: "X 1" } });
await query("UPDATE bookings SET payment_status = 'paid', status = 4 WHERE id = $1", [ghostBk.data.booking.id]);
const del = await j("/api/auth/me", { method: "DELETE", token: ghost.token });
ok("the account deletes cleanly", del.status === 200, JSON.stringify(del.data));
const coBookings = await j("/api/bookings", { token: coTok.token });
const dOf = (x) => String(x).slice(0, 10);
const ghostRow = (coBookings.data.bookings || []).find((b) => dOf(b.scheduled_date) === dPlus(60));
ok("the company still sees the job", !!ghostRow, JSON.stringify(coBookings.data.bookings?.length));
ok("but not the deleted person's name", ghostRow && ghostRow.customer_name === "Cleano customer", String(ghostRow?.customer_name));
ok("and not their email", !JSON.stringify(coBookings.data).includes("gone@s.hu"));

ok("an unpaid, abandoned booking is not shown to the company as work",
   !(coBookings.data.bookings || []).some((b) => String(b.scheduled_date).slice(0, 10) === dPlus(31)));

console.log("\n── 5.8 a booking cannot hang unanswered forever ──");
const { sweepUnaccepted } = await import("../server/lib/reminders.js");
ok("the sweeper is exported and callable", typeof sweepUnaccepted === "function");
const soon = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const hang = await j("/api/bookings", { method: "POST", token: cuTok.token, body: { companyId: cid, serviceId: svcId, scheduledDate: soon, scheduledSlot: "23:00", address: "Kossuth u 1" } });
await query("UPDATE bookings SET payment_status = 'paid' WHERE id = $1", [hang.data.booking.id]);
await query("UPDATE bookings SET created_at = NOW() - INTERVAL '30 hours' WHERE id = $1", [hang.data.booking.id]);
await sweepUnaccepted();
const swept = (await query("SELECT status FROM bookings WHERE id = $1", [hang.data.booking.id])).rows[0];
ok("an ignored booking is auto-cancelled, not left in limbo", Number(swept.status) === 9, JSON.stringify(swept));
const accepted = await query("SELECT status FROM bookings WHERE id = $1", [bId]);
ok("an accepted booking is left alone", Number(accepted.rows[0].status) === 4, JSON.stringify(accepted.rows[0]));


console.log("\n── the notice, per service ──");
/* The company has one notice for everything it does. A service can add its own,
   because "leave the laundry bag outside the door" belongs to the laundry, not
   to the company. The column existed from the start and nothing ever wrote to
   it: the route ignored the field, the store's whitelist dropped it, and the
   booking screen read svc.requirements nine lines above svc was declared —
   which threw the moment anyone tapped a company. */
const reqSvc = (await j("/api/services", { method: "POST", token: coTok.token, body: {
  name: "Laundry", pricingType: "flat", priceHuf: 6000,
  requirements: ["  Leave the bag outside the door  ", "", "No dry-clean-only items"] } })).data.service;
ok("a service stores its own notice", Array.isArray(reqSvc.requirements) && reqSvc.requirements.length === 2, JSON.stringify(reqSvc.requirements));
ok("blank lines are dropped and the rest trimmed", reqSvc.requirements[0] === "Leave the bag outside the door", JSON.stringify(reqSvc.requirements[0]));

const many = (await j("/api/services", { method: "POST", token: coTok.token, body: {
  name: "Wordy", pricingType: "flat", priceHuf: 6000,
  requirements: Array.from({ length: 20 }, (_, i) => "rule " + i) } })).data.service;
ok("the list is capped so it cannot fill the booking screen", many.requirements.length === 8, String(many.requirements.length));
const longOne = (await j("/api/services", { method: "POST", token: coTok.token, body: {
  name: "Long", pricingType: "flat", priceHuf: 6000, requirements: ["x".repeat(400)] } })).data.service;
ok("and each line is capped", longOne.requirements[0].length === 140, String(longOne.requirements[0].length));

const upd = (await j(`/api/services/${reqSvc.id}`, { method: "PUT", token: coTok.token, body: { requirements: ["Only one rule now"] } })).data.service;
ok("editing replaces the list", upd.requirements.length === 1 && upd.requirements[0] === "Only one rule now", JSON.stringify(upd.requirements));
const untouched = (await j(`/api/services/${reqSvc.id}`, { method: "PUT", token: coTok.token, body: { name: "Renamed" } })).data.service;
ok("an edit that does not mention it leaves it alone", untouched.requirements.length === 1, JSON.stringify(untouched.requirements));
const cleared = (await j(`/api/services/${reqSvc.id}`, { method: "PUT", token: coTok.token, body: { requirements: [] } })).data.service;
ok("but an empty list really does clear it", Array.isArray(cleared.requirements) && cleared.requirements.length === 0, JSON.stringify(cleared.requirements));

const appSrcR = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the booking screen merges the company's notice with the service's",
   /Array\.isArray\(company\?\.requirements\)[\s\S]{0,200}Array\.isArray\(svc\?\.requirements\)/.test(appSrcR));
ok("and reads svc only after it is declared",
   appSrcR.indexOf("const [svc, setSvc] = useState(null)") < appSrcR.indexOf("Array.isArray(svc?.requirements)"));
ok("the store actually sends the field", /requirements: svc\.requirements/.test((await import("fs")).readFileSync("src/store.jsx", "utf8")));
ok("and the company has somewhere to type it", /f\.reqText/.test(appSrcR));

console.log(`\n════ PART 5: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
