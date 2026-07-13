import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { huTaxIdValid, huRegNumberValid, formatTaxId } from "../lib/validate.js";

const router = Router();

/* GET /api/companies — public: all approved+listed companies */
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, name, emoji, tagline, area, city, google_place_id, student_discount, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE is_listed = true AND is_approved = true ORDER BY rating DESC, review_count DESC"
    );
    res.json({ companies: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

/* GET /api/companies/:id — public */
router.get("/:id", async (req, res) => {
  try {
    const result = await query("SELECT id, name, emoji, tagline, area, city, google_place_id, student_discount, rating, review_count, cover, logo_url, is_listed, is_approved, created_at FROM companies WHERE id = $1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Company not found" });
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company" });
  }
});

/* PUT /api/companies/:id — company owner only */
router.put("/:id", requireAuth, requireRole("company"), async (req, res) => {
  const { name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId, regNumber, contactPhone, documents, city, googlePlaceId } = req.body;
  if (req.user.companyId !== req.params.id) return res.status(403).json({ error: "Not your company" });
  if (taxId && !huTaxIdValid(taxId)) return res.status(400).json({ error: "Invalid Hungarian tax number (adószám). Format: 12345678-1-42." });
  if (regNumber && !huRegNumberValid(regNumber)) return res.status(400).json({ error: "Invalid registration number (cégjegyzékszám). Format: 09-09-123456." });

  try {
    const result = await query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        emoji = COALESCE($2, emoji),
        tagline = COALESCE($3, tagline),
        area = COALESCE($4, area),
        student_discount = COALESCE($5, student_discount),
        cover = COALESCE($6, cover),
        logo_url = COALESCE($7, logo_url),
        tax_id = COALESCE($8, tax_id),
        reg_number = COALESCE($9, reg_number),
        contact_phone = COALESCE($10, contact_phone),
        documents = COALESCE($11, documents),
        city = COALESCE($12, city),
        google_place_id = COALESCE($13, google_place_id)
      WHERE id = $14 RETURNING *`,
      [name, emoji, tagline, area, studentDiscount, cover, logoUrl, taxId ? formatTaxId(taxId) : null, regNumber, contactPhone,
       Array.isArray(documents) ? JSON.stringify(documents.slice(0, 6)) : null, city || null, googlePlaceId !== undefined ? String(googlePlaceId).slice(0, 100) : null, req.params.id]
    );
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update company" });
  }
});

export default router;
