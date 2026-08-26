/* A DATE column is not a string.

   node-postgres parses a `date` column into a JS Date, so the obvious
   String(row.scheduled_date).slice(0, 10) produces "Fri Sep 04" — the first ten
   characters of "Fri Sep 04 2026 …". Not a date, not an error, just quietly
   wrong: a comparison that never matches, a notification with a nonsense day
   in it, a stored "moved from" that can never equal the row it came from.

   This has now bitten three separate features. One helper, used everywhere a
   date column becomes text.                                                  */
export function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
