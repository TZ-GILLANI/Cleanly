/* LANGUAGE — the whole chain, including the parts the drift checker cannot see.
   Run: node test/language.mjs                                                    */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4507";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const fs = await import("fs");
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4507${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const srv = await import("../server/lib/i18n-server.js");

console.log("\n── the server can speak all ten languages ──");
ok("twelve languages are supported", srv.serverLangs().length === 12, srv.serverLangs().join(","));
ok("an unknown language falls back to English", srv.normLang("zz") === "en");
ok("a locale like 'hu-HU' is understood", srv.normLang("hu-HU") === "hu");
ok("null is understood", srv.normLang(null) === "en");

console.log("\n── every server string is translated into every language ──");
const strings = srv.serverStrings();
ok("there are server strings to check", strings.length >= 15, String(strings.length));
let missing = [];
for (const s of strings) {
  for (const lg of srv.serverLangs()) {
    if (lg === "en") continue;
    if (srv.tr(lg, s) === s) missing.push(`${lg}: ${s}`);
  }
}
ok("no server string falls back to English in any language", missing.length === 0, missing.slice(0, 5).join(" | "));
ok("an untranslated string passes through rather than vanishing",
   srv.tr("hu", "Something we never translated") === "Something we never translated");
ok("English asks for no translation at all", srv.tr("en", "Job completed ✅") === "Job completed ✅");

console.log("\n── notifications arrive in the RECIPIENT's language ──");
await j("/api/auth/register", { method: "POST", body: { email: "hu@l.hu", password: "secret123", role: "customer", fullName: "Magyar", phone: "+36301110011", city: "Debrecen", address: "K 1", customerType: "resident", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "de@l.hu", password: "secret123", role: "customer", fullName: "Deutsch", phone: "+36301110012", city: "Debrecen", address: "K 2", customerType: "resident", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "en@l.hu", password: "secret123", role: "customer", fullName: "English", phone: "+36301110013", city: "Debrecen", address: "K 3", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE users SET lang='hu' WHERE email='hu@l.hu'");
await query("UPDATE users SET lang='de' WHERE email='de@l.hu'");
await query("UPDATE users SET lang='en' WHERE email='en@l.hu'");
const idOf = async (e) => (await query("SELECT id FROM users WHERE email=$1", [e])).rows[0].id;
const { notify } = await import("../server/lib/notify.js");
for (const e of ["hu@l.hu", "de@l.hu", "en@l.hu"]) await notify(await idOf(e), "booking", "Cleaner assigned 🧹", "Job completed ✅");
const seen = async (e) => (await query("SELECT title, body FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [await idOf(e)])).rows[0];
const huN = await seen("hu@l.hu"), deN = await seen("de@l.hu"), enN = await seen("en@l.hu");
ok("a Hungarian user gets Hungarian", huN.title === "Takarító kijelölve 🧹", huN.title);
ok("a German user gets German", deN.title === "Reinigungskraft zugewiesen 🧹", deN.title);
ok("an English user gets English", enN.title === "Cleaner assigned 🧹", enN.title);
ok("the body is translated too, not just the title", huN.body === "Munka elkészült ✅", huN.body);

console.log("\n── the language reaches the server for every role, not just customers ──");
const storeSrc = fs.readFileSync("src/store.jsx", "utf8");
ok("changing language saves it for whoever is logged in",
   /setLang = \(l\) => \{[^}]*if \(session\?\.userId\) updateProfile\(\{ lang: l \}\)/.test(storeSrc),
   "it used to save only for customers, so companies and cleaners got English pushes");
const co = await j("/api/auth/register", { method: "POST", body: { email: "colang@l.hu", password: "secret123", role: "company", fullName: "O", companyName: "L Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "colang@l.hu", password: "secret123" } })).data.token;
await j("/api/auth/profile", { method: "PUT", token: coTok, body: { lang: "de" } });
ok("a company can store its language", (await query("SELECT lang FROM users WHERE email='colang@l.hu'")).rows[0].lang === "de");
await notify(await idOf("colang@l.hu"), "booking", "A booking is waiting for you");
const coN = await seen("colang@l.hu");
ok("and then gets notifications in it", coN.title === "Eine Buchung wartet auf Sie", coN.title);

console.log("\n── API errors are translated where the person reads them ──");
const apiSrc = fs.readFileSync("src/lib/api.js", "utf8");
ok("the client translates server errors on display", /xl\(lg, raw\)/.test(apiSrc));
ok("the English original is kept for logging", /rawMessage = raw/.test(apiSrc));
ok("a translation failure never hides the real error", /catch \{ \/\* never let a translation problem hide/.test(apiSrc));

console.log("\n── the client dictionaries carry the common server errors ──");
const dict = await import("../src/lib/translations.js");
const commonErrors = [
  "Missing required fields",
  "That date has already passed — please pick another.",
  "That time has just been taken — please pick another.",
  "Company is not currently accepting bookings",
  "Service not found",
  "Customers only",
  "Forbidden",
  "Invalid or expired token",
];
const notInDict = [];
for (const e of commonErrors) {
  for (const lg of ["hu", "de", "ro", "sk", "pl", "uk", "fr", "es", "it"]) {
    if (lg === "hu") { if (!dict.EXTRA.de) continue; }
    const d = dict.EXTRA[lg];
    if (d && !d[e]) notInDict.push(`${lg}: ${e}`);
  }
}
ok("the errors a user is most likely to hit are translated",
   notInDict.length === 0, notInDict.slice(0, 6).join(" | "));


console.log("\n── Turkish and Chinese ──");
ok("Turkish notifications work", srv.tr("tr", "Job completed ✅") === "İş tamamlandı ✅", srv.tr("tr","Job completed ✅"));
ok("Chinese notifications work", srv.tr("zh", "Job completed ✅") === "工作已完成 ✅", srv.tr("zh","Job completed ✅"));
const i18n = await import("../src/lib/i18n.js");
ok("the app offers twelve languages", i18n.LANGS.length === 12, String(i18n.LANGS.length));
ok("Turkish and Chinese are in the picker", i18n.LANGS.some(l=>l.id==="tr") && i18n.LANGS.some(l=>l.id==="zh"));
ok("both have a date locale", !!i18n.LOCALES.tr && !!i18n.LOCALES.zh);
const d2 = await import("../src/lib/translations.js");
ok("the customer journey is translated into Turkish", Object.keys(d2.EXTRA.tr).length >= 200, String(Object.keys(d2.EXTRA.tr).length));
ok("and into Chinese", Object.keys(d2.EXTRA.zh).length >= 200, String(Object.keys(d2.EXTRA.zh).length));
ok("an untranslated string falls back to English, never blank", d2.xl("zh", "Not translated yet") === "Not translated yet");
ok("placeholders survive translation", /\{h\}/.test(d2.EXTRA.tr["More than {h}h before"]) && /\{h\}/.test(d2.EXTRA.zh["More than {h}h before"]));
console.log("\n── the app itself still has zero drift ──");
const fsL2 = (await import("fs")).default;
const drift = (await import("child_process")).execSync("node scripts/i18n-drift.mjs", { encoding: "utf8" });
ok("the UI drift checker reports 0", /DRIFT: 0 missing/.test(drift), drift.split("\n").slice(-3).join(" "));
ok("and no interpolated string slipped past it", !/untranslatable interpolated/.test(drift),
   (drift.match(/.*untranslatable interpolated.*/) || [""])[0]);

/* A checker is only worth its output if you have watched it fail.

   This one reported "0 drift" for months while sixteen L(`…${x}…`) calls
   reached English and Hungarian and no other language — its regex only matched
   quoted literals, so interpolated strings were not counted as missing, they
   were not counted at all. Same shape as the untranslated-string detector that
   passed while whole screens were in English.

   So: plant one, require that it is caught, and take it away again. */
const bait = "src/.drift-canary.jsx";
fsL2.writeFileSync(bait, "export const X = () => L(`Hello ${name} there`, `Szia ${name}`);\n");
let baitOut = "";
try { baitOut = (await import("child_process")).execSync("node scripts/i18n-drift.mjs", { encoding: "utf8" }); }
catch (e) { baitOut = String(e.stdout || ""); }
fsL2.unlinkSync(bait);
ok("the drift checker itself catches an interpolated string (canary)",
   /untranslatable interpolated/.test(baitOut) && /Hello \$\{name\} there/.test(baitOut),
   baitOut.split("\n").filter((l) => /interpolated|canary/.test(l)).slice(0, 2).join(" | "));


console.log("\n── the App Store is told which languages we speak ──");
/* Apple reads supported languages from the binary. Cleano's translations are
   JavaScript, invisible to iOS, so without CFBundleLocalizations the listing
   says "English" and nobody browsing in Hungarian learns otherwise. This is
   injected during the iOS build, so the guard has to live here. */
const fsL = await import("fs");
const cm = fsL.readFileSync("codemagic.yaml", "utf8");
const m = /CFBundleLocalizations -json '(\[[^\]]*\])'/.exec(cm);
ok("the iOS build declares its localizations", !!m);
const declared = m ? JSON.parse(m[1]) : [];
const picker = [...new Set([...fsL.readFileSync("src/lib/i18n.js", "utf8")
  .matchAll(/\bcode:\s*"([a-z]{2})"/g)].map((x) => x[1]))];
/* Apple wants a script variant for Chinese; everything else is a plain code. */
const norm = (l) => (l === "zh-Hans" ? "zh" : l);
const undeclared = picker.filter((l) => !declared.map(norm).includes(l));
ok("every language in the picker is declared to Apple", undeclared.length === 0, undeclared.join(","));
ok("Chinese is declared with its script variant", declared.includes("zh-Hans"));
ok("mixed localizations are allowed, so nothing falls back blank", /CFBundleAllowMixedLocalizations -bool YES/.test(cm));
ok("and the build prints what it declared, so a silent failure is visible",
   /plutil -extract CFBundleLocalizations/.test(cm));


console.log("\n── no hardcoded English left on any of the four interfaces ──");
/* The drift checker answers "is every translated string present in every
   language". It cannot answer the prior question — "is every string the user
   reads wrapped for translation at all". A hardcoded label is invisible to it:
   the dictionary reads 100%, and the screen is still half English. */
const { execFileSync } = await import("child_process");
const sweep = execFileSync("node", ["scripts/untranslated.mjs"], { encoding: "utf8" });
for (const role of ["customer", "company", "cleaner", "admin", "shared"]) {
  const m = new RegExp(`${role}\\s+(\\d+)`).exec(sweep);
  ok(`${role} has no hardcoded English`, m && Number(m[1]) === 0, m ? m[1] + " found" : "not reported");
}
/* The first sweep only read JSX text, placeholders and toasts. It reported a
   confident zero while whole company and admin screens were still English,
   because most copy here is passed as a prop or sits in an object literal.
   These assertions pin the properties that fix made it depend on. */
const sweepSrc = fsL.readFileSync("scripts/untranslated.mjs", "utf8");
ok("the sweep reads every string literal, not just JSX text",
   /for \(const m of src\.matchAll\(\/"/.test(sweepSrc));
ok("it ignores CSS values and code fragments", /CSS_VALUE/.test(sweepSrc) && /CODE_FRAGMENT/.test(sweepSrc));
ok("and it does not count the comments", /inComment/.test(sweepSrc));

console.log(`\n════ LANGUAGE: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
