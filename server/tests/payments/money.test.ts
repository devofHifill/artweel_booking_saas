import { describe, expect, it } from 'vitest';
import {
  allocateRefund,
  collectedCents,
  depositFor,
  priceBooking,
} from '../../src/modules/payments/money';

/**
 * Money arithmetic. Pure, so these are fast and exhaustive.
 *
 * Every case here is one where being a cent out, or multiplying the wrong
 * thing, produces a customer complaint rather than a crash.
 */

describe('pricing a booking', () => {
  it('multiplies the seat price but charges travel once', () => {
    // Six people in one van is one trip. Multiplying travel by seats is the
    // kind of error a customer notices and never forgives.
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 6,
      travelFeeCents: 6500,
    });

    expect(price.subtotalCents).toBe(57_000);
    expect(price.travelFeeCents).toBe(6500);
    expect(price.totalCents).toBe(63_500);
  });

  it('charges in full when no deposit is configured', () => {
    const price = priceBooking({ unitPriceCents: 9500, seats: 1 });

    expect(price.dueNowCents).toBe(9500);
    expect(price.balanceCents).toBe(0);
    expect(price.kind).toBe('FULL');
  });

  it('splits a percentage deposit from the balance', () => {
    const price = priceBooking({
      unitPriceCents: 45_000,
      seats: 1,
      depositType: 'percent',
      depositValue: 25,
    });

    expect(price.dueNowCents).toBe(11_250);
    expect(price.balanceCents).toBe(33_750);
    expect(price.kind).toBe('DEPOSIT');
  });

  it('applies the deposit to the travel fee as well as the class', () => {
    // The deposit is a share of what the customer actually owes, and travel is
    // part of that. Depositing only against the class price under-collects on
    // exactly the bookings with the most cost to the studio if cancelled.
    const price = priceBooking({
      unitPriceCents: 40_000,
      seats: 1,
      travelFeeCents: 6500,
      depositType: 'percent',
      depositValue: 50,
    });

    expect(price.totalCents).toBe(46_500);
    expect(price.dueNowCents).toBe(23_250);
  });

  it('never lets a fixed deposit exceed the total', () => {
    // A £50 standing deposit against a £30 class must charge £30.
    const price = priceBooking({
      unitPriceCents: 3000,
      seats: 1,
      depositType: 'fixed',
      depositValue: 5000,
    });

    expect(price.dueNowCents).toBe(3000);
    expect(price.balanceCents).toBe(0);
    expect(price.kind).toBe('FULL');
  });

  it('rounds a percentage deposit up', () => {
    // Rounding down leaves the studio a cent short on the deposit and a cent
    // over on the balance, which is how reconciliation reports start lying.
    expect(depositFor(9999, 'percent', 33)).toBe(3300);
    expect(depositFor(10_001, 'percent', 50)).toBe(5001);
  });

  it('treats a free service as needing no payment', () => {
    const price = priceBooking({ unitPriceCents: 0, seats: 3 });

    expect(price.totalCents).toBe(0);
    expect(price.requiresPayment).toBe(false);
  });

  it('ignores a negative or fractional seat count', () => {
    expect(priceBooking({ unitPriceCents: 1000, seats: -5 }).totalCents).toBe(1000);
    expect(priceBooking({ unitPriceCents: 1000, seats: 2.7 }).totalCents).toBe(2000);
  });
});

describe('allocating a refund across payments', () => {
  const deposit = {
    id: 'p_deposit',
    amountCents: 10_000,
    refundedCents: 0,
    succeededAt: new Date('2026-06-01T10:00:00Z'),
  };
  const balance = {
    id: 'p_balance',
    amountCents: 30_000,
    refundedCents: 0,
    succeededAt: new Date('2026-07-01T10:00:00Z'),
  };

  it('takes from the most recent payment first', () => {
    // The freshest charge is least likely to be outside the provider's refund
    // window or already partially refunded.
    const allocations = allocateRefund([deposit, balance], 5000);

    expect(allocations).toEqual([{ paymentId: 'p_balance', amountCents: 5000 }]);
  });

  it('spills over into the earlier payment when one is not enough', () => {
    const allocations = allocateRefund([deposit, balance], 35_000);

    expect(allocations).toEqual([
      { paymentId: 'p_balance', amountCents: 30_000 },
      { paymentId: 'p_deposit', amountCents: 5000 },
    ]);
  });

  it('never gives back more than a payment still holds', () => {
    const partlyRefunded = { ...balance, refundedCents: 28_000 };
    const allocations = allocateRefund([deposit, partlyRefunded], 10_000);

    expect(allocations).toEqual([
      { paymentId: 'p_balance', amountCents: 2000 },
      { paymentId: 'p_deposit', amountCents: 8000 },
    ]);
  });

  it('stops when the payments are exhausted rather than inventing money', () => {
    const allocations = allocateRefund([deposit], 99_999);
    const total = allocations.reduce((s, a) => s + a.amountCents, 0);

    expect(total).toBe(10_000);
  });

  it('skips fully refunded payments', () => {
    const spent = { ...deposit, refundedCents: 10_000 };
    expect(allocateRefund([spent], 5000)).toEqual([]);
  });
});

describe('what has actually been collected', () => {
  it('counts succeeded payments net of refunds and ignores the rest', () => {
    const total = collectedCents([
      { amountCents: 10_000, refundedCents: 0, status: 'SUCCEEDED' },
      { amountCents: 30_000, refundedCents: 5000, status: 'PARTIALLY_REFUNDED' },
      { amountCents: 20_000, refundedCents: 0, status: 'PENDING' },
      { amountCents: 15_000, refundedCents: 0, status: 'FAILED' },
      { amountCents: 8000, refundedCents: 8000, status: 'REFUNDED' },
    ]);

    // 10,000 + (30,000 - 5,000). Pending and failed never counted; a fully
    // refunded payment nets to zero.
    expect(total).toBe(35_000);
  });
});
