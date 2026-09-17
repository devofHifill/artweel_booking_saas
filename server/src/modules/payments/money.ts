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
  /** Per ADULT seat, before anything else. */
  unitPriceCents: number;
  /**
   * The TOTAL party, adults and children together — the same number the
   * booking's `seats` column holds and the same number the session's capacity
   * is checked against.
   */
  seats: number;
  /**
   * How many of `seats` are children. Adults are seats - children.
   *
   * A count rather than a separate adult count, for the reason the column is
   * shaped that way: two independent numbers can disagree with each other and
   * one derived from the total cannot. Omitted means an all-adult party,
   * which is what every caller meant before child pricing existed.
   */
  children?: number;
  /** Per child seat. Ignored when `children` is 0. */
  childPriceCents?: number;
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
  /** The party as it was actually priced, for the confirmation to print. */
  adults: number;
  children: number;
  adultSubtotalCents: number;
  childSubtotalCents: number;
};

export function priceBooking(input: PriceInput): PriceBreakdown {
  const seats = Math.max(1, Math.floor(input.seats));

  const adultUnit = Math.max(0, Math.round(input.unitPriceCents));
  const childUnit = Math.max(0, Math.round(input.childPriceCents ?? 0));

  /**
   * Clamped to the party, and ignored entirely when there is no child rate.
   *
   * Two separate ways to be handed a number that must not be believed:
   *
   * 1. MORE CHILDREN THAN SEATS. Unclamped, adults = 2 - 9 = -7 and the
   *    subtotal lands BELOW the child rate — a discount for misreporting your
   *    family, available to anyone who can edit a request body.
   *
   * 2. CHILDREN ON A SERVICE WITH NO CHILD RATE. A zero child price means
   *    "adults only" — it is the DEFAULT every service carries, and the
   *    migration deliberately gave up telling it apart from "children go
   *    free". So a party claiming children here must pay the adult rate for
   *    them, not multiply by zero. Without this line every seat on every
   *    service in the product is free to anyone who sends `children`, which
   *    is the whole catalogue by default.
   */
  const claimed = Math.min(seats, Math.max(0, Math.floor(input.children ?? 0)));
  const children = childUnit > 0 ? claimed : 0;
  const adults = seats - children;

  const adultSubtotalCents = adultUnit * adults;
  const childSubtotalCents = childUnit * children;
  const subtotalCents = adultSubtotalCents + childSubtotalCents;

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
    adults,
    children,
    adultSubtotalCents,
    childSubtotalCents,
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
