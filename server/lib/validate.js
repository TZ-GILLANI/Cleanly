/* Hungarian company identifier validation.
   Adószám: XXXXXXXX-Y-ZZ — 8-digit base with checksum, VAT code 1–5, county code.
   Cégjegyzékszám: CC-FF-NNNNNN (county-form-serial). */

export function normalizeTaxId(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

export function huTaxIdValid(raw) {
  const d = normalizeTaxId(raw);
  if (d.length !== 11) return false;
  const w = [9, 7, 3, 1, 9, 7, 3];
  const sum = w.reduce((a, wi, i) => a + wi * Number(d[i]), 0);
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(d[7])) return false;               // checksum digit
  if (!"12345".includes(d[8])) return false;              // VAT status code
  const county = Number(d.slice(9, 11));
  return (county >= 2 && county <= 44) || county === 51;  // county / special codes
}

export function huRegNumberValid(raw) {
  const d = String(raw || "").replace(/[^0-9]/g, "");
  return d.length === 10; // CC-FF-NNNNNN
}

export function formatTaxId(raw) {
  const d = normalizeTaxId(raw);
  return d.length === 11 ? `${d.slice(0, 8)}-${d[8]}-${d.slice(9)}` : raw;
}

/* Cégjegyzékszám formatting: CC-FF-NNNNNN, dashes inserted for you. */
export function formatRegNumber(raw) {
  const d = String(raw || "").replace(/[^0-9]/g, "").slice(0, 10);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/* Live formatting for the tax number while it is being typed. formatTaxId()
   only reshapes a COMPLETE 11-digit number, which meant the dashes appeared in
   one jump at the end instead of guiding you there. */
export function formatTaxIdLive(raw) {
  const d = normalizeTaxId(raw).slice(0, 11);
  if (d.length <= 8) return d;
  if (d.length === 9) return `${d.slice(0, 8)}-${d[8]}`;
  return `${d.slice(0, 8)}-${d[8]}-${d.slice(9)}`;
}

/* ── EU VAT number (közösségi adószám) ───────────────────────────
   Optional, and only meaningful for cross-border invoicing inside the EU.
   Each member state has its own shape; these are the official ones. The
   Hungarian number is the first 8 digits of the adószám with HU in front,
   which is worth checking against the tax number they already gave us —
   a mismatch there is a typo, not a second company. */
const VAT_SHAPES = {
  AT: /^ATU\d{8}$/,           BE: /^BE0\d{9}$/,          BG: /^BG\d{9,10}$/,
  HR: /^HR\d{11}$/,           CY: /^CY\d{8}[A-Z]$/,      CZ: /^CZ\d{8,10}$/,
  DK: /^DK\d{8}$/,            EE: /^EE\d{9}$/,           FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/, DE: /^DE\d{9}$/,           GR: /^(EL|GR)\d{9}$/,
  HU: /^HU\d{8}$/,            IE: /^IE\d{7}[A-Z]{1,2}$/, IT: /^IT\d{11}$/,
  LV: /^LV\d{11}$/,           LT: /^LT(\d{9}|\d{12})$/,  LU: /^LU\d{8}$/,
  MT: /^MT\d{8}$/,            NL: /^NL\d{9}B\d{2}$/,     PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,            RO: /^RO\d{2,10}$/,        SK: /^SK\d{10}$/,
  SI: /^SI\d{8}$/,            ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  SE: /^SE\d{12}$/,
};

export function normalizeVat(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* Returns { ok, reason } so the app can say WHY rather than just going red. */
export function euVatCheck(raw, countryCode, taxId) {
  const v = normalizeVat(raw);
  if (!v) return { ok: true, reason: "empty" };            // optional
  const prefix = v.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(prefix)) return { ok: false, reason: "no_country" };
  const shape = VAT_SHAPES[prefix === "EL" ? "GR" : prefix];
  if (!shape) return { ok: false, reason: "not_eu" };
  if (!shape.test(v)) return { ok: false, reason: "shape" };
  const co = String(countryCode || "").toUpperCase();
  if (co && VAT_SHAPES[co] && prefix !== co && !(co === "GR" && prefix === "EL"))
    return { ok: false, reason: "country_mismatch" };
  if (prefix === "HU" && taxId) {
    const base = normalizeTaxId(taxId).slice(0, 8);
    if (base.length === 8 && base !== v.slice(2)) return { ok: false, reason: "tax_mismatch" };
  }
  return { ok: true, reason: "ok" };
}
