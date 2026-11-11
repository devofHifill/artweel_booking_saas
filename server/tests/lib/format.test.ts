import { describe, expect, it } from 'vitest';
import { formatPhone, telHref, toE164 } from '../../src/lib/phone';
import { formatMoney } from '../../src/lib/money';

/* FB-17: one way to show money and phone numbers, and to text a number. */

describe('phone numbers', () => {
  it('reads US and Canada numbers however they were typed', () => {
    for (const typed of ['5550102200', '(555) 010-2200', '555.010.2200', '1 555 010 2200', '+1 555 010 2200']) {
      expect(toE164(typed)).toBe('+15550102200');
      expect(formatPhone(typed)).toBe('(555) 010-2200');
    }
  });

  it('keeps an international number, showing it as typed', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('0044 20 7946 0958')).toBe('+442079460958');
    expect(formatPhone('+44  20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('does not guess at a number it cannot read', () => {
    expect(toE164('020 7946 0958')).toBeNull();
    expect(toE164('12345')).toBeNull();
    expect(toE164('')).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(formatPhone('020 7946 0958')).toBe('020 7946 0958');
  });

  it('links to the number a phone can dial', () => {
    expect(telHref('(555) 010-2200')).toBe('+15550102200');
    expect(telHref('020 7946 0958')).toBe('02079460958');
  });
});

describe('money', () => {
  it('drops cents only on whole amounts', () => {
    expect(formatMoney(9500)).toBe('$95');
    expect(formatMoney(9550)).toBe('$95.50');
    expect(formatMoney(4500, 'GBP')).toBe('£45');
  });
});
