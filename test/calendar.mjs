/* CALENDAR — one-off .ics files and the live subscription feed.
   Run: node test/calendar.mjs                                        */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4503";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const BK_DATE = dPlus(90);
const STAMP = BK_DATE.replace(/-/g, "");

const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4503${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, ct, cache: r.headers.get("cache-control") || "",
           data: ct.includes("json") ? await r.json().catch(() => ({})) : await r.text() };
};

/* ── cast: company + cleaner + two customers ── */
await j("/api/auth/register", { method: "POST", body: { email: "co@c.hu", password: "secret123", role: "company", fullName: "Owner", companyName: "Cal Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cu@c.hu", password: "secret123", role: "customer", fullName: "Cal Cust", phone: "+36301112233", city: "Debrecen", address: "Kossuth u 1", customerType: "resident", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "other@c.hu", password: "secret123", role: "customer", fullName: "Nosy Person", phone: "+36301112299", city: "Debrecen", address: "Fő tér 9", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const co = (await j("/api/auth/login", { method: "POST", body: { email: "co@c.hu", password: "secret123" } })).data;
const cu = (await j("/api/auth/login", { method: "POST", body: { email: "cu@c.hu", password: "secret123" } })).data;
const other = (await j("/api/auth/login", { method: "POST", body: { email: "other@c.hu", password: "secret123" } })).data;
const cid = co.user.company_id;
const bcrypt = (await import("bcryptjs")).default;
await query("INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ('cl@c.hu', $1, 'Cal Cleaner', 'employee', $2, 'approved', true)", [bcrypt.hashSync("secret123", 8), cid]);
const cl = (await j("/api/auth/login", { method: "POST", body: { email: "cl@c.hu", password: "secret123" } })).data;

const svc = (await j("/api/services", { method: "POST", token: co.token, body: { name: "Deep clean", pricingType: "flat", priceHuf: 12000, durationMin: 90, minutes: 90 } })).data.service;
const bk = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: BK_DATE, scheduledSlot: "10:00", address: "Debrecen, Kossuth u 1.", note: "Ring the top bell; semicolons, commas matter" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid', assigned_to=$1 WHERE id=$2", [cl.user.id, bk.id]);

console.log("\n── the single-booking file ──");
const ics = await j(`/api/calendar/booking/${bk.id}.ics`, { token: cu.token });
ok("customer can download their booking", ics.status === 200, String(ics.status));
ok("served as a calendar file", ics.ct.includes("text/calendar"), ics.ct);
ok("never cached by proxies", ics.cache.includes("no-store"), ics.cache);
const body = ics.data;
ok("it is a valid calendar envelope", body.startsWith("BEGIN:VCALENDAR") && body.trimEnd().endsWith("END:VCALENDAR"));
ok("lines end CRLF as the spec requires", body.includes("\r\n") && !/[^\r]\n/.test(body));
ok("one event, with a stable UID", (body.match(/BEGIN:VEVENT/g) || []).length === 1 && body.includes(`UID:booking-${bk.id}@`));
ok("start time matches the slot", body.includes(`DTSTART:${STAMP}T100000`), body.match(/DTSTART:[^\r\n]*/)?.[0]);
ok("end time respects the service duration", body.includes(`DTEND:${STAMP}T113000`), body.match(/DTEND:[^\r\n]*/)?.[0]);
ok("the address becomes the location", /LOCATION:Debrecen\\, Kossuth u 1\./.test(body), body.match(/LOCATION:[^\r\n]*/)?.[0]);
const unfolded = body.replace(/\r\n /g, "");
ok("special characters are escaped, not left raw", unfolded.includes("bell\\; semicolons\\, commas"), (unfolded.match(/DESCRIPTION:[^\r\n]*/) || [])[0]);
ok("it carries an hour-before reminder", body.includes("TRIGGER:-PT1H"));
ok("confirmed while the booking is live", body.includes("STATUS:CONFIRMED"));
ok("long lines are folded under 75 octets",
   body.split("\r\n").every((l) => Buffer.from(l, "utf8").length <= 75),
   body.split("\r\n").find((l) => Buffer.from(l, "utf8").length > 75));

console.log("\n── who is allowed to fetch it ──");
ok("a stranger cannot download someone else's booking",
   (await j(`/api/calendar/booking/${bk.id}.ics`, { token: other.token })).status === 403);
ok("logged out gets nothing", (await j(`/api/calendar/booking/${bk.id}.ics`)).status === 401);
const clIcs = await j(`/api/calendar/booking/${bk.id}.ics`, { token: cl.token });
ok("the assigned cleaner can download it", clIcs.status === 200, String(clIcs.status));
ok("the cleaner's copy names the customer", clIcs.data.includes("Cal Cust"));
const cuBody = ics.data;
ok("the customer's copy does NOT contain their own phone number", !cuBody.includes("+36301112233"));

console.log("\n── the live subscription feed ──");
const mine = await j("/api/calendar/me", { token: cu.token });
ok("a customer gets a feed link", mine.status === 200 && /\/api\/calendar\/feed\/.+\.ics$/.test(mine.data.url || ""), JSON.stringify(mine.data));
ok("and a webcal:// version for one-tap subscribing", (mine.data.webcal || "").startsWith("webcal:"), mine.data.webcal);
const tok = mine.data.url.split("/feed/")[1].replace(".ics", "");
ok("the secret is long enough to be unguessable", tok.length >= 30, `${tok.length} chars`);
ok("asking twice gives the same link", (await j("/api/calendar/me", { token: cu.token })).data.url === mine.data.url);

const feed = await j(`/api/calendar/feed/${tok}.ics`);
ok("the feed opens with no login at all", feed.status === 200, String(feed.status));
ok("it tells calendars to re-check hourly", feed.data.includes("REFRESH-INTERVAL;VALUE=DURATION:PT1H"));
ok("it contains the booking", feed.data.includes(`UID:booking-${bk.id}@`));
ok("the feed is never cached", feed.cache.includes("no-store"), feed.cache);
ok("a wrong token gets nothing", (await j("/api/calendar/feed/notarealtokenatallxxxxxxxxxx.ics")).status === 404);
ok("a short token is refused without touching the database", (await j("/api/calendar/feed/abc.ics")).status === 404);

console.log("\n── each role sees only its own work ──");
const coFeed = await j(`/api/calendar/feed/${(await j("/api/calendar/me", { token: co.token })).data.url.split("/feed/")[1].replace(".ics", "")}.ics`);
ok("the company feed includes the company's booking", coFeed.data.includes(`booking-${bk.id}@`));
const clFeed = await j(`/api/calendar/feed/${(await j("/api/calendar/me", { token: cl.token })).data.url.split("/feed/")[1].replace(".ics", "")}.ics`);
ok("the cleaner feed includes the job assigned to them", clFeed.data.includes(`booking-${bk.id}@`));
await query("UPDATE bookings SET assigned_to = NULL WHERE id = $1", [bk.id]);
const clFeed2 = await j(`/api/calendar/feed/${(await j("/api/calendar/me", { token: cl.token })).data.url.split("/feed/")[1].replace(".ics", "")}.ics`);
ok("unassigning removes it from the cleaner's feed", !clFeed2.data.includes(`booking-${bk.id}@`));
const otherFeed = await j(`/api/calendar/feed/${(await j("/api/calendar/me", { token: other.token })).data.url.split("/feed/")[1].replace(".ics", "")}.ics`);
ok("an unrelated customer's feed is empty of it", !otherFeed.data.includes(`booking-${bk.id}@`));

console.log("\n── it stays up to date, which is the whole point ──");
const seqBefore = Number(feed.data.match(/SEQUENCE:(\d+)/)?.[1] ?? -1);
await new Promise((r) => setTimeout(r, 1100));
await query("UPDATE bookings SET scheduled_slot = '14:00', updated_at = NOW() + INTERVAL '5 minutes' WHERE id = $1", [bk.id]);
const feed2 = await j(`/api/calendar/feed/${tok}.ics`);
ok("a moved booking shows the new time", feed2.data.includes(`DTSTART:${STAMP}T140000`), feed2.data.match(/DTSTART:[^\r\n]*/)?.[0]);
const seqAfter = Number(feed2.data.match(/SEQUENCE:(\d+)/)?.[1] ?? -1);
ok("SEQUENCE moves, so calendars actually replace the old event", seqAfter > seqBefore, `${seqBefore} → ${seqAfter}`);
await query("UPDATE bookings SET status = 9 WHERE id = $1", [bk.id]);
const feed3 = await j(`/api/calendar/feed/${tok}.ics`);
ok("a cancelled booking is marked CANCELLED, not silently dropped", feed3.data.includes("STATUS:CANCELLED"));
ok("and loses its reminder", !feed3.data.includes("TRIGGER:-PT1H"));

console.log("\n── revoking the link ──");
const reset = await j("/api/calendar/reset", { method: "POST", token: cu.token });
ok("reset hands back a different link", reset.status === 200 && reset.data.url !== mine.data.url);
ok("the old link stops working immediately", (await j(`/api/calendar/feed/${tok}.ics`)).status === 404);
const newTok = reset.data.url.split("/feed/")[1].replace(".ics", "");
ok("the new link works", (await j(`/api/calendar/feed/${newTok}.ics`)).status === 200);

console.log("\n── a suspended account's feed goes dark ──");
await query("UPDATE users SET is_active = false WHERE id = $1", [cu.user.id]);
ok("suspending the user kills the feed", (await j(`/api/calendar/feed/${newTok}.ics`)).status === 404);

console.log(`\n════ CALENDAR: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
