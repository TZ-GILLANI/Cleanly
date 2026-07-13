/**
 * Cleanly — seed script
 * Run: node server/seed.js
 * Creates demo data and an admin account.
 */
import bcrypt from "bcryptjs";
import { query } from "./db.js";
import "dotenv/config";

async function seed() {
  console.log("🌱 Seeding Cleanly database…");

  const hash = (p) => bcrypt.hash(p, 10);

  /* ── Admin ─────────────────────────────────────────────── */
  const adminHash = await hash("admin123");
  await query(`
    INSERT INTO users (email, password_hash, role, full_name)
    VALUES ('admin@cleanly.hu', $1, 'admin', 'Platform Admin')
    ON CONFLICT (email) DO NOTHING
  `, [adminHash]);
  console.log("  ✓ Admin: admin@cleanly.hu / admin123");

  /* ── Company 1: SparkClean ──────────────────────────────── */
  const sparkHash = await hash("company123");
  const sparkOwner = await query(`
    INSERT INTO users (email, password_hash, role, full_name)
    VALUES ('spark@cleanly.hu', $1, 'company', 'SparkClean Admin')
    ON CONFLICT (email) DO NOTHING RETURNING id
  `, [sparkHash]);

  let sparkId = sparkOwner.rows[0]?.id;
  if (!sparkId) sparkId = (await query("SELECT id FROM users WHERE email = 'spark@cleanly.hu'")).rows[0].id;

  let co1Id = (await query("SELECT id FROM companies WHERE owner_id = $1", [sparkId])).rows[0]?.id;
  if (!co1Id) {
    const co1 = await query(`
      INSERT INTO companies (owner_id, name, emoji, tagline, area, student_discount, rating, review_count, cover, tax_id, reg_number, contact_phone)
      VALUES ($1, 'SparkClean Debrecen', '🌿', 'Eco-certified products, allergy-safe homes',
              'Egyetem · Vénkert', 15, 4.8, 158, 'linear-gradient(135deg,#22B573,#7BD96A)',
              'HU12345678', '09-09-123456', '+36 52 111 2222')
      RETURNING id
    `, [sparkId]);
    co1Id = co1.rows[0].id;
  }
  await query("UPDATE users SET company_id = $1 WHERE id = $2", [co1Id, sparkId]);
  console.log("  ✓ Company: SparkClean (spark@cleanly.hu / company123)");

  /* ── Company 2: Tiszta Otthon ───────────────────────────── */
  const tisztaHash = await hash("company123");
  const tisztaOwner = await query(`
    INSERT INTO users (email, password_hash, role, full_name)
    VALUES ('tiszta@cleanly.hu', $1, 'company', 'Tiszta Otthon Admin')
    ON CONFLICT (email) DO NOTHING RETURNING id
  `, [tisztaHash]);
  let tisztaId = tisztaOwner.rows[0]?.id;
  if (!tisztaId) tisztaId = (await query("SELECT id FROM users WHERE email = 'tiszta@cleanly.hu'")).rows[0].id;

  let co2Id = (await query("SELECT id FROM companies WHERE owner_id = $1", [tisztaId])).rows[0]?.id;
  if (!co2Id) {
    const co2 = await query(`
      INSERT INTO companies (owner_id, name, emoji, tagline, area, student_discount, rating, review_count, cover, tax_id, reg_number, contact_phone)
      VALUES ($1, 'Tiszta Otthon Kft.', '🫧', 'Debrecen''s most-booked team for student housing',
              'Belváros · Nagyerdő', 10, 4.9, 212, 'linear-gradient(135deg,#3D7BF5,#2BB8E8)',
              'HU87654321', '09-09-654321', '+36 52 333 4444')
      RETURNING id
    `, [tisztaId]);
    co2Id = co2.rows[0].id;
  }
  await query("UPDATE users SET company_id = $1 WHERE id = $2", [co2Id, tisztaId]);

  /* ── Employees ──────────────────────────────────────────── */
  const empHash = await hash("employee123");
  for (const [email, name, coId] of [
    ["eszter@cleanly.hu", "Eszter Kovács", co1Id],
    ["david@cleanly.hu", "Dávid Molnár", co1Id],
    ["anna@cleanly.hu", "Anna Szabó", co2Id],
    ["peter@cleanly.hu", "Péter Kiss", co2Id],
  ]) {
    await query(`
      INSERT INTO users (email, password_hash, role, full_name, company_id)
      VALUES ($1, $2, 'employee', $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [email, empHash, name, coId]);
  }
  console.log("  ✓ Employees: eszter / david / anna / peter @cleanly.hu / employee123");

  /* ── Demo customer ──────────────────────────────────────── */
  const custHash = await hash("customer123");
  await query(`
    INSERT INTO users (email, password_hash, role, full_name, customer_type)
    VALUES ('musa@cleanly.hu', $1, 'customer', 'Musa Gillani', 'student')
    ON CONFLICT (email) DO NOTHING
  `, [custHash]);
  console.log("  ✓ Customer: musa@cleanly.hu / customer123");

  /* ── Services (flat, hourly & subscription) ─────────────── */
  // [coId, name, desc, icon, price, mins, tasks, pricingType, hourlyRate, period]
  const services = [
    [co1Id, "Standard apartment clean", "Kitchen, bathroom, floors, dusting", "🏠", 15900, 120, ["Kitchen surfaces & sink", "Bathroom: toilet, shower, mirror", "Vacuum & mop all floors", "Dust shelves and surfaces", "Take out bins"], "flat", null, null],
    [co1Id, "Deep clean", "Appliances inside, limescale, grout, interior windows", "✨", 27900, 240, ["Everything in standard clean", "Inside oven & fridge", "Descale taps and shower", "Scrub tile grout", "Clean interior windows"], "flat", null, null],
    [co1Id, "Move-out clean", "Deposit-back guarantee with landlord checklist", "📦", 32900, 300, ["Full deep clean", "Inside all cupboards", "Walls: spot-clean marks", "Balcony sweep", "Photo report for landlord"], "flat", null, null],
    [co1Id, "Cleaning by the hour", "Flexible help — you choose how many hours", "⏱️", 0, 60, ["Whatever you need, prioritised by you", "Bring your own checklist"], "hourly", 4500, null],
    [co1Id, "Weekly upkeep plan", "A tidy home, automatically — every week", "🔁", 13900, 90, ["Kitchen & bathroom refresh", "Floors throughout", "Dusting & bins"], "subscription", null, "weekly"],
    [co2Id, "Dorm / room refresh", "Up to 25 m² — floors, surfaces, shared bathroom", "🛏️", 7900, 60, ["Floors & surfaces", "Shared bathroom refresh", "Bins out"], "flat", null, null],
    [co2Id, "Standard apartment clean", "Kitchen, bathroom, floors, dusting, bins out", "🏠", 14900, 120, ["Kitchen surfaces & sink", "Bathroom full clean", "Vacuum & mop", "Dusting", "Bins out"], "flat", null, null],
    [co2Id, "Hourly cleaning", "Pay only for the hours you book", "⏱️", 0, 60, ["Tailored to your space", "Great for top-ups between deep cleans"], "hourly", 3900, null],
    [co2Id, "Monthly deep plan", "One thorough deep clean every month", "🔁", 24900, 240, ["Full deep clean monthly", "Appliances inside", "Limescale & grout"], "subscription", null, "monthly"],
  ];

  for (const [coId, name, desc, icon, price, mins, tasks, ptype, hourly, period] of services) {
    const exists = await query("SELECT 1 FROM services WHERE company_id = $1 AND name = $2", [coId, name]);
    if (exists.rows.length) continue;
    await query(`
      INSERT INTO services (company_id, name, description, icon, price_huf, minutes, tasks, pricing_type, hourly_rate_huf, min_hours, max_hours, period)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [coId, name, desc, icon, price, mins, JSON.stringify(tasks), ptype, hourly, 2, 8, period]);
  }
  console.log("  ✓ Services seeded (flat + hourly + subscription)");

  /* ── Rich demo data: bookings, reviews, notices, invites ─── */
  const { rows: bc } = await query("SELECT COUNT(*)::int AS n FROM bookings");
  if (bc[0].n === 0) {
    // extra customers (so the platform looks populated)
    const custList = [
      ["sofia@unideb.hu", "Sofia M.", "student"],
      ["bence@unideb.hu", "Bence T.", "resident"],
      ["lilla@unideb.hu", "Lilla H.", "student"],
      ["mark@unideb.hu", "Márk R.", "resident"],
      ["dora@unideb.hu", "Dóra Sz.", "student"],
      ["gabor@unideb.hu", "Gábor N.", "resident"],
    ];
    const cust = {};
    for (const [email, name, type] of custList) {
      const r = await query(`INSERT INTO users (email,password_hash,role,full_name,customer_type) VALUES ($1,$2,'customer',$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id`, [email, custHash, name, type]);
      cust[email] = r.rows[0]?.id || (await query("SELECT id FROM users WHERE email=$1", [email])).rows[0].id;
    }
    const musaId = (await query("SELECT id FROM users WHERE email='musa@cleanly.hu'")).rows[0].id;

    // a 3rd company, pending approval → showcases the admin approve/suspend flow
    const klmHash = await hash("company123");
    const klmOwner = await query(`INSERT INTO users (email,password_hash,role,full_name) VALUES ('otthon@cleanly.hu',$1,'company','Klára Nagy') ON CONFLICT (email) DO NOTHING RETURNING id`, [klmHash]);
    const klmId = klmOwner.rows[0]?.id || (await query("SELECT id FROM users WHERE email='otthon@cleanly.hu'")).rows[0].id;
    const co3 = await query(`INSERT INTO companies (owner_id,name,emoji,tagline,area,student_discount,rating,review_count,cover,is_approved,is_listed) VALUES ($1,'Otthon Tündérek','🧚','Boutique home cleaning — just applied to join','Belváros',5,0,0,'linear-gradient(135deg,#F9731C,#FF5E8A)',false,true) RETURNING id`, [klmId]);
    await query("UPDATE users SET company_id=$1 WHERE id=$2", [co3.rows[0].id, klmId]);

    const emp = {};
    for (const e of ["eszter", "david", "anna", "peter"]) emp[e] = (await query("SELECT id FROM users WHERE email=$1", [e + "@cleanly.hu"])).rows[0].id;

    const svc1 = (await query("SELECT * FROM services WHERE company_id=$1 AND pricing_type='flat' ORDER BY price_huf", [co1Id])).rows;
    const svc2 = (await query("SELECT * FROM services WHERE company_id=$1 AND pricing_type='flat' ORDER BY price_huf", [co2Id])).rows;
    const snap = (s) => ({ id: s.id, name: s.name, description: s.description, icon: s.icon, price_huf: s.price_huf, minutes: s.minutes, tasks: s.tasks });
    const dISO = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const slots = ["08:00", "09:30", "11:00", "13:00", "15:00", "17:00"];
    const addrs = ["Egyetem tér 1", "Kassai út 26", "Piac utca 18", "Bem tér 9", "Nagyerdei krt 7", "Böszörményi út 44"];

    const mk = async (custId, custType, coId, s, daysAgo, status, assignedTo, note, i) => {
      const td = status === 4 ? (s.tasks || []).map((_, k) => k) : status >= 2 ? [0] : [];
      const r = await query(
        `INSERT INTO bookings (customer_id,company_id,service_id,service_snapshot,scheduled_date,scheduled_slot,address,note,customer_type,total_huf,status,assigned_to,tasks_done)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [custId, coId, s.id, JSON.stringify(snap(s)), dISO(daysAgo), slots[i % slots.length], addrs[i % addrs.length], note, custType, s.price_huf, status, assignedTo, JSON.stringify(td)]
      );
      return r.rows[0].id;
    };

    const custArr = Object.entries(cust);
    const doneIds = [];
    for (let i = 0; i < 12; i++) {
      const even = i % 2 === 0;
      const coId = even ? co1Id : co2Id;
      const arr = even ? svc1 : svc2;
      const s = arr[i % arr.length];
      const a = even ? (i % 4 === 0 ? emp.eszter : emp.david) : (i % 4 === 1 ? emp.anna : emp.peter);
      const [, cid] = custArr[i % custArr.length];
      const ctype = custList[i % custList.length][2];
      const id = await mk(cid, ctype, coId, s, 2 + i * 2, 4, a, null, i);
      doneIds.push({ id, co: coId, cid });
    }
    // active jobs (today/tomorrow)
    await mk(musaId, "student", co1Id, svc1[2], 0, 3, emp.eszter, "Landlord inspection at 16:00. Key under the mat.", 0);
    await mk(cust["bence@unideb.hu"], "resident", co1Id, svc1[0], 0, 2, emp.david, null, 1);
    await mk(cust["lilla@unideb.hu"], "student", co2Id, svc2[0], -1, 1, emp.anna, "Room 214", 2);
    // new unassigned (creates the company "needs a cleaner" alert)
    await mk(cust["mark@unideb.hu"], "resident", co1Id, svc1[1], 0, 0, null, "Buzzer broken — call on arrival.", 3);
    await mk(cust["dora@unideb.hu"], "student", co2Id, svc2[1], -1, 0, null, null, 4);
    // cancelled
    await mk(cust["gabor@unideb.hu"], "resident", co2Id, svc2[0], 3, 9, null, null, 5);

    const reviews = [
      [5, "Spotless in under an hour. Booked again the same week."],
      [5, "Eco products, no harsh smell — perfect for my allergies."],
      [4, "Fast and friendly, saved me before a flat inspection."],
      [5, "Best value for student housing in Debrecen."],
      [5, "The team was incredibly professional."],
      [4, "Great job — will rebook next month."],
    ];
    for (let i = 0; i < reviews.length && i < doneIds.length; i++) {
      const d = doneIds[i];
      await query(`INSERT INTO reviews (booking_id,company_id,customer_id,stars,body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (booking_id) DO NOTHING`, [d.id, d.co, d.cid, reviews[i][0], reviews[i][1]]);
    }

    await query(`INSERT INTO notices (company_id,to_employee,body,is_read) VALUES ($1,$2,$3,false)`, [co1Id, emp.eszter, "Please bring the HEPA vacuum tomorrow — allergy clean at 11:00."]);
    await query(`INSERT INTO notices (company_id,to_employee,body,is_read) VALUES ($1,$2,$3,false)`, [co1Id, emp.david, "Schedule change 🗓️ — your 09:30 moved to 11:00."]);
    await query(`INSERT INTO invite_codes (code,company_id,label) VALUES ('SPARK-7K4D',$1,'Zoltán Farkas') ON CONFLICT (code) DO NOTHING`, [co1Id]);

    console.log("  ✓ Bookings, reviews, notices & invites seeded");
  } else {
    console.log("  • Bookings already present — skipping rich demo data");
  }

  console.log("\n✅ Seed complete!\n");
  console.log("  Accounts to log in with:");
  console.log("  🔐 Admin:    admin@cleanly.hu    / admin123");
  console.log("  🏢 Company:  spark@cleanly.hu    / company123");
  console.log("  🏢 Company:  tiszta@cleanly.hu   / company123");
  console.log("  🧽 Employee: eszter@cleanly.hu   / employee123");
  console.log("  🛋️ Customer: musa@cleanly.hu     / customer123\n");

  process.exit(0);
}

seed().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
