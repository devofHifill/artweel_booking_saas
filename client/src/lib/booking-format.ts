/**
 * What a customer actually books, in words a studio owner recognises (FB-12).
 *
 * "Type" said Class / Event and left the owner to guess the difference. Each
 * format now carries a short name, what it is, and what the price pays for —
 * the one question every owner asks when setting a price. Used by the
 * Activities list, Create activity and the activity editor, so all three say
 * the same thing.
 */
export type BookingFormat = {
  /** The name used everywhere: list, badge, review. */
  label: string;
  /** What it is, in a few words. */
  summary: string;
  /** What one price buys. */
  price: string;
  /** Both, in a few words, for a table cell. */
  short: string;
};

export const FORMATS = {
  CLASS: {
    label: 'Class',
    summary: 'Multi-session course — customers book the whole series',
    price: 'One price covers every session',
    short: 'Multi-session · one price for all',
  },
  EVENT: {
    label: 'Event',
    summary: 'Single-session experience — customers book one date',
    price: 'Priced per seat',
    short: 'One date · per seat',
  },
  GROUP: {
    label: 'Group class',
    summary: 'Customers book a seat on any session you schedule',
    price: 'Priced per seat',
    short: 'Any session · per seat',
  },
  APPOINTMENT: {
    label: 'One to one',
    summary: 'One customer books time with an instructor',
    price: 'Priced per booking',
    short: 'With an instructor · per booking',
  },
} satisfies Record<string, BookingFormat>;

/** The format of an activity as the Activities list holds it. */
export function bookingFormat(svc: {
  kind?: string | null;
  bookingMode?: string | null;
}): BookingFormat {
  if (svc.kind === 'CLASS' || svc.bookingMode === 'COURSE_SERIES') return FORMATS.CLASS;
  if (svc.kind === 'EVENT') return FORMATS.EVENT;
  if (svc.bookingMode === 'APPOINTMENT') return FORMATS.APPOINTMENT;
  return FORMATS.GROUP;
}
