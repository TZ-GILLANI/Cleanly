/* LIVE TRANSLATION (5.2) — translate-on-write for user-typed content.
   Runs a fake provider so we test our own logic, not someone's API.
   Run: node test/translation.mjs                                          */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4504";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

console.log("\n── with NO provider configured, everything still works ──");
const t0 = await import("../server/lib/translate.js");
ok("translation reports itself as off", t0.translationEnabled() === false);
const off = await t0.translateAll("Ragyogó tisztaság", "hu");
ok("we still get a map back", !!off && typeof off === "object", JSON.stringify(off));
ok("it holds the original under its own language", off.hu === "Ragyogó tisztaság");
ok("and records which language that was", off._src === "hu");
ok("reading it in another language falls back to the original",
   t0.pick(off, "de")?.text === "Ragyogó tisztaság" && t0.pick(off, "de")?.translated === false);
ok("reading it in its own language is not labelled a translation",
   t0.pick(off, "hu")?.translated === false);
ok("empty text produces nothing at all", (await t0.translateAll("   ", "hu")) === null);
ok("a null map reads as nothing", t0.pick(null, "de") === null);

console.log("\n── only re-translate when the source really changed ──");
ok("no stored map means translate", t0.sourceChanged(null, "hello") === true);
ok("same text means skip", t0.sourceChanged({ _src: "hu", hu: "hello" }, "hello") === false);
ok("whitespace-only difference means skip", t0.sourceChanged({ _src: "hu", hu: "hello" }, "  hello  ") === false);
ok("changed text means translate", t0.sourceChanged({ _src: "hu", hu: "hello" }, "goodbye") === true);

console.log("\n── with a provider, all ten languages are stored ──");
/* Stand up a tiny local server that speaks enough Google-translate to test with. */
const http = await import("http");
let calls = 0;
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    const q = JSON.parse(body || "{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { translations: [{ translatedText: `[${q.target}] ${q.q}` }] } }));
  });
});
await new Promise((r) => fake.listen(4599, r));

/* Re-import the module with the provider switched on. */
process.env.TRANSLATE_PROVIDER = "google";
process.env.TRANSLATE_API_KEY = "test-key";
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) =>
  String(url).includes("translation.googleapis.com")
    ? realFetch("http://127.0.0.1:4599/", opts)
    : realFetch(url, opts);

const t1 = await import("../server/lib/translate.js?on=1");
ok("translation reports itself as on", t1.translationEnabled() === true);
const map = await t1.translateAll("Ragyogó tisztaság", "hu");
ok("every one of the ten languages is present",
   t1.LANGS.every((l) => !!map[l]), JSON.stringify(Object.keys(map)));
ok("the source language keeps the original untouched", map.hu === "Ragyogó tisztaság");
ok("other languages are translated", map.de === "[de] Ragyogó tisztaság", map.de);
ok("we called the provider once per target language", calls === t1.LANGS.length - 1, String(calls));
ok("reading in German is flagged as a translation",
   t1.pick(map, "de")?.translated === true && t1.pick(map, "de")?.text === "[de] Ragyogó tisztaság");
ok("reading in Hungarian is NOT flagged as a translation", t1.pick(map, "hu")?.translated === false);

console.log("\n── a provider outage must never lose the original ──");
globalThis.fetch = (url, opts) =>
  String(url).includes("translation.googleapis.com")
    ? Promise.reject(new Error("provider down"))
    : realFetch(url, opts);
const broken = await t1.translateAll("Tiszta otthon", "hu");
ok("we still get a usable map", !!broken && broken.hu === "Tiszta otthon", JSON.stringify(broken));
ok("no half-written garbage in other languages", broken.de === undefined);
ok("readers still see the original", t1.pick(broken, "fr")?.text === "Tiszta otthon");

console.log("\n── requirement lists translate line by line ──");
globalThis.fetch = (url, opts) =>
  String(url).includes("translation.googleapis.com")
    ? realFetch("http://127.0.0.1:4599/", opts)
    : realFetch(url, opts);
const list = await t1.translateList(["Parkolóhely", "Meleg víz"], "hu");
ok("one map per line, in order", Array.isArray(list) && list.length === 2 && list[0].hu === "Parkolóhely" && list[1].hu === "Meleg víz");
ok("each line is translated", list[0].de === "[de] Parkolóhely");
ok("an empty list produces nothing", (await t1.translateList([], "hu")) === null);
ok("blank lines are dropped", (await t1.translateList(["  ", "Real"], "hu")).length === 1);

console.log("\n── very long text is left alone, to protect the quota ──");
const long = "x".repeat(2000);
const longMap = await t1.translateAll(long, "hu");
ok("a 2000-character blob is stored but not sent", longMap.hu === long && longMap.de === undefined);

console.log("\n── the server stores and serves the maps ──");
globalThis.fetch = realFetch;
delete process.env.TRANSLATE_PROVIDER;
delete process.env.TRANSLATE_API_KEY;
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4504${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
await j("/api/auth/register", { method: "POST", body: { email: "co@t.hu", password: "secret123", role: "company", fullName: "O", companyName: "T Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
const co = (await j("/api/auth/login", { method: "POST", body: { email: "co@t.hu", password: "secret123" } })).data;
const cid = co.user.company_id;

await j("/api/companies/" + cid, { method: "PUT", token: co.token, body: { name: "T Co", tagline: "Ragyogó tisztaság", requirements: ["Parkolóhely"] } });
await new Promise((r) => setTimeout(r, 400));
const pubCo = await j("/api/companies/" + cid);
ok("the public company row exposes the tagline translation map", "tagline_i18n" in (pubCo.data.company || {}), Object.keys(pubCo.data.company || {}).join(","));
ok("and the requirements map", "requirements_i18n" in (pubCo.data.company || {}));
const stored = await query("SELECT tagline_i18n FROM companies WHERE id = $1", [cid]);
const tm = stored.rows[0].tagline_i18n;
ok("a map was written even with no provider configured", !!tm && tm.hu === "Ragyogó tisztaság", JSON.stringify(tm));

/* Saving something unrelated must not rewrite the map. */
const before = JSON.stringify((await query("SELECT tagline_i18n FROM companies WHERE id=$1", [cid])).rows[0].tagline_i18n);
await j("/api/companies/" + cid, { method: "PUT", token: co.token, body: { name: "T Co", area: "Belváros" } });
await new Promise((r) => setTimeout(r, 300));
const afterSame = JSON.stringify((await query("SELECT tagline_i18n FROM companies WHERE id=$1", [cid])).rows[0].tagline_i18n);
ok("an unrelated save leaves the translations alone", before === afterSame);

const svc = await j("/api/services", { method: "POST", token: co.token, body: { name: "Nagytakarítás", description: "Mindenre kiterjedő", pricingType: "flat", priceHuf: 12000 } });
await new Promise((r) => setTimeout(r, 400));
const sm = await query("SELECT name_i18n, description_i18n FROM services WHERE id = $1", [svc.data.service.id]);
ok("service name is stored as a map", sm.rows[0].name_i18n?.hu === "Nagytakarítás", JSON.stringify(sm.rows[0].name_i18n));
ok("service description too", sm.rows[0].description_i18n?.hu === "Mindenre kiterjedő");

console.log("\n── legal pages are never machine translated ──");
const legalSrc = (await import("fs")).readFileSync("server/lib/translate.js", "utf8");
ok("that rule is written down where it can be found", /legal/i.test(legalSrc));
const routes = ["companies", "services", "reviews"];
for (const r of routes) {
  const f = (await import("fs")).readFileSync(`server/routes/${r}.js`, "utf8");
  ok(`${r} translates in the background, never blocking the save`, /\(async \(\) => \{[\s\S]{0,600}translate/.test(f) || /translateService\(/.test(f));
}

fake.close();

console.log("\n── live translation covers every language the app offers ──");
/* Adding a language to the interface without adding it here produces the worst
   possible result: every button in Turkish, every company tagline still in
   Hungarian. Worse than not offering Turkish at all. */
const fsT = await import("fs");
const tr = await import("../server/lib/translate.js");
const clientLangs = [...fsT.readFileSync("src/lib/i18n.js", "utf8")
  .matchAll(/\bcode:\s*"([a-z]{2})"/g)].map((m) => m[1]);
const fallback = clientLangs.length ? clientLangs
  : [...new Set([...fsT.readFileSync("src/lib/i18n.js", "utf8").matchAll(/"([a-z]{2})"\s*:/g)].map((m) => m[1]))];
const missing = fallback.filter((l) => !tr.LANGS.includes(l));
ok("the translator knows every language the picker offers", missing.length === 0, missing.join(","));
ok("including Turkish", tr.LANGS.includes("tr"));
ok("and Chinese", tr.LANGS.includes("zh"));
const trSrc = fsT.readFileSync("server/lib/translate.js", "utf8");
ok("Chinese is requested from DeepL in a form it accepts", /ZH-HANS/.test(trSrc));
ok("with no key configured nothing is called and the original survives",
   (await tr.translateAll("Alapos takarítás", "hu")).hu === "Alapos takarítás");
ok("and the source language is recorded", (await tr.translateAll("x", "hu"))._src === "hu");

console.log(`\n════ LIVE TRANSLATION: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
