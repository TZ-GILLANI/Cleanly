/* THE INVOICE, FROM THE BUTTON TO THE INBOX.

   Musa reported "there is no place to upload the invoice" twice, and I claimed
   it fixed twice. The first claim was wrong because the box was rendered inside
   the OPEN jobs list (status < 4) while refusing to render unless status was 4
   — two conditions that can never both hold, so it had never appeared once.

   Claiming a third time is not worth anything. This walks the whole path with
   the real server: finish a job, pay it, post exactly what the upload box
   posts, and check what actually left the building. Resend is stubbed so the
   outgoing message can be inspected rather than sent.

   Run: node test/invoiceflow.mjs                                             */
process.env.PGMEM = "1";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "if-test";
process.env.PORT = "4610";
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "Cleano <no-reply@cleano.hu>";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.stack || e); process.exit(1); });

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, e); } };

/* ── Catch the outgoing mail ── */
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) {
    sent.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

const BASE = "http://localhost:4610";
const j = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
await import("../server/index.js");
await new Promise((r) => setTimeout(r, 900));
const { query } = await import("../server/db.js");
const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

await j("/api/auth/register", { method: "POST", body: {
  fullName: "Boss", email: "if-b@t.hu", password: "secret123", role: "company",
  companyName: "Invoice Kft", taxId: "10000001-1-02", city: "Debrecen",
  phone: "+36301112233", termsAccepted: true } });
const cid = (await query("SELECT id FROM companies WHERE name = $1", ["Invoice Kft"])).rows[0].id;
await query("UPDATE companies SET is_listed = true, is_approved = true WHERE id = $1", [cid]);
await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["if-b@t.hu"]);
const coTok = (await j("/api/auth/login", { method: "POST", body: { email: "if-b@t.hu", password: "secret123" } })).data.token;
const svcId = (await query(`INSERT INTO services (company_id,name,description,price_huf,minutes,is_active)
  VALUES ($1,'Deep clean','x',12000,60,true) RETURNING id`, [cid])).rows[0].id;
const cuTok = (await j("/api/auth/register", { method: "POST", body: {
  fullName: "Ana Kovacs", email: "if-c@t.hu", password: "secret123", role: "customer", customerType: "resident",
  city: "Debrecen", address: "Piac utca 1", phone: "+36703031941", termsAccepted: true } })).data.token;

const bk = await j("/api/bookings", { method: "POST", token: cuTok, body: {
  companyId: cid, serviceId: svcId, scheduledDate: dPlus(4), scheduledSlot: "10:00",
  address: "Piac utca 1, Debrecen", city: "Debrecen", paymentMethod: "cash" } });
const bid = bk.data.booking.id;

console.log("\n── before the job is finished ──");
{
  const early = await j(`/api/invoices/${bid}/partner`, { method: "POST", token: coTok, body: {
    invoiceNumber: "2026/001", issuedAt: dPlus(0), pdf: "data:application/pdf;base64,JVBERi0xLjQK" } });
  ok("an unfinished job cannot be invoiced", early.status >= 400, `got ${early.status}`);
  /* Not "no email at all" — booking a job legitimately emails the company.
     The claim is that no INVOICE went out, which is the thing that would be
     wrong. A blanket count would have failed for an unrelated, correct email
     and told me nothing about invoices. */
  ok("and no invoice was emailed",
     !sent.some((m) => /invoice|számla/i.test(m.subject || "")),
     sent.map((m) => m.subject).join(" | "));
}

console.log("\n── the job is done and paid ──");
await query("UPDATE bookings SET status = 4, payment_status = 'paid' WHERE id = $1", [bid]);
{
  const inv = await j(`/api/invoices/${bid}`, { token: coTok });
  ok("the box can read the invoice state for this booking", inv.status === 200, JSON.stringify(inv.data).slice(0, 120));
  ok("and there is no partner invoice yet", !inv.data.partner, JSON.stringify(inv.data).slice(0, 120));
}

console.log("\n── exactly what the upload box posts ──");
const PDF = "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoK";
{
  const up = await j(`/api/invoices/${bid}/partner`, { method: "POST", token: coTok, body: {
    invoiceNumber: "2026/001", issuedAt: dPlus(0), pdf: PDF } });
  ok("the upload is accepted", up.status === 200, JSON.stringify(up.data).slice(0, 160));

  await new Promise((r) => setTimeout(r, 400));   // the send is fire-and-forget

  const stored = await j(`/api/invoices/${bid}`, { token: coTok });
  ok("the invoice is recorded against the booking", !!stored.data.partner, JSON.stringify(stored.data).slice(0, 140));
  ok("with the number the company typed", stored.data.partner?.number === "2026/001", String(stored.data.partner?.number));
}

console.log("\n── what actually left the building ──");
{
  ok("an email was sent", sent.length >= 1, `${sent.length} messages`);
  const mail = sent[sent.length - 1];
  ok("to the CUSTOMER, not the company", String(mail?.to).includes("if-c@t.hu"), String(mail?.to));
  ok("the subject names an invoice", /invoice|számla/i.test(mail?.subject || ""), String(mail?.subject));
  ok("the PDF is attached", Array.isArray(mail?.attachments) && mail.attachments.length === 1,
     JSON.stringify(mail?.attachments || []).slice(0, 120));
  const att = (mail?.attachments || [])[0];
  ok("the attachment has a filename", !!att?.filename, String(att?.filename));
  ok("and bare base64 — a data: prefix would arrive as an unreadable file",
     typeof att?.content === "string" && !att.content.startsWith("data:"), String(att?.content || "").slice(0, 24));
  ok("which decodes back to a real PDF", (() => {
    try { return Buffer.from(att.content, "base64").toString("latin1").startsWith("%PDF"); } catch { return false; }
  })(), String(att?.content || "").slice(0, 24));
  ok("the body mentions the company", /Invoice Kft/.test(mail?.html || ""), String(mail?.html || "").slice(0, 120));
}

console.log("\n── and the customer has it in the app too ──");
{
  const mine = ((await j("/api/bookings", { token: cuTok })).data.bookings || []).find((b) => b.id === bid);
  const notes = await j("/api/notifications", { token: cuTok });
  ok("a notification was raised", (notes.data.notifications || []).some((n) => /invoice|számla/i.test(n.title || "")),
     JSON.stringify((notes.data.notifications || []).map((n) => n.title)).slice(0, 160));
  const invForCustomer = await j(`/api/invoices/${bid}`, { token: cuTok });
  ok("the customer can fetch the invoice record", invForCustomer.status === 200, `got ${invForCustomer.status}`);
  ok("the booking is still theirs and still paid", mine?.payment_status === "paid");
}

console.log("\n── uploading twice does not send twice ──");
{
  const before = sent.length;
  const again = await j(`/api/invoices/${bid}/partner`, { method: "POST", token: coTok, body: {
    invoiceNumber: "2026/002", issuedAt: dPlus(0), pdf: PDF } });
  await new Promise((r) => setTimeout(r, 300));
  ok("a second upload is either refused or replaces the first, not duplicated blindly",
     again.status >= 400 || sent.length === before + 1, `status ${again.status}, mails ${sent.length - before}`);
}

console.log("\n── another company cannot invoice this job ──");
{
  await j("/api/auth/register", { method: "POST", body: {
    fullName: "Other", email: "if-o@t.hu", password: "secret123", role: "company",
    companyName: "Other Kft", taxId: "10000001-1-02", city: "Debrecen",
    phone: "+36301119999", termsAccepted: true } });
  await query("UPDATE users SET approval_status = 'approved' WHERE email = $1", ["if-o@t.hu"]);
  const otherTok = (await j("/api/auth/login", { method: "POST", body: { email: "if-o@t.hu", password: "secret123" } })).data.token;
  const steal = await j(`/api/invoices/${bid}/partner`, { method: "POST", token: otherTok, body: {
    invoiceNumber: "X", issuedAt: dPlus(0), pdf: PDF } });
  ok("a stranger's company is refused", steal.status >= 400, `got ${steal.status}`);
  const asCustomer = await j(`/api/invoices/${bid}/partner`, { method: "POST", token: cuTok, body: {
    invoiceNumber: "X", issuedAt: dPlus(0), pdf: PDF } });
  ok("and so is the customer", asCustomer.status >= 400, `got ${asCustomer.status}`);
}

console.log("\n── the rule lives on the server, not only in the screen ──");
{
  /* The upload box simply never offered a button on an unfinished job. That is
     not the same as the server refusing one, and this route had no status
     check at all — a partner could have invoiced work that had not happened. */
  const fs = await import("fs");
  const inv = fs.readFileSync(new URL("../server/routes/invoices.js", import.meta.url), "utf8");
  ok("the route itself requires a completed job", /Number\(a\.b\.status\) !== 4/.test(inv));
  ok("and a paid one", /a\.b\.payment_status !== "paid"/.test(inv));
}

console.log(`\n════ INVOICE FLOW: ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
