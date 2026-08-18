process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4491";
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const { distanceKm } = await import("../server/lib/geocode.js");
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

console.log("\n── distance maths (4.6) ──");
ok("Debrecen→Budapest ≈194 km", Math.abs(distanceKm(47.5316, 21.6273, 47.4979, 19.0402) - 194) < 3);
ok("same point = 0 km", distanceKm(47.5, 21.6, 47.5, 21.6) === 0);
ok("missing coords → null", distanceKm(null, 21.6, 47.5, 21.6) === null);

console.log("\n── country + service-area columns persist (4.1/4.6) ──");
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4491${p}`, { method: o.method || "GET",
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
await j("/api/auth/register", { method: "POST", body: { email: "i@s.hu", password: "secret123", role: "company", fullName: "B", companyName: "IntlCo", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const login = await j("/api/auth/login", { method: "POST", body: { email: "i@s.hu", password: "secret123" } });
const tok = login.data.token, cid = login.data.user.company_id;

const put = await j("/api/companies/" + cid, { method: "PUT", token: tok, body: {
  name: "IntlCo", country: "DE", serviceLat: 47.5316, serviceLng: 21.6273, serviceRadiusKm: 8, currency: "EUR" } });
ok("country saved", put.data.company?.country === "DE", put.data.company?.country);
ok("radius saved", Number(put.data.company?.service_radius_km) === 8, String(put.data.company?.service_radius_km));
ok("currency saved", put.data.company?.currency === "EUR", put.data.company?.currency);
ok("coordinates saved", Math.abs(Number(put.data.company?.service_lat) - 47.5316) < 0.001);

const pub = await j("/api/companies");
const me = (pub.data.companies || []).find((c) => c.id === cid);
ok("public list exposes radius + country", me && me.service_radius_km === 8 && me.country === "DE");

console.log("\n── radius filtering keeps the right companies (4.6) ──");
// simulate the server's own filter maths rather than hitting Nominatim in tests
const inside = distanceKm(47.5400, 21.6300, 47.5316, 21.6273);
const outside = distanceKm(47.4979, 19.0402, 47.5316, 21.6273);
ok("a customer 1 km away is inside an 8 km circle", inside <= 8, String(inside));
ok("a customer 194 km away is outside", outside > 8, String(outside));

console.log("\n── invalid radius is clamped, not trusted (4.6) ──");
const bad = await j("/api/companies/" + cid, { method: "PUT", token: tok, body: { name: "IntlCo", serviceRadiusKm: 99999 } });
ok("radius clamped to 200", Number(bad.data.company?.service_radius_km) === 200, String(bad.data.company?.service_radius_km));

console.log(`\n════ PART 4: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
