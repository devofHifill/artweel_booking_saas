/**
 * Phone numbers for people to read, one way (FB-17).
 *
 * The dashboard showed numbers exactly as typed, so the customer list could
 * read "5550102200", "+1 555 010 2200" and "(555) 010-2200" one under the
 * other. Same rules as the server's `lib/phone.ts` (which the booking page,
 * storefront and texts use): US / Canada numbers as "(555) 010-2200",
 * anything with a country code as typed, nothing guessed at.
 */
export function formatPhone(raw: string | null | undefined): string {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text.startsWith('00')) return text;

  const digits = text.replace(/\D/g, '');
  const nanp =
    (text.startsWith('+') && digits.length === 11 && digits.startsWith('1')) ||
    (!text.startsWith('+') &&
      (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))));
  if (!nanp) return text;

  const ten = digits.slice(-10);
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
