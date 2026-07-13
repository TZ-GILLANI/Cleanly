import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, getToken, isApiMode } from "./lib/api.js";
import { getLang, saveLang, translate } from "./lib/i18n.js";

/* ════════════════════════════════════════════════════════════
   STORE — dual-mode
   • API MODE   (VITE_USE_API=true): calls Express backend with JWT
   • DEMO MODE  (default): localStorage seed data, no server needed
   Booking status: 0 new · 1 assigned · 2 on-way · 3 cleaning · 4 done · 9 cancelled
════════════════════════════════════════════════════════════ */

export { isApiMode as isLive };
const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);

/* ── Demo seed ───────────────────────────────────────────── */
const SEED_SERVICES = [
  { id: "s1", company_id: "co1", name: "Standard apartment clean", description: "Kitchen, bathroom, floors, dusting", icon: "🏠", price_huf: 15900, minutes: 120, is_active: true, pricing_type: "flat", tasks: ["Kitchen surfaces & sink", "Bathroom: toilet, shower, mirror", "Vacuum & mop all floors", "Dust shelves and surfaces", "Take out bins"] },
  { id: "s2", company_id: "co1", name: "Deep clean", description: "Appliances inside, limescale, grout, interior windows", icon: "✨", price_huf: 27900, minutes: 240, is_active: true, pricing_type: "flat", tasks: ["Everything in standard clean", "Inside oven & fridge", "Descale taps and shower", "Scrub tile grout", "Clean interior windows"] },
  { id: "s3", company_id: "co1", name: "Move-out clean", description: "Deposit-back guarantee with landlord checklist", icon: "📦", price_huf: 32900, minutes: 300, is_active: true, pricing_type: "flat", tasks: ["Full deep clean", "Inside all cupboards", "Walls: spot-clean marks", "Balcony sweep", "Photo report for landlord"] },
  { id: "s8", company_id: "co1", name: "Cleaning by the hour", description: "Flexible help — you choose how many hours", icon: "⏱️", price_huf: 0, hourly_rate_huf: 4500, min_hours: 2, max_hours: 8, minutes: 60, is_active: true, pricing_type: "hourly", tasks: ["Prioritised by you", "Bring your own checklist"] },
  { id: "s9", company_id: "co1", name: "Weekly upkeep plan", description: "A tidy home, automatically — every week", icon: "🔁", price_huf: 13900, period: "weekly", minutes: 90, is_active: true, pricing_type: "subscription", tasks: ["Kitchen & bathroom refresh", "Floors throughout", "Dusting & bins"] },
  { id: "s4", company_id: "co2", name: "Dorm / room refresh", description: "Up to 25 m² — floors, surfaces, shared bathroom", icon: "🛏️", price_huf: 7900, minutes: 60, is_active: true, pricing_type: "flat", tasks: ["Floors & surfaces", "Shared bathroom refresh", "Bins out"] },
  { id: "s5", company_id: "co2", name: "Standard apartment clean", description: "Kitchen, bathroom, floors, dusting, bins out", icon: "🏠", price_huf: 14900, minutes: 120, is_active: true, pricing_type: "flat", tasks: ["Kitchen surfaces & sink", "Bathroom full clean", "Vacuum & mop", "Dusting", "Bins out"] },
  { id: "s10", company_id: "co2", name: "Hourly cleaning", description: "Pay only for the hours you book", icon: "⏱️", price_huf: 0, hourly_rate_huf: 3900, min_hours: 2, max_hours: 8, minutes: 60, is_active: true, pricing_type: "hourly", tasks: ["Tailored to your space", "Great for top-ups"] },
  { id: "s11", company_id: "co2", name: "Monthly deep plan", description: "One thorough deep clean every month", icon: "🔁", price_huf: 24900, period: "monthly", minutes: 240, is_active: true, pricing_type: "subscription", tasks: ["Full deep clean monthly", "Appliances inside", "Limescale & grout"] },
  { id: "s12", company_id: "co4", name: "Standard apartment clean", description: "Kitchen, bathroom, floors, dusting", icon: "🏠", price_huf: 18900, minutes: 120, is_active: true, pricing_type: "flat", tasks: ["Kitchen surfaces & sink", "Bathroom full clean", "Vacuum & mop", "Dusting", "Bins out"] },
  { id: "s6", company_id: "co3", name: "Express tidy-up", description: "90-minute blitz before guests or inspections", icon: "⚡", price_huf: 9900, minutes: 90, is_active: true, pricing_type: "flat", tasks: ["Quick kitchen reset", "Bathroom refresh", "Vacuum main areas", "Tidy visible surfaces"] },
  { id: "s7", company_id: "co3", name: "Post-party recovery", description: "We've seen worse. Probably.", icon: "🎉", price_huf: 18900, minutes: 150, is_active: true, pricing_type: "flat", tasks: ["Bottle & waste collection", "Kitchen deep reset", "Bathroom rescue", "Floors throughout", "Air the place out"] },
];
const todayISO = new Date().toISOString().slice(0, 10);
const yestISO  = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const tomISO   = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const agoISO   = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* generated history → fills out earnings, ratings & the admin dashboard */
const _DISC  = { co1: 15, co2: 10, co3: 20, co4: 5 };
const _CUST  = ["Sofia M.", "Bence T.", "Lilla H.", "Márk R.", "Dóra Sz.", "Gábor N.", "Zsófia P.", "Tamás K.", "Réka V.", "Levente B.", "Nóra L.", "Ádám H.", "Kata B.", "Máté V.", "Hanna T.", "Dániel P."];
const _SLOTS = ["08:00", "09:30", "11:00", "13:00", "15:00", "17:00"];
const _ADDR  = ["Egyetem tér 1", "Kassai út 26", "Piac utca 18", "Bem tér 9", "Nagyerdei krt 7", "Böszörményi út 44", "Poroszlay út 12", "Hatvan utca 33"];
const _EMP   = { co1: ["e1", "e2"], co2: ["e3", "e4"], co3: ["e5"] };
const HIST = [2, 3, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 25, 27].map((d, i) => {
  const coId = ["co1", "co2", "co3"][i % 3];
  const svcs = SEED_SERVICES.filter((s) => s.company_id === coId && s.pricing_type === "flat");
  const svc = svcs[i % svcs.length];
  const pool = _EMP[coId];
  const isStudent = i % 3 === 0;
  const total = isStudent ? Math.round(svc.price_huf * (1 - _DISC[coId] / 100)) : svc.price_huf;
  return {
    id: "h" + (i + 1), customer_id: "ch" + (i + 1), customer_name: _CUST[i % _CUST.length],
    customer_type: isStudent ? "student" : "resident", company_id: coId, service_snapshot: svc,
    scheduled_date: agoISO(d), scheduled_slot: _SLOTS[i % _SLOTS.length], address: _ADDR[i % _ADDR.length],
    note: "", total_huf: total, status: 4, assigned_to: pool[i % pool.length],
    tasks_done: (svc.tasks || []).map((_, k) => k),
  };
});

const SEED = {
  companies: [
    { id: "co1", name: "SparkClean Debrecen", emoji: "🌿", tagline: "Eco-certified products, allergy-safe homes", area: "Egyetem · Vénkert", city: "Debrecen", student_discount: 15, rating: 4.8, review_count: 158, cover: "linear-gradient(135deg,#22B573,#7BD96A)", logo_url: null, tax_id: "HU12345678", reg_number: "09-09-123456", contact_phone: "+36 52 111 2222", owner_id: "owner1", owner_name: "Bálint Erdős", owner_email: "spark@cleanly.hu", is_approved: true, is_listed: true },
    { id: "co2", name: "Tiszta Otthon Kft.", emoji: "🫧", tagline: "Debrecen's most-booked team for student housing", area: "Belváros · Nagyerdő", city: "Debrecen", student_discount: 10, rating: 4.9, review_count: 212, cover: "linear-gradient(135deg,#3D7BF5,#2BB8E8)", logo_url: null, tax_id: "HU87654321", reg_number: "09-09-654321", contact_phone: "+36 52 333 4444", owner_id: "owner2", owner_name: "Tímea Varga", owner_email: "tiszta@cleanly.hu", is_approved: true, is_listed: true },
    { id: "co4", name: "Budai Blitz Kft.", emoji: "🏙️", tagline: "Fast, insured teams across Buda and Pest", area: "II. · V. · XIII. kerület", city: "Budapest", student_discount: 12, rating: 4.6, review_count: 41, cover: "linear-gradient(135deg,#FF8A5C,#FFB44D)", logo_url: null, tax_id: "HU11223344", reg_number: "01-09-112233", contact_phone: "+36 1 555 7788", owner_id: "owner4", owner_name: "Dóra Kiss", owner_email: "budai@cleanly.hu", is_approved: true, is_listed: true },
    { id: "co3", name: "Fürge Polip Cleaning", emoji: "🐙", tagline: "Same-day rescue squad — eight arms, zero excuses", area: "All Debrecen", city: "Debrecen", student_discount: 20, rating: 4.7, review_count: 94, cover: "linear-gradient(135deg,#7B4DE0,#B388FF)", logo_url: null, tax_id: "HU55667788", reg_number: "09-09-778899", contact_phone: "+36 52 555 6666", owner_id: "owner3", owner_name: "Zoltán Pap", owner_email: "polip@cleanly.hu", is_approved: true, is_listed: true },
    { id: "co4", name: "Otthon Tündérek", emoji: "🧚", tagline: "Boutique home cleaning — just applied to join", area: "Belváros", student_discount: 5, rating: 0, review_count: 0, cover: "linear-gradient(135deg,#F9731C,#FF5E8A)", logo_url: null, tax_id: "HU99887766", reg_number: "09-09-112233", contact_phone: "+36 30 777 8888", owner_id: "owner4", owner_name: "Klára Nagy", owner_email: "otthon@cleanly.hu", is_approved: false, is_listed: true },
  ],
  services: SEED_SERVICES,
  employees: [
    { id: "e1", full_name: "Eszter Kovács", role: "employee", company_id: "co1", phone: "+36 30 111 2233", is_active: true, title: "Senior cleaner" },
    { id: "e2", full_name: "Dávid Molnár",  role: "employee", company_id: "co1", phone: "+36 30 444 5566", is_active: true, title: "Cleaner" },
    { id: "e3", full_name: "Anna Szabó",     role: "employee", company_id: "co2", phone: "+36 20 777 8899", is_active: true, title: "Senior cleaner" },
    { id: "e4", full_name: "Péter Kiss",     role: "employee", company_id: "co2", phone: "+36 30 321 4567", is_active: true, title: "Cleaner" },
    { id: "e5", full_name: "Réka Tóth",      role: "employee", company_id: "co3", phone: "+36 70 222 3344", is_active: true, title: "Cleaner" },
  ],
  bookings: [
    { id: "b1", customer_id: "dc1", customer_name: "Sofia M.", customer_type: "student", company_id: "co1", service_snapshot: SEED_SERVICES[2], scheduled_date: todayISO, scheduled_slot: "09:00", address: "Bem tér 4, 2/5", note: "Key under mat. Landlord inspection at 16:00.", total_huf: 27965, status: 1, assigned_to: "e1", tasks_done: [0, 1] },
    { id: "b2", customer_id: "dc2", customer_name: "János F.", customer_type: "resident", company_id: "co1", service_snapshot: SEED_SERVICES[0], scheduled_date: tomISO, scheduled_slot: "11:00", address: "Piac utca 52, 1/3", note: "", total_huf: 15900, status: 0, assigned_to: null, tasks_done: [] },
    { id: "b3", customer_id: "dc3", customer_name: "Petra V.", customer_type: "resident", company_id: "co1", service_snapshot: SEED_SERVICES[0], scheduled_date: yestISO, scheduled_slot: "09:00", address: "Arany János utca 14", note: "", total_huf: 15900, status: 4, assigned_to: "e1", tasks_done: [0, 1, 2, 3, 4] },
    { id: "b4", customer_id: "dc4", customer_name: "Anna K.", customer_type: "student", company_id: "co2", service_snapshot: SEED_SERVICES[3], scheduled_date: todayISO, scheduled_slot: "13:00", address: "Böszörményi út 138", note: "Room 214", total_huf: 7110, status: 1, assigned_to: "e3", tasks_done: [] },
    { id: "b5", customer_id: "dc5", customer_name: "Gergő T.", customer_type: "resident", company_id: "co3", service_snapshot: SEED_SERVICES[6], scheduled_date: todayISO, scheduled_slot: "17:00", address: "Simonffy utca 4/A", note: "Buzzer broken — call on arrival.", total_huf: 18900, status: 0, assigned_to: null, tasks_done: [] },
    { id: "b6", customer_id: "dc6", customer_name: "Móni R.", customer_type: "student", company_id: "co3", service_snapshot: SEED_SERVICES[5], scheduled_date: tomISO, scheduled_slot: "11:00", address: "Egyetem sugárút 7", note: "", total_huf: 7920, status: 1, assigned_to: "e5", tasks_done: [] },
    ...HIST,
  ],
  notices: [
    { id: "n1", company_id: "co1", to_employee: "e1", body: "Please bring the HEPA vacuum tomorrow — allergy clean at 11:00.", is_read: true, created_at: "Yesterday 18:40" },
    { id: "n2", company_id: "co1", to_employee: "e2", body: "Schedule change tomorrow 🗓️ — your 09:30 moved to 11:00.", is_read: false, created_at: "Today 08:15" },
  ],
  invites: [],
  complaints: [
    { id: "cp1", user_id: "demo-customer", user_name: "Musa (minta)", booking_id: null, subject: "App feedback", body: "Great app! Would love evening slots after 19:00.", status: "open", resolution: null, created_at: new Date(Date.now() - 5 * 3600e3).toISOString() },
  ],
  reviews: [
    { id: "r1", company_id: "co1", booking_id: "b3", customer_name: "Petra V.", stars: 5, body: "Spotless in under an hour. Booked again the same week.", created_at: "Yesterday" },
    { id: "r2", company_id: "co2", booking_id: "bx", customer_name: "Bence T.", stars: 5, body: "The team was incredibly professional.", created_at: "3 days ago" },
    { id: "r3", company_id: "co1", booking_id: "h1", customer_name: "Sofia M.", stars: 5, body: "Eco products, no harsh smell — perfect for my allergies.", created_at: "Last week" },
    { id: "r4", company_id: "co3", booking_id: "h3", customer_name: "Márk R.", stars: 4, body: "Saved me before a flat inspection. Fast and friendly.", created_at: "Last week" },
    { id: "r5", company_id: "co2", booking_id: "h2", customer_name: "Lilla H.", stars: 5, body: "Best value for student housing in Debrecen.", created_at: "2 weeks ago" },
  ],
  userStatus: {},
};

const LS_KEY = "cleanly-demo-v5";
const loadDemo = () => { try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch {} return JSON.parse(JSON.stringify(SEED)); };
const uid = () => "id" + Date.now() + Math.floor(Math.random() * 1e4);
const nowLabel = () => new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// Robust invite / reference code: WORD-XXXX, fixed length, unambiguous characters.
const inviteCode = () => {
  const words = ["SPARK", "CLEAN", "FRESH", "MINT", "SHINE", "GLEAM", "CRISP", "PURE"];
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return words[Math.floor(Math.random() * words.length)] + "-" + s;
};

/* ── Demo-mode admin analytics (computed from local db) ──── */
const _slug = (s = "") => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "");
const _coName = (db, id) => db.companies.find((c) => c.id === id)?.name || null;

function demoAdminUsers(db) {
  const st = db.userStatus || {};
  const out = [];
  db.companies.forEach((c) => out.push({
    id: c.owner_id, full_name: c.owner_name || `${c.name} owner`, email: c.owner_email || `${_slug(c.name)}@cleanly.hu`,
    role: "company", company_name: c.name, is_active: st[c.owner_id] !== false,
  }));
  db.employees.forEach((e) => out.push({
    id: e.id, full_name: e.full_name, email: `${_slug(e.full_name)}@cleanly.hu`,
    role: "employee", company_name: _coName(db, e.company_id),
    is_active: e.id in st ? st[e.id] : e.is_active !== false,
  }));
  const seen = new Set();
  db.bookings.forEach((b) => {
    if (b.customer_id && !seen.has(b.customer_id)) {
      seen.add(b.customer_id);
      out.push({
        id: b.customer_id, full_name: b.customer_name || "Customer", email: `${_slug(b.customer_name || "customer")}@stud.unideb.hu`,
        role: "customer", company_name: null, is_active: st[b.customer_id] !== false,
      });
    }
  });
  return out;
}

function demoAdminStats(db) {
  const completed = db.bookings.filter((b) => b.status === 4);
  const bookingsByStatus = {};
  db.bookings.forEach((b) => { bookingsByStatus[b.status] = (bookingsByStatus[b.status] || 0) + 1; });
  return {
    totalUsers: demoAdminUsers(db).length,
    totalCompanies: db.companies.length,
    totalBookings: db.bookings.length,
    completedBookings: completed.length,
    activeBookings: (bookingsByStatus[1] || 0) + (bookingsByStatus[2] || 0) + (bookingsByStatus[3] || 0),
    totalRevenue: completed.reduce((a, b) => a + (b.total_huf || 0), 0),
    bookingsByStatus,
  };
}

function demoAdminRevenue(db) {
  const map = {};
  db.bookings.filter((b) => b.status === 4).forEach((b) => { map[b.scheduled_date] = (map[b.scheduled_date] || 0) + (b.total_huf || 0); });
  const cutoff = Date.now() - 30 * 864e5;
  return Object.entries(map)
    .filter(([d]) => new Date(d + "T00:00:00").getTime() >= cutoff)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, revenue]) => ({ date, revenue }));
}

function demoAdminCompanies(db) {
  return db.companies.map((c) => ({
    ...c,
    owner_name: c.owner_name || `${c.name} owner`,
    owner_email: c.owner_email || `${_slug(c.name)}@cleanly.hu`,
    booking_count: db.bookings.filter((b) => b.company_id === c.id).length,
    revenue: db.bookings.filter((b) => b.company_id === c.id && b.status === 4).reduce((a, b) => a + (b.total_huf || 0), 0),
  }));
}

function demoAdminBookings(db) {
  return [...db.bookings]
    .sort((a, b) => (a.scheduled_date < b.scheduled_date ? 1 : -1))
    .map((b) => ({ ...b, company_name: _coName(db, b.company_id) || "Company", company_emoji: db.companies.find((c) => c.id === b.company_id)?.emoji || "🏢" }));
}

/* ════════════════════════════════════════════════════════════
   PROVIDER
════════════════════════════════════════════════════════════ */

export function StoreProvider({ children }) {
  const [session, setSession] = useState(null);
  // API mode must never show demo seed data — start empty and fill from the server.
  const EMPTY_DB = { companies: [], services: [], employees: [], bookings: [], notices: [], invites: [], reviews: [], complaints: [], userStatus: {} };
  const [db, setDb]           = useState(() => (isApiMode ? EMPTY_DB : loadDemo()));
  const [loading, setLoading] = useState(isApiMode);
  const [error, setError]     = useState(null);
  /* admin caches — API mode only (demo mode derives these from db) */
  const [adminApi, setAdminApi] = useState({ stats: null, revenue: null, companies: null, users: null, bookings: null });
  /* language (en | hu) — persisted, synced to a customer's profile when they change it */
  const [lang, setLangState] = useState(getLang);
  const t = (key, vars) => translate(lang, key, vars);
  const setLang = (l) => { setLangState(l); saveLang(l); if (session?.role === "customer") updateProfile({ lang: l }); };

  /* persist demo db */
  useEffect(() => {
    if (!isApiMode) try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch {}
  }, [db]);

  /* adopt a logged-in user's saved language */
  useEffect(() => {
    if (session?.lang && session.lang !== lang) { setLangState(session.lang); saveLang(session.lang); }
  }, [session?.lang]);

  /* ── API mode: restore session from saved token ─────────── */
  const loadFromApi = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    setLoading(true);
    try {
      const { user } = await api("/auth/me");
      const sess = buildSession(user);
      await loadAllData(sess);   // data first, session second — never render a logged-in shell over empty/stale data
      setSession(sess);
    } catch {
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isApiMode) loadFromApi(); }, [loadFromApi]);

  const buildSession = (user) => ({
    role: user.role, userId: user.id, name: user.full_name,
    email: user.email, custType: user.customer_type,
    companyId: user.company_id, phone: user.phone,
    address: user.address || "", paymentMethod: user.payment_method || "cash", lang: user.lang || "en",
    documents: user.documents || [],
  });

  const loadAllData = useCallback(async (sess) => {
    const next = { companies: [], services: [], employees: [], bookings: [], notices: [], invites: [], reviews: [] };
    const [companies, services, reviews] = await Promise.all([
      api("/companies"),
      api("/services"),
      api("/reviews"),
    ]);
    next.companies = companies.companies;
    next.services  = services.services;
    next.reviews   = reviews.reviews;

    if (sess.role === "customer") {
      const { bookings } = await api("/bookings");
      next.bookings = bookings;
    }
    if (sess.role === "employee") {
      const [{ bookings }, { notices }] = await Promise.all([
        api("/bookings"),
        api("/notices"),
      ]);
      next.bookings = bookings; next.notices = notices;
    }
    if (sess.role === "company") {
      const [{ bookings }, { employees }, { invites }, { notices }, { services: ownSvcs }, own] = await Promise.all([
        api("/bookings"),
        api("/employees"),
        api("/employees/invites"),
        api("/notices"),
        api("/services/company/" + sess.companyId),
        api("/companies/" + sess.companyId).catch(() => null), // own row — even while pending approval
      ]);
      next.bookings = bookings; next.employees = employees;
      next.invites = invites; next.notices = notices;
      // merge own (incl. hidden) services
      next.services = [...services.services.filter(s => s.company_id !== sess.companyId), ...ownSvcs];
      // the public list excludes unapproved companies — make sure our own is present
      if (own?.company && !next.companies.some(c => c.id === own.company.id)) next.companies = [own.company, ...next.companies];
      else if (own?.company) next.companies = next.companies.map(c => c.id === own.company.id ? own.company : c);
    }
    if (sess.role === "admin") {
      const { bookings } = await api("/bookings");
      next.bookings = bookings;
    }
    setDb(next);
  }, []);

  const patchBooking = (id, patch) =>
    setDb(d => ({ ...d, bookings: d.bookings.map(b => b.id === id ? { ...b, ...patch } : b) }));

  /* ════════════ AUTH ════════════ */

  const signupCustomer = async ({ name, email, password, custType, address }) => {
    if (!isApiMode) { setSession({ role: "customer", userId: "demo-customer", name, custType, companyId: null, address: address || "" }); return {}; }
    try {
      const { token, user } = await api("/auth/register", { method: "POST", body: { email, password, role: "customer", fullName: name, customerType: custType || "resident", address } });
      setToken(token);
      const sess = buildSession(user);
      try { await loadAllData(sess); } catch (e) { setToken(null); return { error: "Could not load your data — " + e.message }; }
      setSession(sess); return {};
    } catch (e) { return { error: e.message }; }
  };

  const signupCompany = async ({ companyName, name, email, password, taxId, regNumber, contactPhone, documents, city }) => {
    if (!isApiMode) { setSession({ role: "company", userId: "owner1", name: name || "Bálint Erdős", custType: null, companyId: "co1" }); return {}; }
    try {
      const { token, user } = await api("/auth/register", { method: "POST", body: { email, password, role: "company", fullName: name || companyName, companyName, taxId, regNumber, contactPhone, documents, city } });
      setToken(token);
      const sess = buildSession(user);
      try { await loadAllData(sess); } catch (e) { setToken(null); return { error: "Could not load your data — " + e.message }; }
      setSession(sess); return {};
    } catch (e) { return { error: e.message }; }
  };

  const signupEmployee = async ({ name, email, password, code, documents, address }) => {
    if (!isApiMode) { setSession({ role: "employee", userId: "e1", name: "Eszter Kovács", custType: null, companyId: "co1" }); return {}; }
    try {
      const { token, user } = await api("/auth/register", { method: "POST", body: { email, password, role: "employee", fullName: name, inviteCode: code, documents, address } });
      setToken(token);
      const sess = buildSession(user);
      try { await loadAllData(sess); } catch (e) { setToken(null); return { error: "Could not load your data — " + e.message }; }
      setSession(sess); return {};
    } catch (e) { return { error: e.message }; }
  };

  const login = async ({ email, password }) => {
    if (!isApiMode) return { error: "Demo mode — use the sign-up buttons instead." };
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { email, password } });
      setToken(token);
      const sess = buildSession(user);
      try { await loadAllData(sess); } catch (e) { setToken(null); return { error: "Could not load your data — " + e.message }; }
      setSession(sess); return {};
    } catch (e) { return { error: e.message }; }
  };

  const logout = () => {
    setToken(null);
    setSession(null);
    setDb(isApiMode ? EMPTY_DB : loadDemo());
    setAdminApi({ stats: null, revenue: null, companies: null, users: null, bookings: null });
  };

  /* ════════════ PROFILE ════════════ */

  const updateProfile = async ({ full_name, phone, customer_type, address, payment_method, lang, documents } = {}) => {
    if (isApiMode) {
      try {
        const { user } = await api("/auth/profile", { method: "PUT", body: { fullName: full_name, phone, customerType: customer_type, address, paymentMethod: payment_method, lang, documents } });
        setSession(s => ({ ...s, name: user.full_name, phone: user.phone, custType: user.customer_type, address: user.address || "", paymentMethod: user.payment_method || "cash", lang: user.lang || s.lang, documents: user.documents || [] }));
        if (session?.role === "employee") {
          setDb(d => ({ ...d, employees: d.employees.map(e => e.id === session.userId ? { ...e, full_name: user.full_name, phone: user.phone } : e) }));
        }
        return {};
      } catch (e) { return { error: e.message }; }
    }
    setSession(s => ({ ...s,
      ...(full_name !== undefined ? { name: full_name } : {}),
      ...(customer_type !== undefined ? { custType: customer_type } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(payment_method !== undefined ? { paymentMethod: payment_method } : {}),
      ...(lang !== undefined ? { lang } : {}),
      ...(documents !== undefined ? { documents } : {}),
    }));
    if (session?.role === "employee") setDb(d => ({ ...d, employees: d.employees.map(e => e.id === session.userId ? { ...e, full_name: full_name ?? e.full_name, phone: phone ?? e.phone } : e) }));
    return {};
  };

  const changePassword = async (currentPassword, newPassword) => {
    if (!isApiMode) return { error: "Password change not available in demo mode" };
    try { await api("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }); return {}; }
    catch (e) { return { error: e.message }; }
  };

  /* ════════════ COMPANY PROFILE ════════════ */

  const updateCompany = async (fields) => {
    if (isApiMode) {
      try {
        const { company } = await api("/companies/" + session.companyId, { method: "PUT", body: { name: fields.name, emoji: fields.emoji, tagline: fields.tagline, area: fields.area, studentDiscount: fields.student_discount, cover: fields.cover, logoUrl: fields.logo_url, taxId: fields.tax_id, regNumber: fields.reg_number, contactPhone: fields.contact_phone, city: fields.city } });
        setDb(d => ({ ...d, companies: d.companies.map(c => c.id === session.companyId ? company : c) }));
        return {};
      } catch (e) { return { error: e.message }; }
    }
    setDb(d => ({ ...d, companies: d.companies.map(c => c.id === session.companyId ? { ...c, ...fields } : c) }));
    return {};
  };

  /* ════════════ CUSTOMER ACTIONS ════════════ */

  const createBooking = async (b) => {
    if (isApiMode) {
      try {
        // the server derives snapshot, pricing type, period and TOTAL from the service row — clients can't set prices
        const { booking } = await api("/bookings", { method: "POST", body: { companyId: b.companyId, serviceId: b.service.id, scheduledDate: b.date, scheduledSlot: b.slot, address: b.address, note: b.note, hours: b.hours || null } });
        setDb(d => ({ ...d, bookings: [booking, ...d.bookings] }));
        return booking;
      } catch (e) { setError(e.message); return null; }
    }
    if ((b.pricingType || b.service.pricing_type) === "subscription") {
      const dup = db.bookings.some(x => x.customer_id === session.userId && x.service_snapshot?.id === b.service.id && x.pricing_type === "subscription" && x.status >= 0 && x.status <= 3);
      if (dup) { setError(getLang() === "hu" ? "Már van aktív előfizetésed erre a szolgáltatásra — előbb mondd le a Foglalásoknál." : "You already have an active subscription for this service — cancel it first under Bookings."); return null; }
    }
    const row = { id: uid(), customer_id: session.userId, customer_name: session.name, customer_type: session.custType, company_id: b.companyId, service_snapshot: b.service, scheduled_date: b.date, scheduled_slot: b.slot, address: b.address, note: b.note, total_huf: b.total, pricing_type: b.pricingType || b.service.pricing_type || "flat", hours: b.hours || null, period: b.period || b.service.period || null, status: 0, assigned_to: null, tasks_done: [], created_at: nowLabel() };
    setDb(d => ({ ...d, bookings: [row, ...d.bookings] }));
    return row;
  };

  /* ── Card payments (Barion, API mode only) ── */
  const startPayment = async (bookingId) => {
    if (!isApiMode) return { error: "demo" };
    try { return await api("/payments/start", { method: "POST", body: { bookingId } }); }
    catch (e) { return { error: e.message }; }
  };
  const getPaymentStatus = async (bookingId) => {
    if (!isApiMode) return "unpaid";
    try { const r = await api("/payments/status/" + bookingId); return r.paymentStatus; }
    catch { return "unpaid"; }
  };

  /* ── GDPR / app-store account deletion ── */
  const deleteAccount = async () => {
    if (isApiMode) {
      try { await api("/auth/me", { method: "DELETE" }); }
      catch (e) { setError(e.message); return false; }
    }
    logout();
    return true;
  };

  const cancelBooking = async (id) => {
    if (isApiMode) { try { await api("/bookings/" + id + "/status", { method: "PUT", body: { status: 9 } }); } catch (e) { setError(e.message); return; } }
    patchBooking(id, { status: 9 });
  };

  const addReview = async ({ bookingId, companyId, stars, body }) => {
    if (isApiMode) {
      try {
        const { review } = await api("/reviews", { method: "POST", body: { bookingId, companyId, stars, body } });
        setDb(d => ({ ...d, reviews: [{ ...review, customer_name: session.name }, ...d.reviews] }));
        return;
      } catch (e) { setError(e.message); return; }
    }
    setDb(d => ({
      ...d,
      reviews: [{ id: uid(), booking_id: bookingId, company_id: companyId, customer_name: session.name, stars, body, created_at: nowLabel() }, ...d.reviews],
      companies: d.companies.map(c => c.id === companyId ? { ...c, review_count: c.review_count + 1, rating: Math.round(((c.rating * c.review_count + stars) / (c.review_count + 1)) * 10) / 10 } : c),
    }));
  };

  /* ════════════ EMPLOYEE ACTIONS ════════════ */

  const taskTimers = React.useRef({});
  const toggleTask = (bookingId, idx) => {
    // optimistic + functional: rapid taps each compute from the freshest state (no lost updates)
    let latest;
    setDb(d => {
      const b = d.bookings.find(x => x.id === bookingId);
      if (!b) return d;
      const cur = b.tasks_done || [];
      latest = cur.includes(idx) ? cur.filter(i => i !== idx) : [...cur, idx];
      return { ...d, bookings: d.bookings.map(x => x.id === bookingId ? { ...x, tasks_done: latest } : x) };
    });
    if (isApiMode) {
      // debounce the PUT so a burst of taps sends one final array
      clearTimeout(taskTimers.current[bookingId]);
      taskTimers.current[bookingId] = setTimeout(() => {
        if (latest) api("/bookings/" + bookingId + "/tasks", { method: "PUT", body: { tasksDone: latest } }).catch(e => setError(e.message));
      }, 350);
    }
  };

  /* advance YYYY-MM-DD by one subscription period (weekly/biweekly/monthly) */
  const nextOccurrence = (dateStr, period) => {
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    const next = period === "weekly" ? new Date(y, m - 1, d + 7)
      : period === "biweekly" ? new Date(y, m - 1, d + 14)
      : new Date(y, m, Math.min(d, 28));
    const p = (n) => String(n).padStart(2, "0");
    return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`;
  };

  const setStatus = async (bookingId, status) => {
    if (isApiMode) {
      try {
        const { booking, next } = await api("/bookings/" + bookingId + "/status", { method: "PUT", body: { status } });
        setDb(d => ({ ...d, bookings: [...(next ? [next] : []), ...d.bookings.map(x => x.id === bookingId ? booking : x)] }));
      } catch (e) { setError(e.message); }
      return;
    }
    // demo: completing a subscription visit schedules the next one automatically
    setDb(d => {
      const b = d.bookings.find(x => x.id === bookingId);
      let bookings = d.bookings.map(x => x.id === bookingId ? { ...x, status } : x);
      if (b && status === 4 && b.status !== 4 && b.pricing_type === "subscription" && b.period) {
        const nd = nextOccurrence(b.scheduled_date, b.period);
        const dupe = bookings.some(x => x.customer_id === b.customer_id && x.service_snapshot?.id === b.service_snapshot?.id && x.pricing_type === "subscription" && x.scheduled_date === nd && x.status !== 8 && x.status !== 9);
        if (!dupe) bookings = [{ ...b, id: uid(), scheduled_date: nd, status: b.assigned_to ? 1 : 0, tasks_done: [], payment_status: "unpaid", created_at: nowLabel() }, ...bookings];
      }
      return { ...d, bookings };
    });
  };

  // Company declines a booking → status 8 ("Declined"), with an optional reason.
  const declineBooking = async (bookingId, reason) => {
    if (isApiMode) { try { await api("/bookings/" + bookingId + "/status", { method: "PUT", body: { status: 8, declineReason: reason } }); } catch (e) { setError(e.message); return; } }
    patchBooking(bookingId, { status: 8, decline_reason: reason });
  };

  const markNoticeRead = async (id) => {
    if (isApiMode) { try { await api("/notices/" + id + "/read", { method: "PUT" }); } catch (e) { setError(e.message); return; } }
    setDb(d => ({ ...d, notices: d.notices.map(n => n.id === id ? { ...n, is_read: true } : n) }));
  };

  /* ════════════ COMPANY ACTIONS ════════════ */

  const assignBooking = async (bookingId, employeeId) => {
    if (isApiMode) { try { const { booking } = await api("/bookings/" + bookingId + "/assign", { method: "PUT", body: { employeeId } }); patchBooking(bookingId, { assigned_to: booking.assigned_to, status: booking.status }); return; } catch (e) { setError(e.message); return; } }
    const b = db.bookings.find(x => x.id === bookingId);
    patchBooking(bookingId, { assigned_to: employeeId, status: Math.max(b.status, 1) });
  };

  const createInvite = async (label) => {
    if (isApiMode) {
      try { const { invite } = await api("/employees/invites", { method: "POST", body: { label } }); setDb(d => ({ ...d, invites: [invite, ...d.invites] })); return invite.code; }
      catch (e) { setError(e.message); return null; }
    }
    const code = inviteCode();
    setDb(d => ({ ...d, invites: [{ code, label, used_by: null, created_at: nowLabel() }, ...d.invites] }));
    return code;
  };

  const deleteInvite = async (code) => {
    if (isApiMode) { try { await api("/employees/invites/" + code, { method: "DELETE" }); } catch (e) { setError(e.message); return; } }
    setDb(d => ({ ...d, invites: d.invites.filter(i => i.code !== code) }));
  };

  const sendNotice = async (employeeId, body) => {
    if (isApiMode) {
      try { const { notice } = await api("/notices", { method: "POST", body: { toEmployee: employeeId, body } }); setDb(d => ({ ...d, notices: [notice, ...d.notices] })); return; }
      catch (e) { setError(e.message); return; }
    }
    setDb(d => ({ ...d, notices: [{ id: uid(), company_id: session.companyId, to_employee: employeeId, body, is_read: false, created_at: nowLabel() }, ...d.notices] }));
  };

  const upsertService = async (svc) => {
    if (isApiMode) {
      try {
        const body = { name: svc.name, description: svc.description, icon: svc.icon, priceHuf: svc.price_huf, minutes: svc.minutes, tasks: svc.tasks, isActive: svc.is_active, pricingType: svc.pricing_type, hourlyRateHuf: svc.hourly_rate_huf, minHours: svc.min_hours, maxHours: svc.max_hours, period: svc.period };
        if (svc.id) {
          const { service } = await api("/services/" + svc.id, { method: "PUT", body });
          setDb(d => ({ ...d, services: d.services.map(s => s.id === svc.id ? service : s) }));
        } else {
          const { service } = await api("/services", { method: "POST", body });
          setDb(d => ({ ...d, services: [...d.services, service] }));
        }
        return;
      } catch (e) { setError(e.message); return; }
    }
    setDb(d => ({
      ...d,
      services: svc.id
        ? d.services.map(s => s.id === svc.id ? { ...s, ...svc } : s)
        : [...d.services, { ...svc, id: uid(), company_id: session.companyId, is_active: true }],
    }));
  };

  /* ════════════ ADMIN ACTIONS ════════════
     In demo mode the admin views are derived from `db` (see value object),
     so the fetch* functions are no-ops and the mutations just patch `db`. */

  const adminUpdateCompany = async (id, patch) => {
    if (!isApiMode) {
      setDb(d => ({ ...d, companies: d.companies.map(c => c.id === id ? { ...c, ...patch } : c) }));
      return {};
    }
    try {
      const { company } = await api("/admin/companies/" + id, { method: "PUT", body: { isApproved: patch.is_approved, isListed: patch.is_listed } });
      setDb(d => ({ ...d, companies: d.companies.map(c => c.id === id ? company : c) }));
      setAdminApi(a => ({ ...a, companies: a.companies?.map(c => c.id === id ? { ...c, ...company } : c) ?? null }));
      return {};
    } catch (e) { return { error: e.message }; }
  };

  /* ── Complaints (customer submit + admin manage) ── */
  const submitComplaint = async ({ bookingId, subject, body }) => {
    if (!isApiMode) {
      setDb(d => ({ ...d, complaints: [{ id: uid(), user_id: session.userId, user_name: session.name, booking_id: bookingId || null, subject, body, status: "open", resolution: null, created_at: new Date().toISOString() }, ...(d.complaints || [])] }));
      return {};
    }
    try { await api("/complaints", { method: "POST", body: { bookingId, subject, body } }); return {}; }
    catch (e) { return { error: e.message }; }
  };
  const adminFetchComplaints = async () => {
    if (!isApiMode) return;
    try { const { complaints } = await api("/complaints"); setAdminApi(a => ({ ...a, complaints })); }
    catch (e) { setError(e.message); }
  };
  const adminUpdateComplaint = async (id, patch) => {
    if (!isApiMode) {
      setDb(d => ({ ...d, complaints: (d.complaints || []).map(c => c.id === id ? { ...c, ...patch } : c) }));
      return {};
    }
    try {
      const { complaint } = await api("/complaints/" + id, { method: "PUT", body: patch });
      setAdminApi(a => ({ ...a, complaints: a.complaints?.map(c => c.id === id ? complaint : c) ?? null }));
      return {};
    } catch (e) { return { error: e.message }; }
  };

  const adminUpdateUser = async (id, patch) => {
    if (!isApiMode) {
      if (patch.makeAdmin !== undefined) return {}; // role changes only apply in API mode
      setDb(d => ({
        ...d,
        userStatus: { ...(d.userStatus || {}), [id]: patch.is_active },
        employees: d.employees.map(e => e.id === id ? { ...e, is_active: patch.is_active } : e),
      }));
      return {};
    }
    try {
      await api("/admin/users/" + id, { method: "PUT", body: patch.makeAdmin !== undefined ? { makeAdmin: patch.makeAdmin } : { isActive: patch.is_active } });
      setAdminApi(a => ({ ...a, users: a.users?.map(u => u.id === id ? { ...u, is_active: patch.is_active } : u) ?? null }));
      return {};
    } catch (e) { return { error: e.message }; }
  };

  const adminFetchStats = async () => {
    if (!isApiMode) return demoAdminStats(db);
    try { const { stats } = await api("/admin/stats"); setAdminApi(a => ({ ...a, stats })); return stats; }
    catch (e) { setError(e.message); return null; }
  };
  const adminFetchUsers = async () => {
    if (!isApiMode) return demoAdminUsers(db);
    try { const { users } = await api("/admin/users"); setAdminApi(a => ({ ...a, users })); return users; }
    catch (e) { setError(e.message); return null; }
  };
  const adminFetchRevenue = async () => {
    if (!isApiMode) return demoAdminRevenue(db);
    try { const { revenue } = await api("/admin/revenue"); setAdminApi(a => ({ ...a, revenue })); return revenue; }
    catch (e) { setError(e.message); return null; }
  };
  const adminFetchAllCompanies = async () => {
    if (!isApiMode) return demoAdminCompanies(db);
    try { const { companies } = await api("/admin/companies"); setAdminApi(a => ({ ...a, companies })); return companies; }
    catch (e) { setError(e.message); return null; }
  };
  const adminFetchAllBookings = async () => {
    if (!isApiMode) return demoAdminBookings(db);
    try { const { bookings } = await api("/admin/bookings"); setAdminApi(a => ({ ...a, bookings })); return bookings; }
    catch (e) { setError(e.message); return null; }
  };

  /* employees filtered to current company in demo mode */
  const visibleEmployees = isApiMode ? db.employees : db.employees.filter(e => e.company_id === (session?.companyId || null));

  const value = {
    isLive: isApiMode, session, loading, error, clearError: () => setError(null),
    lang, setLang, t,
    companies: db.companies, services: db.services, employees: visibleEmployees, allEmployees: db.employees,
    bookings: db.bookings, notices: db.notices, invites: db.invites, reviews: db.reviews,
    signupCustomer, signupCompany, signupEmployee, login, logout,
    updateProfile, changePassword, updateCompany,
    createBooking, cancelBooking, addReview, declineBooking,
    startPayment, getPaymentStatus, deleteAccount,
    submitComplaint, adminFetchComplaints, adminUpdateComplaint,
    toggleTask, setStatus, markNoticeRead,
    assignBooking, createInvite, deleteInvite, sendNotice, upsertService,
    adminUpdateCompany, adminUpdateUser, adminFetchStats, adminFetchUsers,
    adminFetchRevenue, adminFetchAllCompanies, adminFetchAllBookings,
    /* admin views: derived from db in demo, cached from API otherwise */
    adminStats:        isApiMode ? adminApi.stats     : demoAdminStats(db),
    adminRevenue:      isApiMode ? adminApi.revenue   : demoAdminRevenue(db),
    adminAllCompanies: isApiMode ? adminApi.companies : demoAdminCompanies(db),
    adminAllUsers:     isApiMode ? adminApi.users     : demoAdminUsers(db),
    adminAllBookings:  isApiMode ? adminApi.bookings  : demoAdminBookings(db),
    adminComplaints:   isApiMode ? adminApi.complaints : (db.complaints || []),
    demoSwitchRole: !isApiMode ? (role) => {
      if (role === "customer") setSession({ role, userId: "demo-customer", name: "Musa Gillani", custType: "student", companyId: null, address: "Kassai út 26, Debrecen", paymentMethod: "cash", lang: "en" });
      if (role === "employee") setSession({ role, userId: "e1", name: "Eszter Kovács", custType: null, companyId: "co1" });
      if (role === "company")  setSession({ role, userId: "owner1", name: "Bálint Erdős", custType: null, companyId: "co1" });
      if (role === "admin")    setSession({ role, userId: "admin1", name: "Platform Admin", custType: null, companyId: null });
      if (role === null) setSession(null);
    } : null,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
