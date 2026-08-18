/* The platform fee, split for an invoice.

   This is all that survives of the Számlázz.hu integration, and it is the part
   worth keeping: the arithmetic. Cleano's commission is quoted gross, but an
   invoice has to show net and VAT separately, and the two must add back up to
   the gross exactly — a one-forint rounding slip is a wrong invoice.

   Everything else about billing now happens outside the app: the operator
   raises the invoice themselves and records the number here afterwards. */

export function feeLines(grossHuf, vatPct = 27) {
  const gross = Math.round(Number(grossHuf) * 100) / 100;
  const net = Math.round((gross / (1 + vatPct / 100)) * 100) / 100;
  /* Derived by subtraction rather than computed independently, so net + VAT is
     the gross by construction and cannot drift by a rounding step. */
  const vat = Math.round((gross - net) * 100) / 100;
  return { gross, net, vat, vatPct };
}

export const platformVatPct = () => Number(process.env.PLATFORM_FEE_VAT_PCT || 27);

/* What Cleano actually kept on a booking, in forints.

   Two shapes exist in the wild. Direct charges (the current model) record
   platform_net_minor — the commission after Cleano absorbed Stripe's cut on the
   partner's behalf. Older destination charges have no such figure, because
   Stripe billed Cleano separately and the whole commission was kept. */
export function feeKeptHuf(booking) {
  return booking?.platform_net_minor != null
    ? Math.round(Number(booking.platform_net_minor)) / 100
    : Number(booking?.service_fee_huf) || 0;
}
