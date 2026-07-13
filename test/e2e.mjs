/* Cleanly end-to-end API test — runs the real server against in-memory Postgres.
   Usage: npm run test:e2e */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "e2e-test-secret";
process.env.PORT = "3399";

const BASE = "http://localhost:3399";
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
};
const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 600));
const { query } = await import("../server/db.js");

console.log("\n── health & config ──");
ok("health endpoint", (await j("/api/health")).data.ok === true);
ok("payments config (card disabled without keys)", (await j("/api/payments/config")).data.cardEnabled === false);

console.log("\n── registration (with residence + city) ──");
const DOC = [{ name: "card.jpg", type: "image/jpeg", data: "data:image/jpeg;base64,x" }];
const noDoc = await j("/api/auth/register", { method: "POST", body: { email: "nodoc@test.hu", password: "secret123", role: "customer", fullName: "No Doc", customerType: "student", address: "X utca 1", phone: "+36301110000" } });
ok("student without card photo rejected", noDoc.status === 400);
const studReg = await j("/api/auth/register", { method: "POST", body: { email: "anna@test.hu", password: "secret123", role: "customer", fullName: "Anna Teszt", customerType: "student", address: "Piac utca 1, Debrecen", phone: "+36301112222", documents: DOC } });
ok("student registration goes to pending (no session)", studReg.status === 201 && studReg.data.pendingApproval === true && !studReg.data.token, JSON.stringify(studReg.data));
const blocked = await j("/api/auth/login", { method: "POST", body: { email: "anna@test.hu", password: "secret123" } });
ok("pending student cannot log in", blocked.status === 403);
const dupPhone = await j("/api/auth/register", { method: "POST", body: { email: "other@test.hu", password: "secret123", role: "customer", fullName: "Other", customerType: "resident", address: "Y utca 2", phone: "+36 30 111 2222" } });
ok("duplicate phone number blocked (one number = one account)", dupPhone.status === 400, JSON.stringify(dupPhone.data));
ok("verification engine dormant without Twilio", (await j("/api/verify/config")).data.enabled === false);

const badTax = await j("/api/auth/register", { method: "POST", body: { email: "bad@spark.hu", password: "secret123", role: "company", fullName: "Bad Tax", companyName: "Bad Kft.", taxId: "12345678-1-42", city: "Budapest" } });
ok("invalid tax number rejected (checksum)", badTax.status === 400);
const coReg = await j("/api/auth/register", { method: "POST", body: { email: "boss@spark.hu", password: "secret123", role: "company", fullName: "Béla Boss", companyName: "SparkClean Kft.", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Budapest" } });
ok("company registration goes to pending", coReg.status === 201 && coReg.data.pendingApproval === true, JSON.stringify(coReg.data));
const coBlocked = await j("/api/auth/login", { method: "POST", body: { email: "boss@spark.hu", password: "secret123" } });
ok("unapproved company cannot log in", coBlocked.status === 403);
const coIdRow = await query("SELECT company_id FROM users WHERE email = 'boss@spark.hu'");
const coId = coIdRow.rows[0].company_id;

console.log("\n── company approval gate ──");
let list = await j("/api/companies");
ok("unapproved company hidden from marketplace", !list.data.companies?.some((c) => c.id === coId));
ok("public list has no documents/tax leak", !list.data.companies?.some((c) => "documents" in c || "tax_id" in c));

// admin: create directly, then approve company
await query("INSERT INTO users (email, password_hash, role, full_name, is_super) VALUES ('root@cleanly.hu', 'x', 'admin', 'Root', true)");
const adminLoginFail = await j("/api/auth/login", { method: "POST", body: { email: "root@cleanly.hu", password: "wrong" } });
ok("bad admin password rejected", adminLoginFail.status !== 200);
// set a real hash via bcrypt through register-less path: use bcryptjs
const bcrypt = (await import("bcryptjs")).default;
await query("UPDATE users SET password_hash = $1 WHERE email = 'root@cleanly.hu'", [await bcrypt.hash("adminpass123", 10)]);
const admin = await j("/api/auth/login", { method: "POST", body: { email: "root@cleanly.hu", password: "adminpass123" } });
ok("admin logs in", admin.status === 200 && !!admin.data.token);
const admTok = admin.data.token;

const pendingUser = await query("SELECT id FROM users WHERE email = 'anna@test.hu'");
const approveStud = await j(`/api/admin/users/${pendingUser.rows[0].id}`, { method: "PUT", token: admTok, body: { approvalStatus: "approved" } });
ok("admin approves student", approveStud.data.user?.approval_status === "approved");
const cust = await j("/api/auth/login", { method: "POST", body: { email: "anna@test.hu", password: "secret123" } });
ok("approved student logs in", cust.status === 200 && !!cust.data.token);
const custTok = cust.data.token;

const approve = await j(`/api/admin/companies/${coId}`, { method: "PUT", token: admTok, body: { isApproved: true } });
ok("admin approves company", approve.status === 200, JSON.stringify(approve.data));
const coLogin = await j("/api/auth/login", { method: "POST", body: { email: "boss@spark.hu", password: "secret123" } });
ok("approved company can log in", coLogin.status === 200 && !!coLogin.data.token);
const coTok = coLogin.data.token;

// ── admin tiers ──
const limited = await query("SELECT id FROM users WHERE email = 'anna@test.hu'");
await j(`/api/admin/users/${limited.rows[0].id}`, { method: "PUT", token: admTok, body: { makeAdmin: true } });
const limLogin = await j("/api/auth/login", { method: "POST", body: { email: "anna@test.hu", password: "secret123" } });
const limTok = limLogin.data.token;
const limCos = await j("/api/admin/companies", { token: limTok });
const ceoCos = await j("/api/admin/companies", { token: admTok });
ok("limited admin NOT blocked from company review (same access as CEO)", limCos.status !== 403 && limCos.status === ceoCos.status, `lim ${limCos.status} ceo ${ceoCos.status}`);
ok("limited admin blocked from users API", (await j("/api/admin/users", { token: limTok })).status === 403);
ok("limited admin blocked from stats", (await j("/api/admin/stats", { token: limTok })).status === 403);
await j(`/api/admin/users/${limited.rows[0].id}`, { method: "PUT", token: admTok, body: { makeAdmin: false } });
list = await j("/api/companies");
ok("approved company visible with city", list.data.companies?.some((c) => c.id === coId && c.city === "Budapest"));

console.log("\n── services & booking (server-side pricing) ──");
const svc = await j("/api/services", { method: "POST", token: coTok, body: { name: "Standard clean", description: "test", priceHuf: 20000, minutes: 120, pricingType: "flat", tasks: ["Floors"] } });
ok("company creates service", svc.status === 201, JSON.stringify(svc.data));
const svcId = svc.data.service?.id;

const bk = await j("/api/bookings", { method: "POST", token: custTok, body: { companyId: coId, serviceId: svcId, scheduledDate: "2026-07-20", scheduledSlot: "09:30", address: "Piac utca 1, Debrecen", hours: null } });
ok("customer books", bk.status === 201, JSON.stringify(bk.data));
ok("student discount + 10% fee on top (20000 → 18000 + 1800 = 19800)", bk.data.booking?.total_huf === 19800 && bk.data.booking?.service_fee_huf === 1800, `got ${bk.data.booking?.total_huf} fee ${bk.data.booking?.service_fee_huf}`);
const bkId = bk.data.booking?.id;

console.log("\n── subscription lifecycle ──");
const sub = await j("/api/services", { method: "POST", token: coTok, body: { name: "Weekly plan", description: "sub", priceHuf: 12000, minutes: 90, pricingType: "subscription", period: "weekly" } });
const subSvcId = sub.data.service?.id;
const sb = await j("/api/bookings", { method: "POST", token: custTok, body: { companyId: coId, serviceId: subSvcId, scheduledDate: "2026-07-21", scheduledSlot: "11:00", address: "Piac utca 1, Debrecen" } });
ok("subscription booked", sb.status === 201);
const dup = await j("/api/bookings", { method: "POST", token: custTok, body: { companyId: coId, serviceId: subSvcId, scheduledDate: "2026-07-28", scheduledSlot: "11:00", address: "Piac utca 1, Debrecen" } });
ok("duplicate active subscription blocked", dup.status === 400, JSON.stringify(dup.data));

const done = await j(`/api/bookings/${sb.data.booking.id}/status`, { method: "PUT", token: coTok, body: { status: 4 } });
ok("completing visit auto-schedules next (weekly +7d)", done.data.next?.scheduled_date?.slice?.(0, 10) === "2026-07-28" || String(done.data.next?.scheduled_date).startsWith("2026-07-28"), JSON.stringify(done.data.next?.scheduled_date));
const again = await j(`/api/bookings/${sb.data.booking.id}/status`, { method: "PUT", token: coTok, body: { status: 4 } });
ok("re-completing does NOT duplicate next visit", again.data.next === null);

console.log("\n── complaints ──");
const comp = await j("/api/complaints", { method: "POST", token: custTok, body: { bookingId: bkId, subject: "Test complaint", body: "details" } });
ok("customer files complaint", comp.status === 201);
const compList = await j("/api/complaints", { token: admTok });
ok("admin sees complaints", compList.data.complaints?.length >= 1);
const resd = await j(`/api/complaints/${comp.data.complaint.id}`, { method: "PUT", token: admTok, body: { status: "resolved", resolution: "sorted" } });
ok("admin resolves complaint", resd.data.complaint?.status === "resolved");
const foreign = await j(`/api/complaints/${comp.data.complaint.id}`, { method: "PUT", token: custTok, body: { status: "resolved" } });
ok("customer cannot resolve complaints", foreign.status === 403);

console.log("\n── admin access control ──");
const self = await j(`/api/admin/users/${admin.data.user.id}`, { method: "PUT", token: admTok, body: { makeAdmin: false } });
ok("admin cannot demote self", self.status === 400);
const promote = await j(`/api/admin/users/${cust.data.user.id}`, { method: "PUT", token: admTok, body: { makeAdmin: true } });
ok("admin promotes customer to admin", promote.data.user?.role === "admin");
const demote = await j(`/api/admin/users/${cust.data.user.id}`, { method: "PUT", token: admTok, body: { makeAdmin: false } });
ok("and revokes it", demote.data.user?.role === "customer");
const notAdmin = await j("/api/admin/users", { token: custTok });
ok("non-admin blocked from admin API", notAdmin.status === 403);

console.log("\n── account deletion (GDPR) ──");
const del = await j("/api/auth/me", { method: "DELETE", token: custTok });
ok("account deletion succeeds", del.data.ok === true);
const anon = await query("SELECT email, full_name, is_active FROM users WHERE id = $1", [cust.data.user.id]);
ok("personal data anonymised", anon.rows[0].full_name === "Deleted user" && anon.rows[0].is_active === false && anon.rows[0].email.startsWith("deleted-"));
const reuse = await j("/api/auth/register", { method: "POST", body: { email: "reuse@test.hu", password: "secret123", role: "customer", fullName: "Reuse", customerType: "resident", address: "Z utca 3", phone: "+36301112222" } });
ok("phone becomes reusable after account deletion", reuse.status === 201, JSON.stringify(reuse.data));

console.log(`\n════ RESULT: ${passed} passed, ${failed} failed ════`);
process.exit(failed ? 1 : 0);
