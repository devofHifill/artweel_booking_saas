/**
 * Phone numbers, one way (FB-17).
 *
 * Numbers are stored as people type them: "5550102200", "+1 555 010 2200",
 * "(555) 010-2200". They were shown that way too, so one screen could list
 * three spellings of the same kind of number, and they were handed to Twilio
 * that way, which accepts only E.164 (+15550102200): a customer who typed
 * brackets never got a text.
 *
 * Stored values are left alone (nothing to migrate, nothing to lose). These
 * read them: `toE164` for sending and links, `formatPhone` for display.
 *
 * Without a numbering-plan library, the rules are deliberately narrow:
 * - "+" (or "00") and 8 to 15 digits is an international number, kept as is.
 * - 10 digits, or 11 starting with 1, is a US / Canada number (+1).
 * - Anything else is not guessed at: shown as typed, and not texted.
 */

const NANP = /^1?(\d{3})(\d{3})(\d{4})$/;

/** The number in E.164 (+15550102200), or null when it cannot be read as one. */
export function toE164(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (text.startsWith('00')) {
    const rest = digits.slice(2);
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }
  if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
    return `+1${digits.slice(-10)}`;
  }
  return null;
}

/**
 * The number for people to read: "(555) 010-2200" for US / Canada, the
 * international number as typed (spaces tidied) otherwise.
 */
export function formatPhone(raw: string | null | undefined): string {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  const e164 = toE164(text);
  if (e164?.startsWith('+1') && e164.length === 12) {
    const m = NANP.exec(e164.slice(1))!;
    return `(${m[1]}) ${m[2]}-${m[3]}`;
  }
  return text;
}

/** For a `tel:` link: E.164 when readable, else the digits and any leading +. */
export function telHref(raw: string | null | undefined): string {
  return toE164(raw) ?? (raw ?? '').replace(/[^+\d]/g, '');
}
