/* DEMO SEED — fills a throwaway in-memory database with enough of a business
   to click through all four roles.

   The point is not "some data". It is data that puts every screen into a state
   worth looking at: a job nobody has accepted so the countdown is running, a
   job starting soon with no cleaner on it, a job whose slot has passed, and
   finished paid work sitting on the billing list. An empty app always looks
   fine, which is exactly why an empty app tells you nothing.

   It runs INSIDE the server process, called from index.js on boot. It has to:
   pg-mem lives in the process that created it, so a separate seeding script
   would populate a second, invisible database and leave the real one empty.

   Guarded twice — PGMEM must be on AND DEMO_SEED must be set — so it can never
   fire against a real database.                                              */

const PW = "demo1234";

export async function seedDemo() {
  if (process.env.PGMEM !== "1") throw new Error("demo seed refuses to run against a real database");

  const API = `http://127.0.0.1:${process.env.PORT || 3001}`;
  const { query } = await import("../server/db.js");
  const bcrypt = (await import("bcryptjs")).default;

  const j = async (p, o = {}) => {
    const r = await fetch(API + p, {
      method: o.method || "GET",
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:00`;

  /* our own listener, from inside our own process */
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(API + "/api/app/version")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const reg = (body) => j("/api/auth/register", { method: "POST", body });
  await reg({ email: "company@demo.hu", password: PW, role: "company", fullName: "Kovács Anna",
    companyName: "Debrecen Tiszta Kft.", taxId: "12345676-1-02", regNumber: "09-09-123456",
    city: "Debrecen", termsAccepted: true });
  await reg({ email: "customer@demo.hu", password: PW, role: "customer", fullName: "Nagy Péter",
    phone: "+36301112233", city: "Debrecen", address: "Piac utca 12", customerType: "resident", termsAccepted: true });

  await query("UPDATE users SET approval_status='approved'");
  await query("UPDATE companies SET is_approved=true, is_listed=true, billing_zip='4025', billing_city='Debrecen', billing_address='Piac utca 12.'");
  await query(
    "INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status, is_active) VALUES ($1,$2,$3,'admin',true,'approved',true)",
    ["admin@demo.hu", bcrypt.hashSync(PW, 8), "Musa Gilani"]);

  const login = async (e) => (await j("/api/auth/login", { method: "POST", body: { email: e, password: PW } })).data;
  const CO = await login("company@demo.hu");
  const CU = await login("customer@demo.hu");
  const cid = CO.user.company_id;

  await query(
    "INSERT INTO users (email, password_hash, full_name, role, company_id, approval_status, is_active) VALUES ($1,$2,$3,'employee',$4,'approved',true)",
    ["cleaner@demo.hu", bcrypt.hashSync(PW, 8), "Szabó Márk", cid]);
  const CL = await login("cleaner@demo.hu");

  const svc = async (body) => {
    const r = await j("/api/services", { method: "POST", token: CO.token, body });
    if (!r.data.service) throw new Error(`service "${body.name}" refused: ${JSON.stringify(r.data)}`);
    return r.data.service;
  };
  const home = await svc({ name: "Standard apartment clean", description: "Kitchen, bathroom, floors, dusting",
    icon: "🏠", pricingType: "flat", priceHuf: 15900, minutes: 120,
    tasks: ["Kitchen surfaces & sink", "Bathroom: toilet, shower, mirror", "Vacuum & mop all floors", "Dust surfaces", "Take out bins"] });
  const laundry = await svc({ name: "Laundry & ironing", description: "We collect it and bring it back",
    icon: "🧺", pricingType: "unit", unitLabel: "kg", unitPriceHuf: 900, minUnits: 3, maxUnits: 25,
    minutes: 30, fulfilment: "collection", turnaroundDays: 3, slotCapacity: 8 });
  const carpet = await svc({ name: "Carpet cleaning", description: "Priced by the square metre",
    icon: "🧽", pricingType: "unit", unitLabel: "m²", unitPriceHuf: 1400, minUnits: 4, maxUnits: 40, minutes: 90 });

  const book = async (serviceId, date, slot, extra = {}) => {
    const r = await j("/api/bookings", { method: "POST", token: CU.token,
      body: { companyId: cid, serviceId, scheduledDate: date, scheduledSlot: slot, address: "Piac utca 12", ...extra } });
    if (!r.data.booking) console.warn("  booking refused:", date, slot, JSON.stringify(r.data));
    return r.data.booking;
  };

  /* The server refuses to create a booking in the past, and refuses two jobs in
     the same hour — both correctly. To show an overdue job we book it legally
     and then move the clock underneath it. */
  const backdate = (id, when) =>
    query("UPDATE bookings SET scheduled_date = $2, scheduled_slot = $3 WHERE id = $1",
      [id, when.toISOString().slice(0, 10), hhmm(when)]);

  const soon = new Date(Date.now() + 6 * 3600e3);
  const past = new Date(Date.now() - 3 * 3600e3);

  /* 1 — paid, nobody has accepted it. The acceptance countdown is running. */
  const waiting = await book(home.id, dPlus(20), "10:00");
  if (waiting) await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [waiting.id]);

  /* 2 — accepted, but no cleaner, and it starts in six hours. */
  const unassigned = await book(home.id, dPlus(4), "15:00");
  if (unassigned) {
    await query("UPDATE bookings SET payment_status='paid', status=1, assigned_to=NULL WHERE id=$1", [unassigned.id]);
    await backdate(unassigned.id, soon);
  }

  /* 3 — its slot came and went and nobody set off. */
  const overdue = await book(carpet.id, dPlus(3), "08:00", { units: 12 });
  if (overdue) {
    await query("UPDATE bookings SET payment_status='paid', status=1 WHERE id=$1", [overdue.id]);
    await backdate(overdue.id, past);
  }

  /* 4 — a collection job partway along its ladder, already on the way. */
  const collect = await book(laundry.id, dPlus(2), "09:00", { units: 6 });
  if (collect) {
    await j(`/api/bookings/${collect.id}/assign`, { method: "PUT", token: CO.token, body: { employeeId: CL.user.id } });
    await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [collect.id]);
    await j(`/api/bookings/${collect.id}/status`, { method: "PUT", token: CL.token, body: { status: 2 } });
  }

  /* 5-8 — finished and paid, so the billing list has something in it. */
  for (let i = 0; i < 4; i++) {
    const b = await book(home.id, dPlus(8 + i), "13:00");
    if (!b) continue;
    await query(
      "UPDATE bookings SET payment_status='paid', status=4, platform_net_minor=$2, started_at=NOW(), finished_at=NOW() WHERE id=$1",
      [b.id, Math.round((Number(b.service_fee_huf) - 167.5) * 100)]);
    { const d = new Date(Date.now() - (7 + i) * 864e5); d.setHours(13, 0, 0, 0); await backdate(b.id, d); }
    if (i === 0) {
      await j("/api/reviews", { method: "POST", token: CU.token,
        body: { bookingId: b.id, stars: 5, body: "Spotless, and they were early. Márk was lovely." } });
      await j(`/api/invoices/${b.id}/partner`, { method: "POST", token: CO.token,
        body: { invoiceNumber: "DT-2026-0041", issuedAt: dPlus(-7) } });
    }
  }

  const n = (await query("SELECT COUNT(*)::int c FROM bookings")).rows[0].c;
  console.log(`
  ──────────────────────────────────────────────────────────
   Cleano demo is ready.   Open  http://localhost:5173
  ──────────────────────────────────────────────────────────

   ${n} bookings seeded.  Log in as any of these — password  ${PW}

     customer@demo.hu     Nagy Péter          customer
     company@demo.hu      Debrecen Tiszta     company owner
     cleaner@demo.hu      Szabó Márk          cleaner
     admin@demo.hu        you                 CEO admin

   Worth looking at:
     · Company home — "Needs you": one job unaccepted with a live
       countdown, one starting in 6 hours with nobody assigned,
       one whose slot has already passed
     · Admin home   — "To invoice": finished jobs with the partner's
       tax number, address and the net/VAT split, and Copy details
     · Customer     — book the laundry service for the collection flow
     · Cleaner      — a collection job already on its way

   None of this touches your live data. It lives in memory and
   disappears the moment you close the window.
  `);
}
