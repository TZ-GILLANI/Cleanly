/* THE DEEP PASS.

   Re-running the suite proves the suite still passes. These are the checks the
   suite structurally cannot make: the same rule written twice and drifting, a
   component rendered where its own guard forbids it, money invariants across
   thousands of combinations rather than the handful anyone thinks to type.

   Every section here was written after something in that class had already
   shipped — the service-area bug (two ideas of "covered"), the invoice box
   (rendered where it could never render), the lead time (a literal in the
   screen and an env var on the server).

   Run: node test/deep.mjs                                                    */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "deep";
process.env.PORT = "4612";
process.env.COMMISSION_PCT = "10";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
import fs from "fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const clean = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const appCode = clean(app);

console.log("\n── 1. the same rule, written twice ──");
{
  /* visitsInBillingMonth on the server decides what the card is charged.
     visitsInMonthFrom on the client decides what the customer is TOLD they
     will be charged. If they ever disagree the checkout lies about the price,
     which is the worst possible place for a rounding difference. */
  const { visitsInBillingMonth } = await import("../server/routes/payments.js");

  const m = /const visitsInMonthFrom = \(iso, freq\) => \{[\s\S]*?\n\};/.exec(appCode);
  const addP = /const addPeriod = \(iso, freq\) => \{[\s\S]*?\n\};/.exec(appCode);
  ok("both implementations exist to compare", !!m && !!addP);

  /* Run the client's own source, not a copy of it. */
  const clientFn = new Function(`${addP[0]}\n${m[0]}\nreturn visitsInMonthFrom;`)();

  let checked = 0, disagreed = [];
  for (const freq of ["weekly", "biweekly", "monthly"]) {
    for (let d = 0; d < 400; d++) {
      const iso = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      const server = visitsInBillingMonth(iso, freq).length;
      const client = clientFn(iso, freq);
      checked++;
      if (server !== client) disagreed.push(`${freq} ${iso}: server ${server} client ${client}`);
    }
  }
  ok(`the two agree on all ${checked} start dates across three cadences`,
     disagreed.length === 0, disagreed.slice(0, 4).join(" · "));
  ok("including the awkward month ends",
     visitsInBillingMonth("2026-01-31", "monthly").length === clientFn("2026-01-31", "monthly"));
  ok("and February", visitsInBillingMonth("2026-02-01", "weekly").length === clientFn("2026-02-01", "weekly"));
}

console.log("\n── 2. nothing is rendered where it can never appear ──");
{
  /* The invoice uploader sat inside a loop over jobs with status < 4 while
     refusing to render unless status was 4. It had never appeared once. */
  const lines = appCode.split("\n");
  let comp = null;
  const guards = [];
  lines.forEach((ln, i) => {
    const m = /^function ([A-Z]\w+)\(/.exec(ln);
    if (m) comp = m[1];
    const g = /if \(([^)]*\bstatus\b[^)]*)\) return null;/.exec(ln);
    if (g && comp) guards.push({ comp, cond: g[1] });
  });
  ok("components with a status guard were found", guards.length > 0, String(guards.length));

  const listFilter = (name) => {
    const re = new RegExp("const " + name + " = [^\\n]*");
    const m = re.exec(appCode);
    return m ? m[0] : null;
  };
  const problems = [];
  for (const g of guards) {
    const re = new RegExp("<" + g.comp + "\\b", "g");
    for (const use of appCode.matchAll(re)) {
      const before = appCode.slice(0, use.index);
      const loop = [...before.matchAll(/\{(\w+)\.map\(\(b\)/g)].pop();
      if (!loop) continue;
      const filter = listFilter(loop[1]);
      if (!filter) continue;
      /* The one shape we know is fatal: a guard demanding status 4 inside a
         list that filters status below 4. */
      if (/status !== 4/.test(g.cond) && /status < 4/.test(filter))
        problems.push(`<${g.comp}> in ${loop[1]} (${filter.slice(0, 60)})`);
    }
  }
  ok("no component demands a status its own list excludes", problems.length === 0, problems.join(" · "));

  const rendered = (n) => new RegExp("<" + n + "\\b").test(appCode);
  for (const g of [...new Set(guards.map((x) => x.comp))])
    ok(`  <${g}> is rendered somewhere at all`, rendered(g));
}

console.log("\n── 3. the money holds under every combination, not the three I typed ──");
{
  const { platformNetMinor, payableMinor, stripeFeeMinor, visitsInBillingMonth } = await import("../server/routes/payments.js");
  const { minimumServicePriceHuf } = await import("../server/routes/payments.js");
  const floor = minimumServicePriceHuf();
  const pct = 10;
  let n = 0, shortPaid = [], notRound = [], negative = [];
  for (const price of [1200, 2500, 3990, 5000, 7900, 9900, 12000, 15900, 24500, 39900, 75000]) {
    for (const visits of [1, 2, 3, 4, 5, 6, 12]) {
      for (const disc of [0, 10, 15, 20, 40, 50]) {
        /* What the company actually receives after a discount, floored at the
           point where our commission can still cover Stripe. Below that the
           booking endpoint trims the discount rather than short-paying the
           partner — so the invariant is checked against the trimmed figure,
           which is what really reaches the card. */
        const raw = Math.round(price * (100 - disc) / 100);
        const listed = raw > 0 && raw < floor && price >= floor ? floor : raw;
        if (listed <= 0) continue;
        const fee = Math.round(listed * pct / 100);
        const total = (listed + fee) * 100 * visits;
        const net = payableMinor(platformNetMinor(total, fee * 100 * visits), "HUF");
        const company = total - net - stripeFeeMinor(total);
        n++;
        if (company < listed * 100 * visits) shortPaid.push(`${listed}x${visits} -${disc}%: ${company / 100} < ${listed * visits}`);
        if (total % 100 !== 0 || net % 100 !== 0) notRound.push(`${listed}x${visits}`);
        if (net < 0) negative.push(`${listed}x${visits}`);
      }
    }
  }
  ok(`checked ${n} price / visit / discount combinations`, n > 400, String(n));
  ok("the company is NEVER paid less than its listed price", shortPaid.length === 0, shortPaid.slice(0, 3).join(" · "));
  ok("every amount Stripe sees is divisible by 100", notRound.length === 0, notRound.slice(0, 3).join(" · "));
  ok("our commission is never negative", negative.length === 0, negative.slice(0, 3).join(" · "));

  /* The floor that keeps the promise honest on tiny jobs. */
  const tiny = 100 * 100, tinyFee = 10 * 100;
  ok(`the viable floor is a real number (${floor} Ft today)`, Number.isFinite(floor) && floor > 0, String(floor));
  const bk = fs.readFileSync(new URL("../server/routes/bookings.js", import.meta.url), "utf8");
  ok("and the booking endpoint applies it after every discount",
     /companyShare = floor;/.test(bk));
  const svc = fs.readFileSync(new URL("../server/routes/services.js", import.meta.url), "utf8");
  ok("while a service is checked against its own offer, not its list price",
     /const smallest = Math\.round\(listed \* \(100 - svcPromo\) \/ 100\);/.test(svc));
  ok("on a job too small to cover Stripe, we keep nothing rather than taking it from the partner",
     payableMinor(platformNetMinor(tiny, tinyFee), "HUF") === 0,
     String(payableMinor(platformNetMinor(tiny, tinyFee), "HUF")));
}

console.log("\n── 4. what the server publishes, the screen obeys ──");
{
  const store = fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8");
  const pay = fs.readFileSync(new URL("../server/routes/payments.js", import.meta.url), "utf8");
  ok("the server publishes its booking lead time", /leadMin: Math\.max\(0, Number\(process\.env\.BOOKING_LEAD_MIN \?\? 60\)\)/.test(pay));
  ok("and the charging horizon", /subChargeDays: Math\.max\(1, Number\(process\.env\.SUB_CHARGE_DAYS \|\| 5\)\)/.test(pay));
  ok("the store takes them from that call", /setBookingRules\(c\)/.test(store));
  ok("the picker reads the shared value, not a literal of its own",
     /const cutoff = Date\.now\(\) \+ leadMinutes\(\) \* 60000;/.test(appCode));
  ok("and there is no second hardcoded lead time left in the screen",
     !/BOOKING_LEAD_MIN = \d+/.test(appCode));
  /* The cycle that would have been: store → App → store. */
  ok("the rule lives in its own module, so the store and the app do not import each other",
     fs.existsSync(new URL("../src/lib/bookingRules.js", import.meta.url))
     && !/from "\.\/App\.jsx"/.test(store));
}

console.log("\n── 5. today's work is actually reachable ──");
{
  /* This codebase's signature failure is a correct function nothing calls. */
  const srvFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = d + "/" + e.name;
      if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name)) srvFiles.push(f);
    }
  })("server");
  const srv = srvFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const count = (src, name) => (src.match(new RegExp("\\b" + name + "\\b", "g")) || []).length;

  for (const [name, src, what] of [
    ["slotProblem", srv, "the one availability check"],
    ["isoDate", srv, "the date helper that replaced String().slice()"],
    ["visitsInBillingMonth", srv, "the monthly billing window"],
    ["materialise", srv, "building a plan's run"],
    ["collapseCancelledPlans", appCode, "one entry per cancelled plan"],
    ["nextVisitOnly", appCode, "one visit at a time"],
    ["GoThere", appCode, "the cleaner's directions"],
    ["MoveVisitSheet", appCode, "proposing new dates"],
    ["PartnerInvoiceBox", appCode, "uploading the invoice"],
    ["ReportCustomerBox", appCode, "reporting a customer"],
    ["setBookingRules", fs.readFileSync(new URL("../src/store.jsx", import.meta.url), "utf8"), "taking the server's rules"],
  ]) ok(`${name} — ${what}`, count(src, name) >= 2, `only ${count(src, name)} mention(s)`);
}

console.log("\n── 6. a company can still be reported after the job ends ──");
{
  ok("the report box is offered on finished jobs, not only mid-clean",
     (appCode.match(/<ReportCustomerBox\b/g) || []).length >= 2,
     String((appCode.match(/<ReportCustomerBox\b/g) || []).length));
  const rep = fs.readFileSync(new URL("../server/routes/customer-reports.js", import.meta.url), "utf8");
  ok("and the server never had a status rule to contradict that", !/status !== 4|status < 2/.test(rep));
}

console.log("\n── 7. a company can say how many jobs it takes at once ──");
{
  /* Capacity is service.slot_capacity, or the number of approved cleaners, or
     1. A company that has not added its team to the app is therefore capped at
     one job an hour — the first customer takes 10:00 and everyone after is
     told the time has gone.

     The setting that fixes it existed and was reachable only on COLLECTION
     services, because the field sat inside a block rendered when fulfilment
     was "collection". On an ordinary cleaning job it was invisible. */
  const av = fs.readFileSync(new URL("../server/lib/availability.js", import.meta.url), "utf8");
  ok("capacity prefers the service's own setting", /svc\?\.slot_capacity != null \? Number\(svc\.slot_capacity\)/.test(av));
  ok("and falls back to the team, never to zero", /GREATEST\(1, COUNT\(\*\)::int\)/.test(av));

  const capIdx = appCode.indexOf("Jobs at the same time");
  ok("the field exists in the service form", capIdx > -1);
  const collIdx = appCode.lastIndexOf('=== "collection" && (', capIdx);
  const closeIdx = collIdx > -1 ? appCode.indexOf("\n          )}", collIdx) : -1;
  ok("and it is NOT trapped inside the collection-only block",
     collIdx === -1 || closeIdx === -1 || closeIdx < capIdx,
     `collection block ${collIdx}..${closeIdx}, field at ${capIdx}`);
  ok("turnaround days stays collection-only, where it belongs",
     appCode.indexOf("Ready in (days)") > collIdx && appCode.indexOf("Ready in (days)") < closeIdx);
  ok("the help text says what happens if it is left empty", /we use your team size/.test(appCode));
  const svcRoute = fs.readFileSync(new URL("../server/routes/services.js", import.meta.url), "utf8");
  ok("the server accepts and stores it", /slotCapacity/.test(svcRoute));
}

console.log(`\n════ DEEP PASS: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
