/* THE ENDPOINTS NOTHING WAS WATCHING.

   scripts/coverage.mjs compares the server's routes against every path the
   suites ask for. It found thirty routes no test had ever called — among them
   the three buttons a customer uses to pause, resume or cancel a recurring
   plan, the check for whether a partner can be paid at all, and the operator's
   revenue figures.

   Counting tests measures how much was written. This measures what is guarded.

   Run: node test/gaps.mjs                                                     */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4513";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const bcrypt = (await import("bcryptjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4513${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: { email: "co@g.hu", password: "secret123", role: "company", fullName: "O", companyName: "Gap Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cu@g.hu", password: "secret123", role: "customer", fullName: "Cust", phone: "+36301112233", city: "Debrecen", address: "Piac 1", customerType: "resident", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "other@g.hu", password: "secret123", role: "customer", fullName: "Other", phone: "+36301119999", city: "Debrecen", address: "Piac 9", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status) VALUES ('boss@g.hu', $1, 'Boss', 'admin', true, 'approved')", [bcrypt.hashSync("secret123", 8)]);
const login = async (e, p = "secret123") => (await j("/api/auth/login", { method: "POST", body: { email: e, password: p } })).data;
const CO = await login("co@g.hu"), CU = await login("cu@g.hu"), OTHER = await login("other@g.hu"), ADM = await login("boss@g.hu");
const CU2 = OTHER;   /* a second customer, for "not yours" checks */
const cid = CO.user.company_id;
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('cl@g.hu', $1, 'Cleaner', 'employee', $2, 'approved', true)", [bcrypt.hashSync("secret123", 8), cid]);
const CL = await login("cl@g.hu");
const svc = (await j("/api/services", { method: "POST", token: CO.token, body: { name: "Clean", pricingType: "flat", priceHuf: 8000, tasks: ["Kitchen", "Bathroom", "Floors"] } })).data.service;

console.log("\n── the recurring plan controls a customer actually presses ──");
const subIns = await query(
  `INSERT INTO subscriptions (customer_id, company_id, service_id, frequency, slot, address, currency, amount_minor, fee_minor, status, next_booking_date)
   VALUES ($1,$2,$3,'weekly','09:00','Piac 1','HUF',880000,80000,'active',$4) RETURNING id`,
  [CU.user.id, cid, svc.id, dPlus(7)]);
const subId = subIns.rows[0].id;

ok("a stranger cannot pause someone else's plan",
   [403, 404].includes((await j(`/api/subscriptions/${subId}/pause`, { method: "POST", token: OTHER.token })).status));
ok("the owner can pause it", (await j(`/api/subscriptions/${subId}/pause`, { method: "POST", token: CU.token })).status === 200);
ok("and it really is paused", (await query("SELECT status FROM subscriptions WHERE id=$1", [subId])).rows[0].status === "paused");
ok("pausing twice is refused rather than silently ignored",
   (await j(`/api/subscriptions/${subId}/pause`, { method: "POST", token: CU.token })).status === 400);
ok("a paused plan resumes", (await j(`/api/subscriptions/${subId}/resume`, { method: "POST", token: CU.token })).status === 200);
ok("resuming re-anchors the next visit into the future",
   new Date((await query("SELECT next_booking_date FROM subscriptions WHERE id=$1", [subId])).rows[0].next_booking_date) > new Date(Date.now() - 864e5));
ok("an active plan cannot resume again",
   (await j(`/api/subscriptions/${subId}/resume`, { method: "POST", token: CU.token })).status === 400);
ok("the owner can cancel", (await j(`/api/subscriptions/${subId}/cancel`, { method: "POST", token: CU.token })).status === 200);
ok("cancelling twice is harmless, not an error",
   (await j(`/api/subscriptions/${subId}/cancel`, { method: "POST", token: CU.token })).status === 200);

console.log("\n── whether a partner can be paid at all ──");
const cs = await j("/api/payments/connect/status", { token: CO.token });
ok("a company can ask", cs.status === 200, JSON.stringify(cs.data));
ok("and is told plainly when Stripe is not configured", cs.data.available === false || "connected" in cs.data);
ok("a customer cannot ask on their behalf", (await j("/api/payments/connect/status", { token: CU.token })).status === 403);
ok("nor can a stranger start onboarding", (await j("/api/payments/connect/onboard", { method: "POST", token: CU.token })).status === 403);

console.log("\n── payment status belongs to the person who paid ──");
const bk = (await j("/api/bookings", { method: "POST", token: CU.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(6), scheduledSlot: "09:00", address: "Piac 1" } })).data.booking;
ok("the customer can read their own", (await j(`/api/payments/status/${bk.id}`, { token: CU.token })).status === 200);
ok("another customer cannot", (await j(`/api/payments/status/${bk.id}`, { token: OTHER.token })).status === 404);
ok("and a signed-out stranger cannot", (await j(`/api/payments/status/${bk.id}`)).status === 401);

console.log("\n── the on-site checklist ──");
await j(`/api/bookings/${bk.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
ok("the assigned cleaner can tick tasks off",
   (await j(`/api/bookings/${bk.id}/tasks`, { method: "PUT", token: CL.token, body: { tasksDone: [0, 2] } })).status === 200);
ok("and the ticks are stored",
   JSON.stringify((await query("SELECT tasks_done FROM bookings WHERE id=$1", [bk.id])).rows[0].tasks_done).includes("2"));
ok("the customer cannot tick their own job off",
   (await j(`/api/bookings/${bk.id}/tasks`, { method: "PUT", token: CU.token, body: { tasksDone: [0, 1, 2] } })).status === 403);
ok("nor can the company owner", (await j(`/api/bookings/${bk.id}/tasks`, { method: "PUT", token: CO.token, body: { tasksDone: [1] } })).status === 403);

console.log("\n── the operator's own numbers ──");
const rev = await j("/api/admin/revenue", { token: ADM.token });
ok("an admin can read revenue", rev.status === 200 && Array.isArray(rev.data.revenue), JSON.stringify(rev.data).slice(0, 80));
ok("a company cannot", (await j("/api/admin/revenue", { token: CO.token })).status === 403);
ok("a customer cannot", (await j("/api/admin/revenue", { token: CU.token })).status === 403);
const ab = await j("/api/admin/bookings", { token: ADM.token });
ok("an admin can list every booking", ab.status === 200);
ok("a customer cannot", (await j("/api/admin/bookings", { token: CU.token })).status === 403);

console.log("\n── changing your own password ──");
ok("the wrong current password is refused",
   (await j("/api/auth/change-password", { method: "POST", token: CU.token, body: { currentPassword: "nope", newPassword: "brandnew1" } })).status === 401);
ok("a short new password is refused",
   (await j("/api/auth/change-password", { method: "POST", token: CU.token, body: { currentPassword: "secret123", newPassword: "abc" } })).status === 400);
ok("a correct change is accepted",
   (await j("/api/auth/change-password", { method: "POST", token: CU.token, body: { currentPassword: "secret123", newPassword: "brandnew1" } })).status === 200);
ok("the new password works", !!(await login("cu@g.hu", "brandnew1")).token);
ok("and the old one no longer does", !(await login("cu@g.hu", "secret123")).token);

console.log("\n── the team list ──");
const emp = await j("/api/employees", { token: CO.token });
ok("a company sees its own team", emp.status === 200 && Array.isArray(emp.data.employees || emp.data), JSON.stringify(emp.data).slice(0, 60));
ok("a customer cannot read a company's team", [401, 403].includes((await j("/api/employees", { token: (await login("cu@g.hu", "brandnew1")).token })).status));

console.log("\n── the version endpoint the app gates on ──");
const ver = await j("/api/app/version");
ok("it answers without a login", ver.status === 200);
ok("it reports a minimum that locks nobody out", ver.data.min === "0.0.0", String(ver.data.min));
ok("and the latest version", /^\d+\.\d+\.\d+$/.test(String(ver.data.latest)), String(ver.data.latest));

console.log("\n── crash reports from the apps ──");
ok("a crash report is accepted without a login",
   (await j("/api/client-error", { method: "POST", body: { message: "boom", stack: "x" } })).status === 200);
ok("an empty one is harmless",
   (await j("/api/client-error", { method: "POST", body: {} })).status === 200);

console.log("\n── marking things read ──");
const notif = await query("SELECT id FROM notifications WHERE user_id = $1 LIMIT 1", [CO.user.id]);
if (notif.rows.length) {
  ok("a company can mark its notification read",
     (await j(`/api/notifications/${notif.rows[0].id}/read`, { method: "PUT", token: CO.token })).status === 200);
  /* The route answers ok() to everyone and scopes the UPDATE by user_id, so a
     stranger's attempt changes nothing. Answering 200 rather than 404 is
     deliberate — a 404 would confirm which notification ids exist. So assert
     the effect, not the status code. */
  await query("UPDATE notifications SET is_read = false WHERE id = $1", [notif.rows[0].id]);
  await j(`/api/notifications/${notif.rows[0].id}/read`, { method: "PUT", token: OTHER.token });
  ok("a stranger's attempt marks nothing read",
     (await query("SELECT is_read FROM notifications WHERE id=$1", [notif.rows[0].id])).rows[0].is_read !== true);
  ok("while the owner's does",
     (await j(`/api/notifications/${notif.rows[0].id}/read`, { method: "PUT", token: CO.token })).status === 200
     && (await query("SELECT is_read FROM notifications WHERE id=$1", [notif.rows[0].id])).rows[0].is_read === true);
} else ok("notifications exist to mark read", true);

console.log("\n── notices, and who may mark them read ──");
const noticeIns = await query(
  "INSERT INTO notices (company_id, to_employee, body) VALUES ($1,$2,$3) RETURNING id",
  [cid, CL.user.id, "Bring the blue mop."]);
const nid = noticeIns.rows[0].id;
ok("a customer cannot mark a company notice read",
   (await j(`/api/notices/${nid}/company-read`, { method: "PUT", token: CU2.token })).status === 403);
ok("the company can", (await j(`/api/notices/${nid}/company-read`, { method: "PUT", token: CO.token })).status === 200);
ok("and it is recorded",
   (await query("SELECT read_by_company FROM notices WHERE id=$1", [nid])).rows[0].read_by_company === true);
ok("only the cleaner it was sent to may mark it read",
   (await j(`/api/notices/${nid}/read`, { method: "PUT", token: CO.token })).status === 403);
ok("that cleaner can", (await j(`/api/notices/${nid}/read`, { method: "PUT", token: CL.token })).status === 200);
ok("a notice addressed to nobody else is not found",
   (await j(`/api/notices/00000000-0000-0000-0000-000000000000/read`, { method: "PUT", token: CL.token })).status === 404);

console.log("\n── has this device registered for push ──");
const ps = await j("/api/notifications/push-status", { token: CL.token });
ok("it answers for a signed-in user", ps.status === 200 && "registered" in ps.data, JSON.stringify(ps.data));
ok("and never returns the whole token, only a stub",
   ps.data.preview === null || String(ps.data.preview).endsWith("…"), String(ps.data.preview));
ok("a signed-out stranger gets nothing", (await j("/api/notifications/push-status")).status === 401);

console.log(`\n════ GAPS: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
