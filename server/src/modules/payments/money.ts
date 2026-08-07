/**
 * All money arithmetic, in one pure module.
 *
 * THE RULE: an amount charged to a customer is computed HERE, on the server,
 * from records in our own database. A price arriving in a request body is
 * ignored. The previous implementation had this instinct right — it refused a
 * client-supplied `payment_method=paypal` — and this is the same principle
 * applied to the number itself.
 *
 * Integer cents throughout. Floats produce 4599.999999999999 and then a
 * one-cent reconciliation problem that takes an afternoon to find.
 */

export type DepositType = 'none' | 'percent' | 'fixed';

export type PriceInput = {
  /** Per seat, before anything else. */
  unitPriceCents: number;
  seats: number;
  travelFeeCents?: number;
  depositType?: DepositType;
  /** A percentage when depositType is "percent", otherwise cents. */
  depositValue?: number;
};

export type PriceBreakdown = {
  subtotalCents: number;
  travelFeeCents: number;
  totalCents: number;
  /** What must be paid now to hold the booking. */
  dueNowCents: number;
  /** What is left to settle later. Zero when paid in full. */
  balanceCents: number;
  requiresPayment: boolean;
  kind: 'DEPOSIT' | 'FULL';
};

export function priceBooking(input: PriceInput): PriceBreakdown {
  const seats = Math.max(1, Math.floor(input.seats));
  const subtotalCents = Math.max(0, Math.round(input.unitPriceCents)) * seats;

  /**
   * Travel is charged once per visit, not per seat. A six-person mobile party
   * is one van making one trip; multiplying the travel fee by six is the kind
   * of error a customer notices and never forgives.
   */
  const travelFeeCents = Math.max(0, Math.round(input.travelFeeCents ?? 0));
  const totalCents = subtotalCents + travelFeeCents;

  const dueNowCents = depositFor(totalCents, input.depositType, input.depositValue);

  return {
    subtotalCents,
    travelFeeCents,
    totalCents,
    dueNowCents,
    balanceCents: totalCents - dueNowCents,
    requiresPayment: dueNowCents > 0,
    kind: dueNowCents === totalCents ? 'FULL' : 'DEPOSIT',
  };
}

/**
 * How much is taken up front.
 *
 * A deposit is always clamped to the total: a fixed £50 deposit on a £30 class
 * must charge £30, not £50. Percentages round UP so the studio is never left
 * a cent short on the deposit and a cent over on the balance.
 */
export function depositFor(
  totalCents: number,
  depositType: DepositType = 'none',
  depositValue = 0,
): number {
  if (totalCents <= 0) return 0;

  switch (depositType) {
    case 'none':
      // No deposit configured means payment in full at booking.
      return totalCents;
    case 'percent': {
      const pct = Math.min(100, Math.max(0, depositValue));
      return Math.min(totalCents, Math.ceil((totalCents * pct) / 100));
    }
    case 'fixed':
      return Math.min(totalCents, Math.max(0, Math.round(depositValue)));
    default:
      return totalCents;
  }
}

/**
 * Splits a refund across the payments that made up a booking.
 *
 * A booking can have a deposit and a balance taken on different cards weeks
 * apart. Refunding "50%" is not one instruction to one charge — it has to be
 * apportioned, and each individual refund is capped at what that payment can
 * still give back.
 *
 * Most recent first: the balance payment is the freshest charge, least likely
 * to be past the provider's refund window, and least likely to have already
 * been partially refunded.
 */
export type RefundablePayment = {
  id: string;
  amountCents: number;
  refundedCents: number;
  succeededAt: Date | null;
};

export function allocateRefund(
  payments: RefundablePayment[],
  refundCents: number,
): { paymentId: string; amountCents: number }[] {
  if (refundCents <= 0) return [];

  const ordered = [...payments]
    .filter((p) => p.amountCents > p.refundedCents)
    .sort((a, b) => (b.succeededAt?.getTime() ?? 0) - (a.succeededAt?.getTime() ?? 0));

  const allocations: { paymentId: string; amountCents: number }[] = [];
  let remaining = refundCents;

  for (const payment of ordered) {
    if (remaining <= 0) break;

    const available = payment.amountCents - payment.refundedCents;
    const take = Math.min(available, remaining);

    if (take > 0) {
      allocations.push({ paymentId: payment.id, amountCents: take });
      remaining -= take;
    }
  }

  return allocations;
}

/** Total actually collected, ignoring anything still pending or failed. */
export function collectedCents(
  payments: { amountCents: number; refundedCents: number; status: string }[],
): number {
  return payments
    .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
    .reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);
}
