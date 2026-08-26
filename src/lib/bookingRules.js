/* Booking rules the SERVER owns and the screen must obey.

   The slot picker hides hours that have already gone. It used to do that with
   its own hardcoded lead time while the server read BOOKING_LEAD_MIN from the
   environment — identical today, and silently different the moment that
   variable changes in Render. The picker would then offer a slot the server
   refuses, or hide one it would have taken.

   /api/payments/config publishes the real numbers; the store calls set() once
   they arrive. This lives in its own file so the store can set it and the app
   can read it without the two importing each other in a circle.

   The defaults are only what we assume until that first call answers. */
const rules = { leadMin: 60, subChargeDays: 5 };

export const bookingRules = () => rules;
export const leadMinutes = () => rules.leadMin;
export function setBookingRules(next) {
  if (!next) return;
  if (Number.isFinite(Number(next.leadMin))) rules.leadMin = Math.max(0, Number(next.leadMin));
  if (Number.isFinite(Number(next.subChargeDays))) rules.subChargeDays = Math.max(1, Number(next.subChargeDays));
}
