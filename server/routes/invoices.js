import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────
   Invoices.

   Two documents per paid booking:
     1. The PARTNER's invoice to the customer — the partner issues it in their
        own system and uploads it here. We never issue in their name, so no
        delegated-issuance mandate is needed.
     2. OUR invoice to the partner for the platform fee — raised by the operator
        outside the app and its number recorded here. Nothing is issued
        automatically: no invoicing provider is wired in, and none can be
        triggered by a payment webhook or a retry.

   The two are tied together by the Cleano booking number, which is printed on
   our invoice as the order number. That is the audit trail: from either
   document you can find the booking, and from the booking both invoices.
   ───────────────────────────────────────────────────────────────────────── */

const MAX_PDF_BYTES = 5 * 1024 * 1024;

/* Only the people actually involved in a booking may see its paperwork. */
async function loadBooking(req, id) {
  const r = await query(
    `SELECT b.*, c.owner_id AS company_owner
       FROM bookings b LEFT JOIN companies c ON c.id = b.company_id
      WHERE b.id = $1`, [id]);
  const b = r.rows[0];
  if (!b) return { code: 404 };
  const isCustomer = b.customer_id === req.user.id;
  const isCompany = req.user.role === "company" && b.company_id === req.user.companyId;
  const isAdmin = req.user.role === "admin";
  if (!isCustomer && !isCompany && !isAdmin) return { code: 403 };
  return { b, isCustomer, isCompany, isAdmin };
}

/* POST /api/invoices/:bookingId/partner — the partner uploads their invoice */
router.post("/:bookingId/partner", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const a = await loadBooking(req, req.params.bookingId);
    if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Booking not found" : "Not your booking" });
    if (!a.isCompany) return res.status(403).json({ error: "Not your booking" });

    const number = String(req.body?.invoiceNumber || "").trim();
    const issuedAt = String(req.body?.issuedAt || "").slice(0, 10);
    const pdf = req.body?.pdf;   // data URL or bare base64

    if (number.length < 3 || number.length > 60) return res.status(400).json({ error: "Enter the invoice number from your own invoice" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) return res.status(400).json({ error: "Enter the invoice date" });

    let b64 = null;
    if (pdf) {
      b64 = String(pdf).includes(",") ? String(pdf).split(",").pop() : String(pdf);
      /* base64 is about 4/3 of the real size — check before we put it in a row. */
      if (b64.length * 0.75 > MAX_PDF_BYTES) return res.status(400).json({ error: "That file is too large — 5 MB maximum" });
      if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return res.status(400).json({ error: "That doesn't look like a PDF" });
    }

    await query(
      `UPDATE bookings SET partner_invoice_no = $1, partner_invoice_at = $2,
              partner_invoice_pdf = COALESCE($3, partner_invoice_pdf)
        WHERE id = $4`,
      [number, issuedAt, b64, req.params.bookingId]);

    /* Tell the customer their invoice has arrived — it is the thing they chase. */
    try {
      const { notify } = await import("../lib/notify.js");
      await notify(a.b.customer_id, "invoice", "Your invoice is ready",
        `Invoice ${number} for booking #${a.b.order_no} is now in the app.`, a.b.id);
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    console.error("partner invoice upload:", e.message);
    res.status(500).json({ error: "Could not save the invoice" });
  }
});

/* GET /api/invoices/:bookingId — what paperwork exists for this booking */
router.get("/:bookingId", requireAuth, async (req, res) => {
  try {
    const a = await loadBooking(req, req.params.bookingId);
    if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Booking not found" : "Not your booking" });
    const b = a.b;
    res.json({
      orderNo: b.order_no,
      partner: b.partner_invoice_no
        ? { number: b.partner_invoice_no, issuedAt: b.partner_invoice_at, hasPdf: !!b.partner_invoice_pdf }
        : null,
      /* The platform-fee invoice is between Cleano and the partner. The customer
         is not a party to it and does not get to see it. */
      fee: (a.isCompany || a.isAdmin) && b.fee_invoice_no
        ? { number: b.fee_invoice_no, issuedAt: b.fee_invoice_at, hasPdf: !!b.fee_invoice_pdf }
        : null,
      feeError: a.isAdmin ? b.fee_invoice_error || null : null,
    });
  } catch (e) {
    console.error("invoice list:", e.message);
    res.status(500).json({ error: "Could not load the invoices" });
  }
});

/* GET /api/invoices/:bookingId/:which.pdf — download one of them */
router.get("/:bookingId/:which.pdf", requireAuth, async (req, res) => {
  try {
    const which = req.params.which === "fee" ? "fee" : "partner";
    const a = await loadBooking(req, req.params.bookingId);
    if (a.code) return res.status(a.code).json({ error: a.code === 404 ? "Booking not found" : "Not your booking" });
    if (which === "fee" && a.isCustomer && !a.isAdmin) return res.status(403).json({ error: "Not your invoice" });

    const b64 = which === "fee" ? a.b.fee_invoice_pdf : a.b.partner_invoice_pdf;
    if (!b64) return res.status(404).json({ error: "No PDF stored for that invoice" });
    const no = which === "fee" ? a.b.fee_invoice_no : a.b.partner_invoice_no;

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${String(no || which).replace(/[^\w.\-]+/g, "_")}.pdf"`);
    res.set("Cache-Control", "no-store, private");
    res.send(Buffer.from(b64, "base64"));
  } catch (e) {
    console.error("invoice pdf:", e.message);
    res.status(500).json({ error: "Could not open the invoice" });
  }
});

/* GET /api/invoices/company/outstanding — jobs the partner still has to invoice */
router.get("/company/outstanding", requireAuth, requireRole("company"), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, order_no, scheduled_date, total_huf, service_fee_huf
         FROM bookings
        WHERE company_id = $1 AND status = 4 AND payment_status = 'paid'
          AND partner_invoice_no IS NULL
        ORDER BY scheduled_date ASC LIMIT 200`, [req.user.companyId]);
    res.json({ bookings: r.rows });
  } catch (e) {
    console.error("outstanding invoices:", e.message);
    res.status(500).json({ error: "Could not load the list" });
  }
});

/* GET /api/invoices/admin/health — where the paperwork is broken, platform-wide */
router.get("/admin/health", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    /* There is no longer an automatic issuer that can fail, so the old
       "failed invoices" half of this is gone. What remains is the one thing
       nobody else is watching: partners who finished a paid job and never
       uploaded the invoice they owe their customer. */
    const missing = await query(
      `SELECT b.id, b.order_no, b.scheduled_date, c.name AS company_name
         FROM bookings b LEFT JOIN companies c ON c.id = b.company_id
        WHERE b.status = 4 AND b.payment_status = 'paid' AND b.partner_invoice_no IS NULL
        ORDER BY b.scheduled_date ASC LIMIT 200`);
    res.json({ awaitingPartnerInvoice: missing.rows });
  } catch (e) {
    console.error("invoice health:", e.message);
    res.status(500).json({ error: "Could not load invoice health" });
  }
});


/* ─────────────────────────────────────────────────────────────────────────
   What to invoice.

   Cleano's commission is taken automatically at the moment of payment — Stripe
   splits it before the partner's money ever lands. So this is not a debt to
   chase. It is the paperwork that has to follow money already collected: a VAT
   invoice from TZ Gillani Kft to each partner for the commission kept.

   Two numbers per job, and confusing them would overstate the tax owed:
     · commission  — the headline 10%, what the partner sees quoted
     · kept        — what actually reached Cleano after absorbing Stripe's cut
   The invoice is for what was KEPT. The difference is a cost Cleano bore, not
   income it received.
   ───────────────────────────────────────────────────────────────────────── */
router.get("/admin/billing", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { feeLines, platformVatPct, feeKeptHuf } = await import("../lib/fees.js");
    const vatPct = platformVatPct();
    const settled = String(req.query.settled || "") === "1";

    const r = await query(
      `SELECT b.id, b.order_no, b.scheduled_date, b.total_huf, b.service_fee_huf,
              b.platform_net_minor, b.fee_invoice_no, b.fee_invoice_at,
              c.id AS company_id,
              COALESCE(NULLIF(c.billing_name,''), c.name) AS billing_name,
              c.name AS company_name, c.tax_id,
              c.billing_zip, COALESCE(NULLIF(c.billing_city,''), c.city) AS billing_city,
              c.billing_address,
              COALESCE(NULLIF(c.billing_email,''), u.email) AS billing_email
         FROM bookings b
         JOIN companies c ON c.id = b.company_id
         LEFT JOIN users u ON u.id = c.owner_id
        WHERE b.status = 4 AND b.payment_status = 'paid' AND b.service_fee_huf > 0
          AND (($1 = true AND b.fee_invoice_no IS NOT NULL)
            OR ($1 = false AND b.fee_invoice_no IS NULL))
        ORDER BY c.name ASC, b.scheduled_date ASC
        LIMIT 1000`, [settled]);

    /* Grouped in JS rather than SQL: the per-job rows are needed anyway for the
       invoice lines, and one pass is cheaper than a second aggregate query. */
    const byCompany = new Map();
    for (const row of r.rows) {
      const kept = feeKeptHuf(row);
      if (!byCompany.has(row.company_id)) {
        byCompany.set(row.company_id, {
          companyId: row.company_id,
          name: row.billing_name || row.company_name,
          tradingName: row.company_name,
          taxId: row.tax_id,
          address: [row.billing_zip, row.billing_city, row.billing_address].filter(Boolean).join(" "),
          email: row.billing_email,
          /* Say so plainly rather than letting an invoice go out with a blank
             address block. */
          billable: !!(row.billing_zip && row.billing_city && row.billing_address),
          jobs: [], totalKept: 0, totalCommission: 0,
        });
      }
      const g = byCompany.get(row.company_id);
      g.jobs.push({
        id: row.id, orderNo: row.order_no, date: String(row.scheduled_date).slice(0, 10),
        totalHuf: Number(row.total_huf) || 0,
        commissionHuf: Number(row.service_fee_huf) || 0,
        keptHuf: kept,
        invoiceNo: row.fee_invoice_no || null,
        invoicedAt: row.fee_invoice_at || null,
      });
      g.totalKept += kept;
      g.totalCommission += Number(row.service_fee_huf) || 0;
    }

    const companies = [...byCompany.values()].map((g) => {
      /* Split the TOTAL once, not each job then summed — rounding each line and
         adding them up can miss the gross by a forint, and an invoice whose
         lines do not add up to its own total is a rejected invoice. */
      const lines = feeLines(g.totalKept, vatPct);
      return { ...g, net: lines.net, vat: lines.vat, gross: lines.gross,
               absorbed: Math.round((g.totalCommission - g.totalKept) * 100) / 100 };
    });

    res.json({
      vatPct, settled,
      companies,
      totals: {
        jobs: r.rows.length,
        kept: Math.round(companies.reduce((a, c) => a + c.totalKept, 0) * 100) / 100,
        commission: Math.round(companies.reduce((a, c) => a + c.totalCommission, 0) * 100) / 100,
      },
    });
  } catch (e) {
    console.error("billing list:", e.message);
    res.status(500).json({ error: "Could not build the billing list" });
  }
});

/* POST /api/invoices/admin/mark-invoiced — record the invoice you raised.

   Takes a list of bookings so one invoice can cover a month of jobs for one
   partner, which is how anybody actually bills. */
router.post("/admin/mark-invoiced", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const number = String(req.body?.invoiceNumber || "").trim();
    const ids = Array.isArray(req.body?.bookingIds) ? req.body.bookingIds.filter(Boolean) : [];
    if (!number) return res.status(400).json({ error: "Enter the invoice number you issued" });
    if (number.length > 60) return res.status(400).json({ error: "That number is too long" });
    if (!ids.length) return res.status(400).json({ error: "No jobs selected" });
    if (ids.length > 500) return res.status(400).json({ error: "Too many jobs at once" });

    const issuedAt = String(req.body?.issuedAt || "").trim();
    const when = /^\d{4}-\d{2}-\d{2}$/.test(issuedAt) ? issuedAt : null;

    /* Never overwrite a number already recorded — re-submitting the form must
       not silently re-label jobs that belong to an earlier invoice. */
    let n = 0;
    for (const id of ids) {
      const r = await query(
        `UPDATE bookings SET fee_invoice_no = $1, fee_invoice_at = COALESCE($2::date, NOW())
          WHERE id = $3 AND fee_invoice_no IS NULL RETURNING id`, [number, when, id]);
      n += r.rows.length;
    }

    try {
      const { logAdmin } = await import("../lib/adminlog.js");
      await logAdmin(req, "fee_invoice.recorded", "invoice", number, `${n} job(s)`);
    } catch {}

    res.json({ ok: true, marked: n, skipped: ids.length - n });
  } catch (e) {
    console.error("mark invoiced:", e.message);
    res.status(500).json({ error: "Could not record that" });
  }
});

/* POST /api/invoices/admin/unmark — undo a mistyped number */
router.post("/admin/unmark", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.bookingIds) ? req.body.bookingIds.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: "No jobs selected" });
    let n = 0;
    for (const id of ids) {
      const r = await query(
        "UPDATE bookings SET fee_invoice_no = NULL, fee_invoice_at = NULL WHERE id = $1 RETURNING id", [id]);
      n += r.rows.length;
    }
    try {
      const { logAdmin } = await import("../lib/adminlog.js");
      await logAdmin(req, "fee_invoice.unrecorded", "invoice", null, `${n} job(s)`);
    } catch {}
    res.json({ ok: true, cleared: n });
  } catch (e) {
    console.error("unmark invoiced:", e.message);
    res.status(500).json({ error: "Could not undo that" });
  }
});

/* GET /api/invoices/admin/billing.csv — the same list as a spreadsheet.

   One row per job, with the partner's full billing details repeated on every
   row. That is deliberate redundancy: it means the file can be sorted, filtered
   or pivoted by whoever raises the invoices without losing the address block. */
router.get("/admin/billing.csv", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { feeLines, platformVatPct, feeKeptHuf } = await import("../lib/fees.js");
    const vatPct = platformVatPct();
    const settled = String(req.query.settled || "") === "1";

    const r = await query(
      `SELECT b.order_no, b.scheduled_date, b.total_huf, b.service_fee_huf,
              b.platform_net_minor, b.fee_invoice_no, b.fee_invoice_at,
              COALESCE(NULLIF(c.billing_name,''), c.name) AS billing_name,
              c.name AS company_name, c.tax_id, c.billing_zip,
              COALESCE(NULLIF(c.billing_city,''), c.city) AS billing_city,
              c.billing_address,
              COALESCE(NULLIF(c.billing_email,''), u.email) AS billing_email
         FROM bookings b
         JOIN companies c ON c.id = b.company_id
         LEFT JOIN users u ON u.id = c.owner_id
        WHERE b.status = 4 AND b.payment_status = 'paid' AND b.service_fee_huf > 0
          AND (($1 = true AND b.fee_invoice_no IS NOT NULL)
            OR ($1 = false AND b.fee_invoice_no IS NULL))
        ORDER BY c.name ASC, b.scheduled_date ASC
        LIMIT 5000`, [settled]);

    /* Quote everything and double any quote inside. Hungarian company names
       contain commas ("Kft., Bt.") far too often to risk bare fields.

       And guard against formula injection. Excel and LibreOffice evaluate any
       cell beginning with = + - @ or a control character, and the partner
       chooses their own company name and address. Quoting protects the FILE
       format; it does nothing about the spreadsheet's formula parser, which
       strips the quotes before it looks. The person who opens this file is the
       operator — the single account worth attacking on the platform.

       A leading apostrophe makes the cell literal text. Numbers are ours, not
       theirs, so they pass through untouched and stay right-aligned. */
    const RISKY = /^[=+\-@\t\r]/;
    const q = (v) => {
      if (typeof v === "number") return `"${v}"`;
      const raw = String(v == null ? "" : v);
      const safe = RISKY.test(raw) ? "'" + raw : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = ["Partner (billing name)", "Trading name", "Tax number", "Postcode", "City",
                  "Address", "Email", "Booking no", "Job date", "Customer paid (HUF)",
                  "Commission 10% (HUF)", "Cleano kept (HUF)", "Card cost absorbed (HUF)",
                  `Net (HUF)`, `VAT ${vatPct}% (HUF)`, "Gross (HUF)", "Invoice no", "Invoiced on"];

    const lines = [head.map(q).join(",")];
    for (const row of r.rows) {
      const kept = feeKeptHuf(row);
      const commission = Number(row.service_fee_huf) || 0;
      const { net, vat, gross } = feeLines(kept, vatPct);
      lines.push([
        row.billing_name, row.company_name, row.tax_id, row.billing_zip, row.billing_city,
        row.billing_address, row.billing_email, row.order_no,
        String(row.scheduled_date).slice(0, 10),
        Number(row.total_huf) || 0, commission, kept,
        Math.round((commission - kept) * 100) / 100,
        net, vat, gross,
        row.fee_invoice_no || "", row.fee_invoice_at ? String(row.fee_invoice_at).slice(0, 10) : "",
      ].map(q).join(","));
    }

    const name = `cleano-billing-${settled ? "invoiced" : "to-invoice"}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.set("Cache-Control", "no-store, private");
    /* BOM so Excel opens the Hungarian accents correctly instead of mojibake. */
    res.send("﻿" + lines.join("\r\n"));
  } catch (e) {
    console.error("billing csv:", e.message);
    res.status(500).json({ error: "Could not build the export" });
  }
});

export default router;
