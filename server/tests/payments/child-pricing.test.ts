import { describe, expect, it } from 'vitest';
import { priceBooking } from '../../src/modules/payments/money';

/**
 * Adult and child seats in one party.
 *
 * `seats` is the WHOLE party and `children` is how many of those seats are
 * children — not a second party size sitting beside the first. Most of what
 * is worth testing here follows from that one decision, and the cases that
 * matter are the ones where a caller gets the relationship wrong.
 */

describe('pricing a mixed party', () => {
  it('charges each half at its own rate', () => {
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 3,
      children: 1,
      childPriceCents: 5000,
    });

    expect(price.adults).toBe(2);
    expect(price.children).toBe(1);
    expect(price.adultSubtotalCents).toBe(19_000);
    expect(price.childSubtotalCents).toBe(5_000);
    expect(price.subtotalCents).toBe(24_000);
  });

  it('prices an all-adult party exactly as it did before children existed', () => {
    /*
      The regression that matters most. Every booking taken before this
      feature, and every one taken after it by a studio that never sets a
      child rate, goes through this path — and it must produce the same
      number it always did.
    */
    const before = priceBooking({ unitPriceCents: 9500, seats: 4 });
    const after = priceBooking({
      unitPriceCents: 9500,
      seats: 4,
      children: 0,
      childPriceCents: 5000,
    });

    expect(before.subtotalCents).toBe(38_000);
    expect(after.subtotalCents).toBe(38_000);
    expect(after.adults).toBe(4);
  });

  it('ignores a child rate nobody was charged at', () => {
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 2,
      children: 0,
      childPriceCents: 5000,
    });

    expect(price.childSubtotalCents).toBe(0);
    expect(price.subtotalCents).toBe(19_000);
  });

  it('treats a party that is all children as all children', () => {
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 2,
      children: 2,
      childPriceCents: 5000,
    });

    expect(price.adults).toBe(0);
    expect(price.adultSubtotalCents).toBe(0);
    expect(price.subtotalCents).toBe(10_000);
  });

  it('clamps more children than seats instead of pricing a negative adult', () => {
    /*
      THE case this clamp exists for. Without it, adults = 2 - 9 = -7 and the
      subtotal comes out BELOW the child rate — a discount for misreporting
      your family, reachable by anybody who can edit a request body.
    */
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 2,
      children: 9,
      childPriceCents: 5000,
    });

    expect(price.children).toBe(2);
    expect(price.adults).toBe(0);
    expect(price.subtotalCents).toBe(10_000);
    expect(price.subtotalCents).toBeGreaterThan(0);
  });

  it('treats a negative child count as none', () => {
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 2,
      children: -3,
      childPriceCents: 5000,
    });

    expect(price.children).toBe(0);
    expect(price.subtotalCents).toBe(19_000);
  });

  it('takes the deposit from the mixed total, not the adult total', () => {
    // A 50% deposit on two adults and two children is half of $290, not half
    // of $190. Getting this wrong undercharges every family booking.
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 4,
      children: 2,
      childPriceCents: 5000,
      depositType: 'percent',
      depositValue: 50,
    });

    expect(price.subtotalCents).toBe(29_000);
    expect(price.dueNowCents).toBe(14_500);
    expect(price.balanceCents).toBe(14_500);
  });

  it('still charges travel once for a mixed party', () => {
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 3,
      children: 2,
      childPriceCents: 5000,
      travelFeeCents: 6500,
    });

    expect(price.subtotalCents).toBe(19_500);
    expect(price.travelFeeCents).toBe(6500);
    expect(price.totalCents).toBe(26_000);
  });

  it('charges the adult rate for children when no child rate is set', () => {
    /*
      Zero means "adults only" and is the DEFAULT every service carries, so a
      party claiming children on one pays the adult rate for them.

      Multiplying by the zero rate instead would make every seat of every
      service in the product free to anyone who sends `children` — which is
      the entire catalogue until a studio sets a child price, and is exactly
      what this did before the guard went in.
    */
    const price = priceBooking({
      unitPriceCents: 9500,
      seats: 3,
      children: 2,
      childPriceCents: 0,
    });

    expect(price.subtotalCents).toBe(28_500);
    expect(price.adults).toBe(3);
    expect(price.children).toBe(0);
  });

  it('ignores an unset child rate rather than treating it as free', () => {
    // The same hole reached the other way: childPriceCents omitted entirely.
    const price = priceBooking({ unitPriceCents: 9500, seats: 2, children: 2 });

    expect(price.subtotalCents).toBe(19_000);
    expect(price.children).toBe(0);
  });
});
