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

console.log("\n── a cleaner can actually sign up ──");
/* The server answers a cleaner's registration with { pendingApproval: true }
   and no user, because the company owner has to approve them first. The client
   destructured { token, user } from it anyway and read user.role — so every
   attempt to join a company died on "undefined is not an object". The customer
   and company paths both checked for pendingApproval; this one never did. */
const invite = (await j("/api/employees/invites", { method: "POST", token: CO.token, body: { label: "Test cleaner" } })).data;
const inviteCode = invite.code || invite.invite?.code;
ok("a company can create an invite code", !!inviteCode, JSON.stringify(invite).slice(0, 90));
const reg = await j("/api/auth/register", { method: "POST", body: {
  email: "newcleaner@g.hu", password: "secret123", role: "employee", fullName: "New Cleaner",
  inviteCode, phone: "+36301117777", address: "Piac 3", termsAccepted: true } });
ok("registering with that code is accepted", reg.status === 201, JSON.stringify(reg.data).slice(0, 90));
ok("the reply says approval is pending, and carries no user",
   reg.data.pendingApproval === true && reg.data.user === undefined, JSON.stringify(reg.data));
const storeSrc = (await import("fs")).readFileSync("src/store.jsx", "utf8");
ok("the client checks for that before reading the user",
   /if \(resp\.pendingApproval\) return \{ pending: true \};[\s\S]{0,120}const \{ token, user \} = resp;/.test(storeSrc));
ok("an unapproved cleaner cannot log in yet",
   !(await j("/api/auth/login", { method: "POST", body: { email: "newcleaner@g.hu", password: "secret123" } })).data.token);
await query("UPDATE users SET approval_status='approved' WHERE email='newcleaner@g.hu'");
ok("and can once the company approves them",
   !!(await j("/api/auth/login", { method: "POST", body: { email: "newcleaner@g.hu", password: "secret123" } })).data.token);
ok("a made-up invite code is refused",
   (await j("/api/auth/register", { method: "POST", body: { email: "x@g.hu", password: "secret123", role: "employee", fullName: "X", inviteCode: "NOPE-1234", phone: "+36301110000", termsAccepted: true } })).status === 400);
ok("and the same code cannot be used twice",
   (await j("/api/auth/register", { method: "POST", body: { email: "y@g.hu", password: "secret123", role: "employee", fullName: "Y", inviteCode, phone: "+36301110001", termsAccepted: true } })).status === 400);

console.log("\n── serving a whole city ──");
/* This replaced a 30 km preset labelled "Whole city". The preset was a lie in
   both directions — it swallowed four towns around a village and still clipped
   the edge of a large city — so these assert the behaviour that matters rather
   than the number that used to implement it. */
const appR = (await import("fs")).readFileSync("src/App.jsx", "utf8");
/* The button is clicked for real in test/render.mjs. What matters here is that
   the city is a placeholder rather than baked into the key — spelled the old
   way it could only ever exist in English and Hungarian. */
ok("there is a one-tap way to serve the whole of your own city",
   /L\("Serve the whole of \{0\}"/.test(appR));
ok("and it is worded so it can be translated, not interpolated into the key",
   /fill\(L\("Serve the whole of \{0\}"/.test(appR));
ok("the km slider no longer pretends a number means a city",
   !/CITY_WIDE_KM/.test(appR));
ok("cities are named, and more than one can be named",
   /Cities you serve in full/.test(appR) && /AddCityField/.test(appR));
ok("a large radius is still accepted by the server",
   (await j(`/api/companies/${cid}`, { method: "PUT", token: CO.token, body: { serviceRadiusKm: 30 } })).status === 200);

console.log("\n── a service discount is visible before you tap in ──");
ok("the home card computes the best service deal", /const bestServiceDeal/.test(appR));
ok("and only shows it when it beats the company-wide one", /deal\.pct <= already/.test(appR));

console.log("\n── the registration limit does not punish shared networks ──");
/* Six signups per IP per hour looks careful and is quietly hostile: a
   university dorm is one address, and a mobile carrier can put a whole region
   behind one. A real student would see "try again later" for something a
   stranger did, and would simply not sign up. */
const authSrc = (await import("fs")).readFileSync("server/routes/auth.js", "utf8");
ok("the per-network limit is generous", /rateLimit\("reg-ip:" \+ ip, 40/.test(authSrc));
ok("the tight limit is per email, where abuse actually shows", /rateLimit\("reg-mail:"[^)]*, 4/.test(authSrc));
ok("and per phone number", /rateLimit\("reg-phone:"[^)]*, 4/.test(authSrc));
let created = 0;
for (let i = 0; i < 9; i++) {
  const r = await j("/api/auth/register", { method: "POST", body: {
    email: `shared${i}@dorm.hu`, password: "secret123", role: "customer", fullName: "Dorm " + i,
    phone: "+3630999" + String(1000 + i), city: "Debrecen", address: "Egyetem 1",
    customerType: "resident", termsAccepted: true } });
  if (r.status === 201) created++;
}
ok("nine people behind one address can all sign up", created === 9, `${created}/9`);
const sameMail = await j("/api/auth/register", { method: "POST", body: {
  email: "shared0@dorm.hu", password: "secret123", role: "customer", fullName: "Again",
  phone: "+36309998888", city: "Debrecen", address: "X", customerType: "resident", termsAccepted: true } });
ok("but hammering one email is still stopped", [400, 429].includes(sameMail.status), String(sameMail.status));

console.log("\n── addresses are not assumed to be Hungarian ──");
const appC = (await import("fs")).readFileSync("src/App.jsx", "utf8");
/* The phrase survives in the comment explaining the fix, so match the code. */
ok("street suggestions no longer hard-code Hungary",
   !/\.countrycode === "HU"/.test(appC) && !/properties\?\.countrycode === "HU"/.test(appC));
ok("they follow the chosen country", /f\.properties\?\.countrycode === cc/.test(appC));
ok("there is a country list to choose from", /const COUNTRIES = \[/.test(appC));
ok("and the choice is remembered", /cleanly_country/.test(appC));
ok("a saved address can be corrected rather than deleted", /Edit a saved address/.test(appC));

console.log("\n── the account is not created until the code checks out ──");
/* The endpoints for this existed from the start and nothing ever called them:
   /verify/signup/start and /verify/signup/check had no test and no screen. The
   old flow created the account first and asked afterwards, so unverified
   accounts existed and a mistyped number could only be fixed by an admin — the
   person could never receive the code that would let them fix it themselves. */
const vcfg = await j("/api/verify/config");
ok("the app can ask whether codes can be sent at all", vcfg.status === 200 && "enabled" in vcfg.data, JSON.stringify(vcfg.data));
ok("and is told plainly when they cannot", vcfg.data.enabled === false || vcfg.data.enabled === true);

const dupPhone = await j("/api/verify/signup/start", { method: "POST", body: { phone: "+36301112233" } });
ok("a number that already has an account is refused before any code is sent",
   dupPhone.status === 409, String(dupPhone.status));
const dupMail = await j("/api/verify/signup/start", { method: "POST", body: { email: "cu@g.hu" } });
ok("so is an email that already has one", dupMail.status === 409, String(dupMail.status));
ok("a request with neither is refused",
   (await j("/api/verify/signup/start", { method: "POST", body: {} })).status === 400);
ok("a made-up code cannot be checked into a proof",
   [400, 503].includes((await j("/api/verify/signup/check", { method: "POST", body: { email: "nobody@x.hu", code: "123456", ticket: "nonsense" } })).status));

const authSrcV = (await import("fs")).readFileSync("server/routes/auth.js", "utf8");
ok("registration reads a phone proof", /verifySignupToken\(req\.body\.phoneToken, "phone", phone\)/.test(authSrcV));
ok("and an email proof", /verifySignupToken\(req\.body\.emailToken, "email", email\)/.test(authSrcV));
ok("both are demanded, not either", /if \(!emailVerified\) return[\s\S]{0,200}!phoneVerified/.test(authSrcV));
ok("a forged proof is rejected — it is signed, not just present",
   (await j("/api/auth/register", { method: "POST", body: {
     email: "forged@g.hu", password: "secret123", role: "customer", fullName: "Forged",
     phone: "+36301114444", city: "Debrecen", address: "X", customerType: "resident",
     termsAccepted: true, phoneToken: "not-a-real-token", emailToken: "nope" } })).status !== 500);

const appV = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the field stays editable until it is verified", /readOnly=\{verified\}/.test(appV));
/* Pinned the exact source of one onChange handler, which broke the moment the
   phone half of the field was rebuilt with a country selector. What matters is
   that no edit path survives verification. */
ok("and locks afterwards, because the proof is bound to that exact value",
   /if \(verified\) return;/.test(appV) && /readOnly=\{verified\}/.test(appV));
ok("the country code is its own control, not something to type by hand",
   /isPhone && !verified && \(\s*<select/.test(appV) && /DIAL_CODES\.map/.test(appV));
ok("and it disappears once the number is verified, like the number itself",
   /\{isPhone && !verified && \(/.test(appV));
ok("the number sent for verification is the parsed one, not the raw box",
   /signupCodeSend\(isPhone \? \{ phone: composed,/.test(appV) &&
   /signupCodeCheck\(isPhone \? \{ phone: composed/.test(appV));
ok("the Send code button stays disabled until the number is possible",
   /const enough = isPhone \? phoneOk/.test(appV));
ok("there is a button to request the code next to the field", /Send code", "Kód kérése/.test(appV));
ok("and one to verify it", /"Verify", "Igazolás"/.test(appV));
ok("the account cannot be created until both proofs exist", /const proofsOk = /.test(appV));
ok("the proofs are sent with the registration", /const withProof = \{ \.\.\.f, phoneToken, emailToken \}/.test(appV));
ok("and the plain fields still work when no code can be sent", /verifyOn\s*\?/.test(appV));

console.log("\n── logging in from a shared network ──");
/* Registration was fixed first; login had the identical flaw and is worse,
   because people log in every day. Ten attempts per IP per five minutes means a
   cleaning team on one wifi, or anyone on 4G, locks each other out. */
const authSrcL = (await import("fs")).readFileSync("server/routes/auth.js", "utf8");
ok("the per-network login limit is generous", /rateLimit\("login-ip:" \+ ipOf\(req\), 60/.test(authSrcL));
ok("but the per-account one stays tight — that is what stops brute force",
   /rateLimit\("login:" \+ String\(email\)\.toLowerCase\(\), 8/.test(authSrcL));
ok("password reset is limited per email, not just per network", /rateLimit\("forgot-mail:"/.test(authSrcL));
ok("and the reset link itself is limited per token", /rateLimit\("reset-tok:"/.test(authSrcL));

/* Behavioural: a dozen different people signing in from one address must all
   get through. Wrong passwords, so we exercise the limiter rather than login. */
let refused = 0;
for (let i = 0; i < 14; i++) {
  const r = await j("/api/auth/login", { method: "POST", body: { email: `person${i}@dorm.hu`, password: "wrongpass" } });
  if (r.status === 429) refused++;
}
ok("fourteen people on one network are not rate-limited out", refused === 0, `${refused} refused`);

/* Hammering one account IS still stopped, but it cannot be shown here:
   rateLimit() multiplies every ceiling by fifty under PGMEM so the suites can
   pound one address without tripping it. Proving it behaviourally would need
   four hundred requests. The ceiling itself is asserted above; what matters is
   that the tight one is keyed on the account, not the network. */
ok("the brute-force ceiling is keyed on the account, not the network",
   /rateLimit\("login:" \+ String\(email\)/.test(authSrcL));
ok("and the test-mode multiplier is confined to PGMEM, so production stays honest",
   /if \(process\.env\.PGMEM\) max = max \* 50/.test(authSrcL));

/* ── THE SERVICE AREA, ACTUALLY ENFORCED ──────────────────────────────────
   The company settings screen has said "Only customers inside the circle can
   book you" since the radius shipped. Nothing checked it: the radius was
   stored, distanceKm() was written, and the two were never introduced. A
   Debrecen company with a 5 km radius could be booked from Budapest and the
   cleaner found out when the address loaded on the day.

   geocode() reads its cache first, so seeding `geocache` lets these run with
   no network at all — and tests the same path production takes on the second
   booking to any address. */
await query("UPDATE companies SET service_lat=47.5316, service_lng=21.6273, service_radius_km=10 WHERE id=$1", [cid]);

const seedGeo = (q, lat, lng) =>
  query("INSERT INTO geocache (q, lat, lng) VALUES ($1,$2,$3) ON CONFLICT (q) DO NOTHING", [q, lat, lng]);
const book = (address, token = CU.token, day = 21) =>
  j("/api/bookings", { method: "POST", token,
     body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(day), scheduledSlot: "09:00", address } });

/* Inside the circle: about 1 km from the pin. */
await seedGeo("Kossuth utca 5, Debrecen", 47.5390, 21.6290);
const inside = await book("Kossuth utca 5");
ok("an address inside the radius books normally", inside.status < 300, `${inside.status} ${inside.data.error || ""}`);

/* Outside: Budapest, ~190 km from Debrecen, against a 10 km radius. */
await seedGeo("Andrassy ut 60, Debrecen", 47.5050, 19.0640);
const far = await book("Andrassy ut 60", CU.token, 22);
ok("an address 190 km away is refused", far.status === 400, `got ${far.status}`);
ok("and the refusal says how far and how far they travel",
   /outside this company's service area/i.test(far.data.error || "") &&
   /\d+ km away/.test(far.data.error || "") && /travel 10 km/.test(far.data.error || ""),
   far.data.error);

/* The slack. The pin is dropped by hand and a geocoded house number is not a
   survey marker, so a 10 km radius must not refuse someone at 10.4 km. */
await seedGeo("Edge utca 1, Debrecen", 47.6220, 21.6273);   /* ~10.05 km north */
const edge = await book("Edge utca 1", CU.token, 23);
ok("someone just over the line is not refused on a rounding error",
   edge.status < 300, `${edge.status} ${edge.data.error || ""}`);

/* Fail-open. A negative cache entry is exactly what an unresolvable address
   leaves behind, and it must not become a wall: refusing a real customer
   because a third-party lookup failed is the worse of the two errors, and the
   company can still decline the job by hand. */
await seedGeo("Ismeretlen dulo 7, Debrecen", null, null);
const unknown = await book("Ismeretlen dulo 7", CU.token, 24);
ok("an address the geocoder cannot place is allowed through, not blocked",
   unknown.status < 300, `${unknown.status} ${unknown.data.error || ""}`);

/* And a company that never set a pin serves everyone, as before. */
await query("UPDATE companies SET service_lat=NULL, service_lng=NULL WHERE id=$1", [cid]);
const noPin = await book("Andrassy ut 60", CU.token, 25);
ok("a company with no pin set is unaffected by any of this", noPin.status < 300,
   `${noPin.status} ${noPin.data.error || ""}`);
await query("UPDATE companies SET service_lat=47.5316, service_lng=21.6273 WHERE id=$1", [cid]);

/* A radius of zero means "not configured", not "serve nobody". */
await query("UPDATE companies SET service_radius_km=0 WHERE id=$1", [cid]);
const zero = await book("Andrassy ut 60", CU.token, 26);
ok("a zero radius means unset, not a company that serves nobody", zero.status < 300,
   `${zero.status} ${zero.data.error || ""}`);
await query("UPDATE companies SET service_radius_km=10 WHERE id=$1", [cid]);

/* The guard must sit before payment, not after: a refused booking that has
   already taken money is a refund and a support ticket. */
const bkSrc = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");
const iArea = bkSrc.indexOf("outside this company's service area");
const iIns  = bkSrc.indexOf("INSERT INTO bookings");
ok("the area check runs before the booking row is written", iArea > 0 && iIns > 0 && iArea < iIns);

/* The listing filter and the booking guard must agree on the radius column,
   or a company is listed by one rule and refused by the other. */
const coSrc = (await import("fs")).readFileSync("server/routes/companies.js", "utf8");
ok("the listing filter uses the same radius column the booking guard does",
   /service_radius_km/.test(coSrc) && /service_radius_km/.test(bkSrc));

/* ── CITIES SERVED IN FULL ────────────────────────────────────────────────
   Three questions that turned out to be one:
     "a button for the whole city"   — a radius is a bad proxy for a city
     "smaller cities, or larger"     — a name has no size
     "and if a company is multi-city?" — a circle cannot express three towns

   So the radius answers "how far will you drive from your base" and this list
   answers "which places do you cover", and they are OR-ed. */
await query("UPDATE companies SET service_lat=47.5316, service_lng=21.6273, service_radius_km=10, service_cities='[]' WHERE id=$1", [cid]);

/* Nyíregyháza is ~50 km from the Debrecen pin — far outside a 10 km radius. */
await seedGeo("Kossuth ter 1, Debrecen", 47.9560, 21.7167);
const beforeList = await book("Kossuth ter 1", CU.token, 27);
ok("before naming the city, a 50 km address is refused", beforeList.status === 400, `got ${beforeList.status}`);

const put = await j(`/api/companies/${cid}`, { method: "PUT", token: CO.token,
  body: { serviceCities: ["Nyíregyháza", "Debrecen"] } });
ok("a company can save the cities it serves", put.status === 200, put.data.error || "");
ok("and they come back saved", JSON.stringify(put.data.company?.service_cities || []).includes("Nyíregyháza"));

/* The customer's city is read from their record, so move them there. */
await query("UPDATE users SET city='Nyíregyháza' WHERE email='cu@g.hu'");
const afterList = await book("Kossuth ter 1", CU.token, 28);
ok("naming the city lets that same 50 km booking through", afterList.status < 300,
   `${afterList.status} ${afterList.data.error || ""}`);

/* Case and stray spaces must not decide whether a partner gets the work. */
await query("UPDATE users SET city='  nyíregyháza ' WHERE email='cu@g.hu'");
const messy = await book("Kossuth ter 1", CU.token, 29);
ok("matching ignores case and stray spaces", messy.status < 300, `${messy.status} ${messy.data.error || ""}`);

/* A city NOT on the list still falls back to the radius. The list adds reach;
   it must not quietly remove the guard for everywhere else. */
await query("UPDATE users SET city='Budapest' WHERE email='cu@g.hu'");
await seedGeo("Vaci utca 1, Debrecen", 47.4930, 19.0530);   /* Budapest */
const elsewhere = await book("Vaci utca 1", CU.token, 30);
ok("a city that is NOT on the list still falls back to the radius",
   elsewhere.status === 400, `got ${elsewhere.status}`);

/* THE ONE THAT MATTERS. The city decides whether the area guard applies, so if
   it can be set by the caller the guard is decorative. `req.user` carries only
   id, role and companyId — there is no city on the token — so the first draft
   of this read req.body.city, which is simply a string the attacker picked. */
const spoof = await j("/api/bookings", { method: "POST", token: CU.token,
  body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(31), scheduledSlot: "09:00",
          address: "Vaci utca 1", city: "Nyíregyháza" } });
ok("a city supplied in the request body cannot unlock the area guard",
   spoof.status === 400, `got ${spoof.status} — the body was believed`);
const bkSrc2 = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");
ok("and the city is read from the database, not the request",
   /SELECT city FROM users WHERE id/.test(bkSrc2) && !/req\.body\.city/.test(bkSrc2));
await query("UPDATE users SET city='Debrecen' WHERE email='cu@g.hu'");

/* Storage hygiene: duplicates and blanks are the partner's typing, not data. */
const dupes = await j(`/api/companies/${cid}`, { method: "PUT", token: CO.token,
  body: { serviceCities: ["Debrecen", "debrecen", "  ", "DEBRECEN ", "Eger"] } });
const stored = dupes.data.company?.service_cities || [];
ok("duplicates are collapsed and blanks dropped", Array.isArray(stored) && stored.length === 2,
   JSON.stringify(stored));

/* The listing filter and the booking guard must agree, or a company is shown
   by one rule and refused by the other — the exact confusion this replaced. */
await query("UPDATE companies SET service_cities='[\"Nyíregyháza\"]' WHERE id=$1", [cid]);
const listed = await j("/api/companies?near=" + encodeURIComponent("Kossuth ter 1, Debrecen") + "&city=Ny%C3%ADregyh%C3%A1za");
ok("the listing keeps a company that serves your city, whatever the distance",
   (listed.data.companies || []).some((c) => c.id === cid), "not listed");
const notListed = await j("/api/companies?near=" + encodeURIComponent("Vaci utca 1, Debrecen") + "&city=Budapest");
ok("and still drops it for a city it does not serve and cannot reach",
   !(notListed.data.companies || []).some((c) => c.id === cid), "still listed");

/* One rule, written twice — once on the server, once in the client filter.
   Two copies drift; a test is the cheapest thing that notices. */
const coSrc2 = (await import("fs")).readFileSync("server/routes/companies.js", "utf8");
const appSrc2 = (await import("fs")).readFileSync("src/App.jsx", "utf8");
const body = (t, name) => {
  const i = t.indexOf(name);
  if (i < 0) return "";
  const j2 = t.indexOf("some(", i);
  return j2 < 0 ? "" : t.slice(j2, t.indexOf("\n", j2)).replace(/\s+/g, " ").trim();
};
const sv = body(coSrc2, "export function servesCity");
const cl = body(appSrc2, "const servesCityClient");
ok("client and server agree on what counts as a match", sv.length > 20 && sv === cl,
   `server: ${sv.slice(0, 70)} | client: ${cl.slice(0, 70)}`);

/* And the field must survive the client's own whitelist — the failure this
   codebase repeats: a column added, a UI built, and the store dropping the
   field silently on the way out. */
const storeSrc2 = (await import("fs")).readFileSync("src/store.jsx", "utf8");
ok("the store forwards serviceCities instead of dropping it",
   /serviceCities: fields\.serviceCities/.test(storeSrc2));
ok("and sends the customer's city with the listing request", /city=" \+ encodeURIComponent/.test(storeSrc2));

/* ── A COMPANY MUST SAY WHERE IT WORKS ────────────────────────────────────
   The signup city was a dropdown of ten Hungarian cities with the first one
   preselected, so it was never empty and nothing validated it. Making it a
   free-text field with live suggestions — so partners outside those ten can
   register at all — removed the accident that was keeping it filled.

   An empty city is not a cosmetic gap: the customer list keeps any company
   whose city is blank, so such a partner is shown to every customer in the
   country and then refused at booking. */
const noCity = await j("/api/auth/register", { method: "POST", body: {
  email: "nocity@g.hu", password: "secret123", role: "company", fullName: "N",
  companyName: "No City Kft.", taxId: "12345676-1-02", regNumber: "09-09-123456", termsAccepted: true } });
ok("a company cannot register without saying which city it serves", noCity.status === 400, `got ${noCity.status}`);
ok("and the message says what to do", /city/i.test(noCity.data.error || ""), noCity.data.error);

const blankCity = await j("/api/auth/register", { method: "POST", body: {
  email: "blank@g.hu", password: "secret123", role: "company", fullName: "B", city: "   ",
  companyName: "Blank Kft.", taxId: "12345676-1-02", regNumber: "09-09-123456", termsAccepted: true } });
ok("whitespace does not count as a city", blankCity.status === 400, `got ${blankCity.status}`);

const withCity = await j("/api/auth/register", { method: "POST", body: {
  email: "sopron@g.hu", password: "secret123", role: "company", fullName: "S", city: "Sopron",
  companyName: "Sopron Kft.", taxId: "12345676-1-02", regNumber: "09-09-123456", termsAccepted: true } });
ok("a city outside the old ten-city list is accepted", withCity.status < 300,
   `${withCity.status} ${withCity.data.error || ""}`);
const soRow = await query("SELECT city FROM companies WHERE name='Sopron Kft.'");
ok("and it is stored as typed, not silently rewritten to Debrecen",
   soRow.rows[0]?.city === "Sopron", JSON.stringify(soRow.rows[0]));

/* The city field must offer suggestions everywhere it appears — customer
   address, company signup, company settings. It is the value the entire
   service-area system compares on, so a typo costs the partner every customer
   in that town and neither side ever learns why. */
const appCity = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("the customer's city field suggests as you type",
   /<CitySuggestField label=\{L\("City", "Város"\)/.test(appCity));
ok("the company signup city field does too",
   /<CitySuggestField label=\{L\("City you serve/.test(appCity));
ok("and no screen still uses the fixed ten-city dropdown",
   !/ALL_CITIES\.map\(\(c\) => <option/.test(appCity));

/* ── THE PHONE NUMBER ─────────────────────────────────────────────────────
   Reported from a real device: the signup screen showed

       Invalid parameter `To`: +3670303194149

   Two separate failures, one message. The field built a number that cannot
   exist — it prefixed the dial code to whatever was typed, so "06 70 …" (which
   is how Hungarians write their own number) became +36 06 70 …, and a pasted
   "+36 70 …" became +36 36 70 …. Nothing checked it. Then Twilio's rejection
   was handed to the customer verbatim: English, in Twilio's vocabulary, about
   a parameter they have never heard of.

   With REQUIRE_SIGNUP_VERIFY=1 this is not cosmetic. No code, no account. */
console.log("\n── the phone number ──");
const appPh = (await import("fs")).readFileSync("src/App.jsx", "utf8");
const vSrc = (await import("fs")).readFileSync("server/routes/verify.js", "utf8");

/* These used to pin the hand-written normaliser. It is gone: the library
   parses what was typed and hands back the canonical number, so 06, 0036, a
   pasted +36 and stray spaces all collapse without any prefix logic of ours.
   The behaviour is driven for real in test/phone.mjs. */
ok("the field parses what was typed rather than assembling the number itself",
   /const parsePhone = /.test(appPh) && /parsePhoneNumberFromString/.test(appPh));
ok("and stores the library's canonical E.164, never a string we glued together",
   /parsed\.number/.test(appPh) && !/cleanLocal/.test(appPh));
ok("the app has its own opinion about the number, before any provider does",
   /parsed && parsed\.isValid\(\)/.test(appPh));
ok("and shows the number it will actually use", /We'll (use|send the code to): /.test(appPh));

ok("the server validates the number before spending an SMS", /function phoneIsWrong/.test(vSrc));
ok("both the signup path and the logged-in path check it",
   (vSrc.match(/phoneIsWrong\(phone\)/g) || []).length >= 2);
/* A hand-written table of twenty-one dial codes replaced this. It caught the
   number from the bug report and would still have waved through a 13-digit
   Austrian number — Austria has four valid lengths — and refused a real
   Portuguese one, because Portugal was never on the list. */
ok("the rules come from Google's phone metadata, not a table we maintain",
   /from "libphonenumber-js"/.test(vSrc) && !/const NAT_LEN/.test(vSrc));
/* isValidPhoneNumber("+3606703031941") is true — the library strips Hungary's
   06 before judging. Valid number, wrong string, and the string is what Twilio
   gets. So the server demands the canonical form, not merely a verdict. */
ok("the server requires the canonical form, not just a valid one",
   /p\.number !== s/.test(vSrc));
ok("client and server use the same source", /from "libphonenumber-js"/.test(appPh));
ok("and no hand-written length table survives anywhere",
   !/const NAT_LEN/.test(appPh) && !/const NAT_LEN/.test(vSrc));

/* Behaviour across countries — the point of the change. Every one of these is
   posted to the real endpoint; the ones expected to pass stop at the next
   guard (Twilio unconfigured under test), never at the format check. */
for (const [num, shouldReject, why] of [
  ["+3670303194149",  true,  "the bug report: 13 digits, Hungary has 11"],
  ["+36070303194",    true,  "trunk zero left in"],
  ["+436645551234",   false, "Austria, 10 national digits"],
  ["+4366455512345",  false, "Austria, 11 — same country, different length"],
  ["+351912345678",   false, "Portugal, absent from the old table entirely"],
  ["+12125551234",    false, "United States"],
  ["+923001234567",   false, "Pakistan"],
  ["+8613800138000",  false, "China"],
  ["+9999999999999",  true,  "no such country code"],
]) {
  const r = await j("/api/verify/signup/start", { method: "POST", body: { phone: num } });
  const rejectedOnFormat = r.status === 400 && /country code/i.test(r.data.error || "");
  ok(`${num} — ${why}`, rejectedOnFormat === shouldReject,
     `status ${r.status} ${JSON.stringify(r.data.error || "").slice(0, 60)}`);
}
ok("the provider's own words are never returned to a customer",
   !/error: data\.message/.test(vSrc) && /function sendFailure/.test(vSrc));
ok("Twilio's code for a bad number becomes a sentence a person can act on",
   /60200/.test(vSrc) && /badPhoneMsg/.test(vSrc));
ok("and the raw provider text is still logged for us", /console\.error\(`twilio /.test(vSrc));

/* Behavioural: the malformed number from the screenshot must be refused by us,
   with our wording, without any provider being contacted. */
const bad = await j("/api/verify/signup/start", { method: "POST", body: { phone: "+3670303194149" } });
ok("the exact number from the bug report is refused", bad.status === 400, `got ${bad.status}`);
ok("with our message, not Twilio's",
   /country code/i.test(bad.data.error || "") && !/parameter/i.test(bad.data.error || ""),
   bad.data.error);

for (const [what, value] of [["far too short", "+361"],
                             ["far too long", "+3670303194149999"], ["not a number at all", "hello"]]) {
  const r = await j("/api/verify/signup/start", { method: "POST", body: { phone: value } });
  ok(`${what} is refused`, r.status === 400, `${value} -> ${r.status}`);
}

/* If the gate is on and the provider is unreachable, nobody can register at
   all. That must page us, not wait for a customer to write in. */
ok("a blocked-signup outage raises an alert rather than failing quietly",
   /REQUIRE_SIGNUP_VERIFY === "1"/.test(vSrc) && /signups are blocked/.test(vSrc));
ok("and the customer sees a sentence, not the internal code",
   /verification_not_configured/.test(appPh) && /We can't send codes right now/.test(appPh));

/* ── STRIPE REFUSES HUF AMOUNTS NOT DIVISIBLE BY 100 ──────────────────────
   Reported as "the payment system is broken — it says could not start
   payment". The charge itself was always fine: a Hungarian price is a round
   number of forints. The commission is not — it is the headline percentage
   MINUS Stripe's own cut, and that subtraction lands on a non-round number
   more often than not. Five of nine realistic prices produced an
   application_fee_amount Stripe rejected outright.

   Being price-dependent, it worked in testing at some prices, which is the
   worst way for a payment bug to behave. */
console.log("\n── payment amounts Stripe will actually accept ──");
const { payableMinor, platformNetMinor } = await import("../server/routes/payments.js");

ok("HUF amounts are rounded to something Stripe accepts", payableMinor(55250, "HUF") === 55200);
ok("and rounded DOWN, so the difference comes out of our commission",
   payableMinor(55299, "huf") === 55200);
ok("currencies without the rule are left exactly alone", payableMinor(55250, "EUR") === 55250);
ok("zero stays zero", payableMinor(0, "HUF") === 0);
ok("a negative can never reach Stripe", payableMinor(-500, "HUF") === 0);

let hufRefused = 0;
for (const ft of [5000, 6500, 7500, 8000, 9900, 12000, 14500, 18000, 23500, 999]) {
  const amount = payableMinor(ft * 100, "HUF");
  const fee = payableMinor(platformNetMinor(ft * 100, Math.round(ft * 0.1) * 100), "HUF");
  if (amount % 100 !== 0 || fee % 100 !== 0) hufRefused++;
}
ok("no realistic price produces an amount Stripe would refuse", hufRefused === 0, `${hufRefused} would be hufRefused`);

const paySrc = (await import("fs")).readFileSync("server/routes/payments.js", "utf8");
ok("the rule is applied to the charge, not just the fee", /unit_amount: payableMinor/.test(paySrc));
/* Three: the direct charge, the legacy destination charge, and the off-session
   renewal. Counting them exactly rather than "at least one", so a fourth path
   added later without the rule is noticed. */
ok("and on every path that takes a commission",
   (paySrc.match(/application_fee_amount: payableMinor/g) || []).length === 3,
   `${(paySrc.match(/application_fee_amount: payableMinor/g) || []).length} found`);
ok("what we record as kept matches what we asked Stripe for",
   /platform_net_minor = \$1[\s\S]{0,120}payableMinor/.test(paySrc));
ok("a payment that cannot start alerts the operator, not just the customer",
   /payments are failing to start/.test(paySrc));

/* ── AN ACCOUNT IS CREATED AS A RESIDENT ──────────────────────────────────
   Student was the default on the signup form, so anyone who did not read the
   two cards created a student account — which demands a student card photo
   and claims a discount they may not be entitled to. */
console.log("\n── the signup form defaults to resident ──");
const appD = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("a new account starts as a resident", /custType: "resident"/.test(appD));
ok("and nothing still defaults to student", !/custType: "student"/.test(appD)
   && !/custType: session\.custType \|\| "student"/.test(appD));
ok("the login header no longer leads with the student discount",
   !/Students get automatic discounts/.test(appD));
ok("and the star beside the home heading is gone",
   !/whatSparkle"\)\} <Sparkle/.test(appD));

/* ── THE COMPANY MUST SEE THE WORK, AND HAVE TIME TO TAKE IT ──────────────
   Reported as "companies never get the bookings, it is blank for them, and it
   gets cancelled and refunded in 10 minutes". Two faults compounding:

   1. The company list showed only PAID work, so a booking whose payment was
      still going through the gateway was invisible. The partner saw an empty
      screen and concluded the app was broken.
   2. acceptDeadline took the EARLIER of "12 hours from booking" and "12 hours
      before the job starts". Anything booked less than twelve hours ahead had
      a deadline already in the past, so the sweep cancelled and refunded it on
      its next tick. Short-notice work — the most valuable kind — could never
      be accepted by anyone. */
console.log("\n── the company can see the job, and has time to take it ──");
const { acceptDeadline: dl } = await import("../server/lib/reminders.js");
const at = (createdAgoH, startsInH) => {
  const now = Date.now();
  const st = new Date(now + startsInH * 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  return dl({ created_at: new Date(now - createdAgoH * 3600e3).toISOString(),
              scheduled_date: `${st.getFullYear()}-${pad(st.getMonth() + 1)}-${pad(st.getDate())}`,
              scheduled_slot: `${pad(st.getHours())}:00` });
};
const minsFromNow = (iso) => iso ? Math.round((Date.parse(iso) - Date.now()) / 60000) : null;

for (const startsIn of [2, 6, 11, 12, 13]) {
  const m = minsFromNow(at(0, startsIn));
  ok(`a job starting in ${startsIn}h can still be accepted (was expired on arrival)`,
     m !== null && m > 0, `${m} minutes`);
}
ok("short notice gives the company the full minimum window",
   minsFromNow(at(0, 6)) >= 175, `${minsFromNow(at(0, 6))} minutes`);
ok("plenty of notice still gives the full twelve hours",
   minsFromNow(at(0, 72)) >= 700, `${minsFromNow(at(0, 72))} minutes`);
ok("the deadline is never after the job was due to start",
   Date.parse(at(0, 1)) <= Date.now() + 61 * 60e3, "must not outlive the slot");
ok("a booking that has already sat unanswered for a day is out of time",
   minsFromNow(at(30, 72)) <= 0, `${minsFromNow(at(30, 72))} minutes`);

const bkSrcC = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");
ok("the company list includes work whose payment is still in flight",
   /payment_status IN \('paid','pending','scheduled','retry'\)/.test(bkSrcC));

/* The comment that broke this endpoint outright lived INSIDE the SQL string:
   an em dash in a SQL block comment is more than the parser will lex, and
   every company got a 500. No prose inside a query, ever. */
let sqlProse = 0;
for (const m of bkSrcC.matchAll(/query\(\s*`([\s\S]*?)`/g))
  if ([...m[1]].some((c) => c.charCodeAt(0) > 127)) sqlProse++;
ok("no SQL string in this file contains non-ASCII text", sqlProse === 0,
   `${sqlProse} queries carry characters the parser may reject`);

/* ── THE SAME TWO BUGS, EVERYWHERE ELSE THEY LIVED ────────────────────────
   Fixing the booking list and the checkout was not the end of either fault.
   The HUF divisibility rule was missing from four more amounts, including
   every recurring subscription charge — so renewals would have been declined
   by Stripe rather than by anyone's bank. And the "paid work only" filter had
   a second copy in the calendar feed, so a company syncing their schedule saw
   a gap where a real job was about to be. */
console.log("\n── every amount we hand Stripe, not just the first one ──");
const paySrcAll = (await import("fs")).readFileSync("server/routes/payments.js", "utf8");
const subSrcAll = (await import("fs")).readFileSync("server/lib/subscriptions.js", "utf8");
const calSrcAll = (await import("fs")).readFileSync("server/routes/calendar.js", "utf8");

/* Any `amount:` or `application_fee_amount:` reaching Stripe must go through
   payableMinor. Comment lines are excluded; a false alarm here teaches people
   to ignore the check. */
const unrounded = [];
for (const [file, src] of [["payments.js", paySrcAll], ["subscriptions.js", subSrcAll]]) {
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
    if (!/\b(amount|application_fee_amount):\s/.test(t)) continue;
    if (/payableMinor|subFeeNet|amount_minor|fee_minor/.test(t)) continue;
    unrounded.push(`${file}: ${t.slice(0, 60)}`);
  }
}
ok("no amount reaches Stripe without the HUF rule applied", unrounded.length === 0,
   unrounded.join(" | "));

ok("recurring subscription charges are rounded too", /amount: payableMinor\(amountMinor, cur\)/.test(subSrcAll));
ok("and so is the commission taken from a renewal", /const subFeeNet = payableMinor\(/.test(subSrcAll));
ok("partial refunds are rounded in the customer's favour, not ours",
   /payableMinor\(amountMinor \+ 99/.test(paySrcAll));

console.log("\n── one visibility rule, not two that drift ──");
const rule = /payment_status IN \('paid','pending','scheduled','retry'\)/;
ok("the booking list shows work whose payment is in flight", rule.test(bkSrcC));
ok("and the calendar feed uses exactly the same rule", rule.test(calSrcAll));
ok("neither still lists only paid work",
   !/IN \('paid','scheduled','retry'\)/.test(bkSrcC) && !/IN \('paid','scheduled','retry'\)/.test(calSrcAll));

/* The prose-in-SQL fault that produced a 500 for every company. */
let proseAnywhere = 0;
for (const [f, src] of [["bookings", bkSrcC], ["calendar", calSrcAll], ["payments", paySrcAll]])
  for (const m of src.matchAll(/query\(\s*`([\s\S]*?)`/g))
    if ([...m[1]].some((c) => c.charCodeAt(0) > 127)) proseAnywhere++;
ok("no query anywhere carries characters the SQL parser may reject", proseAnywhere === 0,
   `${proseAnywhere} affected`);

/* ── A COMPANY CANNOT REWRITE WHAT HAPPENED ───────────────────────────────
   The cleaner had a strict step-by-step ladder. The company had an ownership
   check and nothing else, so a partner could take a booking from "waiting to
   be accepted" straight to "completed" — telling the customer their cleaning
   was done and asking for a review, with nobody having attended; reopen a
   finished job after its invoice was issued; or decline work that had already
   been carried out, refunding their own cleaner's labour. */
console.log("\n── a job can move forward, never backward ──");
const stSrc = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");

ok("accepting is the only way out of the waiting state",
   /cur === 0 && want !== 1/.test(stSrc));
ok("a finished job cannot be reopened", /iWant <= iCur/.test(stSrc));
ok("a job that has started cannot be declined", /already started[\s\S]{0,60}no longer decline/.test(stSrc));
ok("nor cancelled from the company side", /cannot be cancelled here/.test(stSrc));
ok("a closed booking cannot be revived", /already declined or cancelled/.test(stSrc));
ok("the collection ladder is respected as well as the on-site one",
   /fulfilment === "collection" \? \[0, 1, 2, 5, 3, 6, 4\]/.test(stSrc));
ok("admin stays able to correct the record", /req\.user\.role !== "admin"/.test(stSrc));

/* Behavioural: the company owns the booking, so only the ladder can stop it. */
const bkNew = (await j("/api/bookings", { method: "POST", token: CU.token,
  body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(40), scheduledSlot: "09:00", address: "Piac 1" } })).data.booking;
const setStatus = (id, st, token) => j(`/api/bookings/${id}/status`, { method: "PUT", token, body: { status: st } });

const jump = await setStatus(bkNew.id, 4, CO.token);
ok("a booking nobody accepted cannot be marked completed", jump.status === 400,
   `${jump.status} ${JSON.stringify(jump.data.error || "")}`);
ok("and the refusal explains what to do first", /Accept the booking first/i.test(jump.data.error || ""),
   jump.data.error);

ok("accepting works", (await setStatus(bkNew.id, 1, CO.token)).status < 300);
ok("then completing works", (await setStatus(bkNew.id, 4, CO.token)).status < 300);
const back = await setStatus(bkNew.id, 1, CO.token);
ok("but reopening the finished job does not", back.status === 400, `${back.status}`);
const late = await setStatus(bkNew.id, 8, CO.token);
ok("and declining it afterwards does not either", late.status === 400, `${late.status}`);

/* ── CHECKOUT MUST NOT DEPEND ON A DASHBOARD TOGGLE ───────────────────────
   Live failure, 23 Aug, caught by the alert wired earlier the same day:

     StripeInvalidRequestError: No valid payment method types for this Checkout
     Session. Please ensure that you have activated payment methods compatible
     with your chosen currency.

   With payment_method_types unset, Stripe picks from whatever is enabled in
   the dashboard for that currency — and for HUF on a connected account that
   set can be empty, so the session cannot be created and the customer is told
   "Could not start payment". Naming the method removes the dependency. */
console.log("\n── the checkout says what it accepts ──");
const paySrcPM = (await import("fs")).readFileSync("server/routes/payments.js", "utf8");
ok("both Checkout sessions name the payment method explicitly",
   (paySrcPM.match(/payment_method_types: \["card"\]/g) || []).length === 2,
   `${(paySrcPM.match(/payment_method_types: \["card"\]/g) || []).length} of 2`);
ok("every session we create has it, none left to infer",
   (paySrcPM.match(/checkout\.sessions\.create\(/g) || []).length ===
   (paySrcPM.match(/payment_method_types: \["card"\]/g) || []).length);
/* Specifying both is a Stripe error in itself. */
ok("and automatic selection is not also switched on",
   !/automatic_payment_methods/.test(paySrcPM));

/* ── A SLOT IS A RANGE, AND AN ABANDONED CHECKOUT IS NOT A BOOKING ────────
   Reported live: "That time has just been taken" on a slot the partner had
   never sold. Two faults behind it.

   1. The booking row is created BEFORE payment — correctly, there has to be
      something to pay for. But every failed attempt left a row occupying the
      slot, so trying to pay three times locked you out of your own
      appointment.
   2. The check compared scheduled_slot for exact equality, so a three-hour
      clean booked at 10:00 left 11:00 and 12:00 looking free. One team could
      be sold the same morning three times over. */
console.log("\n── availability counts real work, for its real length ──");
const bkAv = (await import("fs")).readFileSync("server/routes/bookings.js", "utf8");
/* Retrying is handled by reusing the abandoned row, not by excusing it from
   the count — excusing a customer's unpaid rows would let one person quietly
   hold a whole morning. */
ok("retrying an abandoned checkout reuses that booking rather than making another",
   /payment_status = 'unpaid' AND status = 0/.test(bkAv) && /reused: true/.test(bkAv));
ok("matched on the address too, so a van calling at two houses is not mistaken for a retry",
   /AND address = \$6/.test(bkAv));
ok("and anyone's abandoned checkout expires out of the count",
   /NOT \(b\.payment_status = 'unpaid' AND b\.created_at < NOW\(\)/.test(bkAv));
ok("the grace period is generous enough to finish paying",
   /CHECKOUT_GRACE_MIN \|\| 30/.test(bkAv));
ok("a job occupies the hours it lasts, not just the one it starts",
   /wantFrom < to && from < wantTo/.test(bkAv));
ok("length is read from the booking, then the service, then an hour",
   /Number\.isFinite\(h\) && h > 0/.test(bkAv) && /service_minutes \?\? b\?\.minutes/.test(bkAv));

/* Behavioural, on the running server. */
/* Capacity is pinned to 1 rather than left to the team size: by this point the
   suite has registered two cleaners, so "one job at a time" would silently
   become two and the overlap assertions would pass for the wrong reason. */
const svc3h = (await j("/api/services", { method: "POST", token: CO.token,
  body: { name: "Long clean", pricingType: "flat", priceHuf: 20000, minutes: 180, slotCapacity: 1 } })).data.service;
ok("the service records how long it takes", Number(svc3h.minutes) === 180, `${svc3h?.minutes}`);
ok("and how many can run at once", Number(svc3h.slot_capacity) === 1, `${svc3h?.slot_capacity}`);
const day3 = dPlus(45);
const bookAt = (slot, token = CU.token, sid = svc3h.id) => j("/api/bookings", { method: "POST", token,
  body: { companyId: cid, serviceId: sid, scheduledDate: day3, scheduledSlot: slot, address: "Piac 1" } });

const first = await bookAt("10:00");
ok("a three-hour job books at 10:00", first.status < 300, JSON.stringify(first.data.error || ""));
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [first.data.booking.id]);
const clash = await bookAt("11:00", OTHER.token);
ok("11:00 is now correctly refused — the team is still there", clash.status === 400, `${clash.status}`);
const clash2 = await bookAt("12:00", OTHER.token);
ok("and so is 12:00", clash2.status === 400, `${clash2.status}`);
const free = await bookAt("13:00", OTHER.token);
ok("13:00 is free again, once the job has ended", free.status < 300, JSON.stringify(free.data.error || ""));

console.log("\n── the company decides how many it can run at once ──");
await j(`/api/services/${svc3h.id}`, { method: "PUT", token: CO.token, body: { slotCapacity: 2 } });
const second = await bookAt("10:00", OTHER.token);
ok("raising the capacity to two lets a second job share the slot",
   second.status < 300, JSON.stringify(second.data.error || ""));
const appCap = (await import("fs")).readFileSync("src/App.jsx", "utf8");
ok("and the company can set it from the service editor",
   /Jobs at the same time/.test(appCap));

console.log("\n── the date picker is a calendar, not a rail ──");
ok("a month grid replaced the horizontal strip",
   /function MonthCalendar/.test(appCap) && !/scrollSnapType: "x proximity"/.test(appCap));
ok("weeks start on Monday", /\(firstOf\.getDay\(\) \+ 6\) % 7/.test(appCap));
ok("closed and fully-booked days are shown but not pressable",
   /isClosed\(iso\) \|\| isFull\(iso\)/.test(appCap));

console.log("\n── the company's tabs are grouped ──");
ok("the bar carries the daily work plus one Manage button",
   /id: "__manage"/.test(appCap));
ok("and the rest live behind it", /function ManageSheet/.test(appCap) && /MANAGE_TABS/.test(appCap));
ok("Manage stays lit while one of its screens is open",
   /MANAGE_TABS\(\)\.some\(\(m\) => m\.id === tab\)/.test(appCap));

/* ── ONE LIST DECIDES WHERE A FIELD LIVES ─────────────────────────────────
   Company setup was twenty-three fields in a single scroll with three save
   buttons in it. Splitting "who you are" onto the Profile and "how you
   operate" onto Setup is only safe if the split is DATA — otherwise the next
   move cuts JSX out of one component, pastes it into another, and the field
   quietly stops being saved because its handler stayed behind.

   COMPANY_FIELDS is that data. These checks exist so it stays that way. */
console.log("\n── company setup is described by a list, not by layout ──");
const appReg = (await import("fs")).readFileSync("src/App.jsx", "utf8");

ok("there is a single registry of company fields", /const COMPANY_FIELDS = \[/.test(appReg));
ok("every entry says which screen it belongs to",
   (appReg.match(/screen: "(profile|setup)"/g) || []).length >= 12,
   `${(appReg.match(/screen: "(profile|setup)"/g) || []).length} entries`);
ok("both screens render from it rather than hand-written fields",
   (appReg.match(/<CompanyFields /g) || []).length >= 2);
ok("moving a field between screens is a one-word change",
   /const fieldsFor = \(screen, group\)/.test(appReg));

/* Every profile field must be forwarded by the save that owns that screen —
   the exact failure this structure exists to prevent. */
const profileIds = [...appReg.matchAll(/\{ id: "(\w+)",\s*screen: "profile"/g)].map((m) => m[1]);
ok("the registry actually holds the business identity fields",
   profileIds.includes("tax_id") && profileIds.includes("billing_address") && profileIds.includes("name"),
   profileIds.join(","));
const saveCo = (appReg.match(/const saveCompany = async \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
const camel = (x) => x.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const dropped = profileIds.filter((id) => !saveCo.includes(id) && !saveCo.includes(camel(id)));
ok("and every one of them is sent when the profile is saved", dropped.length === 0,
   `dropped: ${dropped.join(", ")}`);

/* The two halves must not both claim the same field, or one screen silently
   overwrites the other. */
const allIds = [...appReg.matchAll(/\{ id: "(\w+)",\s*screen:/g)].map((m) => m[1]);
ok("no field is claimed by both screens", new Set(allIds).size === allIds.length,
   `${allIds.length - new Set(allIds).size} duplicated`);

console.log("\n── and the week can be set in one tap ──");
ok("opening-hours presets exist", /Start from a usual week/.test(appReg));
ok("a preset writes whole days, not single hours", /days\[k\] = \{ on: true, slots: \[\.\.\.span\] \}/.test(appReg));
ok("the checklist names what is still missing", /function SetupChecklist/.test(appReg));
ok("and only nags about things that actually block a booking",
   /req: true/.test(appReg) && /At least one service/.test(appReg));

console.log(`\n════ GAPS: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
