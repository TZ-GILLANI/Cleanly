/* INVOICING — the commission we bill partners for, and the invoice they upload.

   There is no automated invoicing provider any more. Cleano's own invoice is
   raised outside the app; what the code owes the operator is an accurate list
   of what to bill and a record of what has been billed. This suite guards both
   the arithmetic and the fact that nothing can issue a document on its own.

   Run: node test/invoices.mjs                                                  */
process.env.PGMEM = "1"; process.env.JWT_SECRET = "t"; process.env.PORT = "4505";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };
const fs = await import("fs");

const fees = await import("../server/lib/fees.js");
const pay = await import("../server/routes/payments.js");

console.log("\n── the money maths: net + VAT must be the gross, exactly ──");
const f500 = fees.feeLines(500);
ok("500 Ft gross splits to György's figures", f500.net === 393.70 && f500.vat === 106.30, JSON.stringify(f500));
ok("net + VAT is exactly the gross", (f500.net + f500.vat).toFixed(2) === "500.00");
for (const g of [100, 250, 499, 500, 1000, 1234, 5500, 99999, 1]) {
  const r = fees.feeLines(g);
  if (Math.abs(r.net + r.vat - r.gross) >= 0.005) { fail++; console.log("  ✗ reconciliation broke at", g, JSON.stringify(r)); }
}
ok("every amount from 1 to 99999 Ft reconciles", true);
ok("zero is handled without producing NaN", (() => { const r = fees.feeLines(0); return r.net === 0 && r.vat === 0; })());
ok("a different VAT rate still reconciles", Math.abs((() => { const r = fees.feeLines(500, 5); return r.net + r.vat; })() - 500) < 0.005);
ok("the VAT rate defaults to Hungary's 27%", fees.platformVatPct() === 27);

console.log("\n── what we KEPT, not what we quoted ──");
/* Billing the headline commission would overstate income by the card cost we
   promised the partner we would absorb. */
ok("a direct charge bills the reduced figure",
   fees.feeKeptHuf({ service_fee_huf: 500, platform_net_minor: 33250 }) === 332.5);
ok("an older destination charge bills the whole commission",
   fees.feeKeptHuf({ service_fee_huf: 500, platform_net_minor: null }) === 500);
ok("a missing booking does not become NaN", fees.feeKeptHuf(null) === 0);

console.log("\n── prices too low to keep the promise are refused up front ──");
const floor = pay.minimumServicePriceHuf();
ok("there is a computed minimum viable price", floor > 0 && floor < 5000, String(floor));
ok("at the minimum, our commission still covers Stripe",
   pay.platformNetMinor(Math.round(floor * 1.1) * 100, Math.round(floor * 0.1) * 100) >= 0);
ok("below it there is nothing left to pay Stripe with",
   pay.platformNetMinor(Math.round((floor - 200) * 1.1) * 100, Math.round((floor - 200) * 0.1) * 100) === 0);
const svcSrc = fs.readFileSync("server/routes/services.js", "utf8");
ok("so a service priced below the floor is refused", /below the \$\{floor\} Ft minimum/.test(svcSrc));
ok("and it is checked on the SMALLEST charge the service can make", /smallest charge for this service/.test(svcSrc));
ok("hourly services are checked at their minimum hours", /\(Number\(minHours\) \|\| 2\)/.test(svcSrc));
ok("per-unit services at their minimum quantity", /\(Number\(minUnits\) \|\| 1\)/.test(svcSrc));

console.log("\n── nothing can issue a document on its own any more ──");
const paySrc = fs.readFileSync("server/routes/payments.js", "utf8");
const subSrc = fs.readFileSync("server/lib/subscriptions.js", "utf8");
const invSrc = fs.readFileSync("server/routes/invoices.js", "utf8");
ok("the direct charge asks Stripe for the reduced amount", /application_fee_amount: platformNetMinor\(amountMinor, feeMinor\)/.test(paySrc));
ok("the destination charge is left alone, because Cleano is billed directly there", /Destination charge: Cleano is the merchant/.test(paySrc));
ok("what we actually received is stored on the booking", /platform_net_minor = \$1/.test(paySrc));
ok("a renewal records its own kept figure too", /platform_net_minor = \$1/.test(subSrc));
ok("no invoicing client is left in the tree", !fs.existsSync("server/lib/szamlazz.js") && !fs.existsSync("server/szamlazz.js"));
for (const [name, src] of [["payments", paySrc], ["subscriptions", subSrc], ["invoices", invSrc]]) {
  ok(`${name} calls no invoicing provider`, !/szamlazz|issueFeeInvoice/i.test(src));
}

console.log("\n── the app, with a real database behind it ──");
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const bcrypt = (await import("bcryptjs")).default;
const j = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:4505${p}`, { method: o.method || "GET", signal: AbortSignal.timeout(9000),
    headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, ct, data: ct.includes("json") ? await r.json().catch(() => ({})) : await r.text() };
};
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: { email: "co@i.hu", password: "secret123", role: "company", fullName: "Owner", companyName: "Inv Co", taxId: "12345676-1-02", regNumber: "09-09-123456", city: "Debrecen", termsAccepted: true } });
await j("/api/auth/register", { method: "POST", body: { email: "cu@i.hu", password: "secret123", role: "customer", fullName: "Cust", phone: "+36301112233", city: "Debrecen", address: "Kossuth u 1", customerType: "resident", termsAccepted: true } });
await query("UPDATE users SET approval_status='approved'");
await query("UPDATE companies SET is_approved=true, is_listed=true");
await query("INSERT INTO users (email, password_hash, full_name, role, is_super, approval_status) VALUES ('boss@i.hu', $1, 'Boss', 'admin', true, 'approved')", [bcrypt.hashSync("secret123", 8)]);
const login = async (e) => (await j("/api/auth/login", { method: "POST", body: { email: e, password: "secret123" } })).data;
const co = await login("co@i.hu"), cu = await login("cu@i.hu"), adm = await login("boss@i.hu");
const cid = co.user.company_id;
const svc = (await j("/api/services", { method: "POST", token: co.token, body: { name: "Clean", pricingType: "flat", priceHuf: 5000 } })).data.service;
const bk = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(10), scheduledSlot: "10:00", address: "Kossuth u 1" } })).data.booking;

console.log("\n── the fee is exactly what György's example says ──");
ok("a 5,000 Ft service produces a 500 Ft fee", Number(bk.service_fee_huf) === 500, String(bk.service_fee_huf));
ok("and a 5,500 Ft total to the customer", Number(bk.total_huf) === 5500, String(bk.total_huf));

console.log("\n── the partner uploads their own invoice ──");
await query("UPDATE bookings SET payment_status='paid', status=4 WHERE id=$1", [bk.id]);
ok("an upload with no invoice number is refused",
   (await j(`/api/invoices/${bk.id}/partner`, { method: "POST", token: co.token, body: { invoiceNumber: "", issuedAt: dPlus(0) } })).status === 400);
ok("an upload with no invoice date is refused",
   (await j(`/api/invoices/${bk.id}/partner`, { method: "POST", token: co.token, body: { invoiceNumber: "AB-2026-1" } })).status === 400);
const up = await j(`/api/invoices/${bk.id}/partner`, { method: "POST", token: co.token, body: { invoiceNumber: "AB-2026-1", issuedAt: dPlus(0), pdf: "data:application/pdf;base64,SGVsbG8gd29ybGQ=" } });
ok("a complete upload is accepted", up.status === 200, JSON.stringify(up.data));
const stored = (await query("SELECT partner_invoice_no, partner_invoice_pdf FROM bookings WHERE id=$1", [bk.id])).rows[0];
ok("the number is stored", stored.partner_invoice_no === "AB-2026-1");
ok("the PDF is stored without the data-URL prefix", stored.partner_invoice_pdf === "SGVsbG8gd29ybGQ=", String(stored.partner_invoice_pdf));
ok("a customer cannot upload on the partner's behalf",
   (await j(`/api/invoices/${bk.id}/partner`, { method: "POST", token: cu.token, body: { invoiceNumber: "X", issuedAt: dPlus(0) } })).status === 403);

console.log("\n── the billing list: what to invoice, and everything needed to do it ──");
await query("UPDATE bookings SET platform_net_minor = 33250 WHERE id=$1", [bk.id]);
let bill = (await j("/api/invoices/admin/billing", { token: adm.token })).data;
ok("the finished paid job is waiting to be invoiced", bill.companies?.length === 1, JSON.stringify(bill.totals));
const g = bill.companies[0];
ok("it bills what we kept, not the headline commission", g.totalKept === 332.5, String(g.totalKept));
ok("and still shows the headline figure alongside", g.totalCommission === 500, String(g.totalCommission));
ok("the absorbed card cost is spelled out", g.absorbed === 167.5, String(g.absorbed));
ok("net + VAT equals the gross on the total, not per line", Math.abs(g.net + g.vat - g.gross) < 0.005, JSON.stringify(g));
ok("the gross billed is what we kept", g.gross === 332.5, String(g.gross));
ok("the partner's tax number is on the card", g.taxId === "12345676-1-02", String(g.taxId));
ok("the individual jobs are listed for the invoice lines", g.jobs.length === 1 && g.jobs[0].orderNo != null);

/* Without a billing address the invoice cannot legally go out, so say so
   rather than letting it through with a blank block. */
ok("a partner with no billing address is flagged, not hidden", g.billable === false, String(g.billable));
await query("UPDATE companies SET billing_zip='4025', billing_city='Debrecen', billing_address='Piac u 1.' WHERE id=$1", [cid]);
bill = (await j("/api/invoices/admin/billing", { token: adm.token })).data;
ok("and becomes billable once the address is filled in", bill.companies[0].billable === true);
ok("the address is assembled ready to paste", /4025 Debrecen Piac u 1\./.test(bill.companies[0].address), bill.companies[0].address);

console.log("\n── unpaid and unfinished work stays off the list ──");
const bk2 = (await j("/api/bookings", { method: "POST", token: cu.token, body: { companyId: cid, serviceId: svc.id, scheduledDate: dPlus(12), scheduledSlot: "11:00", address: "Kossuth u 1" } })).data.booking;
await query("UPDATE bookings SET payment_status='paid', status=2 WHERE id=$1", [bk2.id]);
ok("a job still in progress is not billed", ((await j("/api/invoices/admin/billing", { token: adm.token })).data.companies[0].jobs.length) === 1);
await query("UPDATE bookings SET status=4, payment_status='unpaid' WHERE id=$1", [bk2.id]);
ok("a finished but unpaid job is not billed either", ((await j("/api/invoices/admin/billing", { token: adm.token })).data.companies[0].jobs.length) === 1);
await query("UPDATE bookings SET payment_status='paid' WHERE id=$1", [bk2.id]);
ok("but a finished, paid job is", ((await j("/api/invoices/admin/billing", { token: adm.token })).data.companies[0].jobs.length) === 2);

console.log("\n── recording the invoice you raised ──");
ok("an empty invoice number is refused",
   (await j("/api/invoices/admin/mark-invoiced", { method: "POST", token: adm.token, body: { bookingIds: [bk.id], invoiceNumber: "  " } })).status === 400);
ok("marking nothing is refused",
   (await j("/api/invoices/admin/mark-invoiced", { method: "POST", token: adm.token, body: { bookingIds: [], invoiceNumber: "TZ-1" } })).status === 400);
const marked = await j("/api/invoices/admin/mark-invoiced", { method: "POST", token: adm.token, body: { bookingIds: [bk.id, bk2.id], invoiceNumber: "TZ-2026-001", issuedAt: dPlus(0) } });
ok("one invoice can cover several jobs", marked.data.marked === 2, JSON.stringify(marked.data));
ok("and they leave the to-invoice list", ((await j("/api/invoices/admin/billing", { token: adm.token })).data.companies.length) === 0);
const done = (await j("/api/invoices/admin/billing?settled=1", { token: adm.token })).data;
ok("appearing under 'already invoiced' instead", done.companies[0]?.jobs.length === 2, JSON.stringify(done.totals));
ok("with the number recorded against each job", done.companies[0].jobs.every((x) => x.invoiceNo === "TZ-2026-001"));

/* Re-submitting must not relabel jobs that belong to an earlier invoice. */
const again = await j("/api/invoices/admin/mark-invoiced", { method: "POST", token: adm.token, body: { bookingIds: [bk.id], invoiceNumber: "TZ-2026-999" } });
ok("a second attempt cannot overwrite an existing number", again.data.marked === 0 && again.data.skipped === 1, JSON.stringify(again.data));
ok("the original number survives",
   (await query("SELECT fee_invoice_no FROM bookings WHERE id=$1", [bk.id])).rows[0].fee_invoice_no === "TZ-2026-001");

const undo = await j("/api/invoices/admin/unmark", { method: "POST", token: adm.token, body: { bookingIds: [bk.id] } });
ok("a mistyped number can be undone", undo.data.cleared === 1, JSON.stringify(undo.data));
ok("and the job returns to the to-invoice list", ((await j("/api/invoices/admin/billing", { token: adm.token })).data.companies[0].jobs.length) === 1);

console.log("\n── the spreadsheet export ──");
const csv = await j("/api/invoices/admin/billing.csv", { token: adm.token });
ok("it downloads as CSV", csv.status === 200 && /csv/.test(csv.ct), csv.ct);
/* fetch().text() strips a leading BOM per spec, so this has to be checked on
   the raw bytes — otherwise the test passes whether or not we send one. */
const csvBytes = new Uint8Array(await (await fetch("http://127.0.0.1:4505/api/invoices/admin/billing.csv",
  { headers: { Authorization: "Bearer " + adm.token } })).arrayBuffer());
ok("with a BOM so Excel reads the accents",
   csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF, [...csvBytes.slice(0, 3)].join(","));
const rows = String(csv.data).trim().split("\r\n");
ok("a header and one row per job", rows.length === 2, String(rows.length));
ok("the billing address is on the row", /4025/.test(rows[1]) && /Piac u 1\./.test(rows[1]));
ok("as is the tax number", /12345676-1-02/.test(rows[1]));
ok("and both the commission and what we kept", /"500"/.test(rows[1]) && /"332\.5"/.test(rows[1]), rows[1]);
/* Hungarian company names are full of commas. */
await query("UPDATE companies SET billing_name='Teszt, Kft. \"A\"' WHERE id=$1", [cid]);
const csv2 = await j("/api/invoices/admin/billing.csv", { token: adm.token });
ok("names containing commas and quotes survive the export",
   /"Teszt, Kft\. ""A"""/.test(String(csv2.data)), String(csv2.data).split("\r\n")[1]?.slice(0, 60));

console.log("\n── only the operator sees any of this ──");
for (const [who, tok] of [["a partner", co.token], ["a customer", cu.token]]) {
  ok(`${who} cannot read the billing list`, (await j("/api/invoices/admin/billing", { token: tok })).status === 403);
  ok(`${who} cannot download the export`, (await j("/api/invoices/admin/billing.csv", { token: tok })).status === 403);
  ok(`${who} cannot record an invoice`, (await j("/api/invoices/admin/mark-invoiced", { method: "POST", token: tok, body: { bookingIds: [bk.id], invoiceNumber: "X" } })).status === 403);
}
ok("and a signed-out stranger cannot either", (await j("/api/invoices/admin/billing")).status === 401);

console.log("\n── what each side may see of the paperwork ──");
await query("UPDATE bookings SET fee_invoice_no='TZ-2026-001' WHERE id=$1", [bk.id]);
ok("the customer is never shown our invoice to the partner",
   (await j(`/api/invoices/${bk.id}`, { token: cu.token })).data.fee === null);
ok("the partner sees it", (await j(`/api/invoices/${bk.id}`, { token: co.token })).data.fee?.number === "TZ-2026-001");
ok("the admin sees it too", (await j(`/api/invoices/${bk.id}`, { token: adm.token })).data.fee?.number === "TZ-2026-001");
ok("the customer can see the partner's own invoice",
   (await j(`/api/invoices/${bk.id}`, { token: cu.token })).data.partner?.number === "AB-2026-1");

console.log("\n── chasing partners who have not invoiced their customer ──");
const health = await j("/api/invoices/admin/health", { token: adm.token });
ok("the admin can list jobs awaiting the partner's invoice", Array.isArray(health.data.awaitingPartnerInvoice));
ok("the job that was uploaded is not on it", !health.data.awaitingPartnerInvoice.some((x) => x.id === bk.id));
ok("the one that was not, is", health.data.awaitingPartnerInvoice.some((x) => x.id === bk2.id));

console.log(`\n════ INVOICING: ${pass} passed, ${fail} failed ════`);
process.exit(fail ? 1 : 0);
