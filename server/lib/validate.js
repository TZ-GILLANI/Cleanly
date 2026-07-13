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
