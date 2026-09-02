/**
 * A single booking as an .ics file.
 *
 * G5. Nothing in this codebase emitted VCALENDAR before — grep found not one
 * BEGIN:VEVENT — so "add to calendar" was a button the prototype had and the
 * product did not.
 *
 * Hand-written rather than pulled from a library. The format needed here is
 * one VEVENT with six properties; a dependency for that is a dependency to
 * audit, update and ship for the sake of about forty lines.
 *
 * Times are emitted in UTC with a trailing Z. That is deliberate: the studio's
 * zone is already baked into the instant, and a floating local time would land
 * a Portland class at 6pm in whatever zone the reader's calendar happens to be
 * in. RFC 5545 §3.3.5 form 2.
 */

/**
 * RFC 5545 §3.3.11. Backslash, semicolon and comma are escaped, and a newline
 * becomes a literal \n — an unescaped one would end the property and produce a
 * file most calendars reject outright.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 20260902T180000Z */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.1: no line may exceed 75 octets. Continuations begin with a
 * single space, which the parser strips.
 *
 * Measured in BYTES, not characters. A studio called "Café Céramique" is
 * longer than it looks, and folding on character count can split a multi-byte
 * character across two lines — which is how a calendar import fails with a
 * message nobody can act on.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    // 75 on the first line, 74 after — the leading space costs one octet.
    const limit = out.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);

    // Never cut mid-character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end -= 1;
    }

    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return out.join('\r\n ');
}

export type CalendarEvent = {
  /** Stable across re-downloads, so a calendar updates rather than duplicates. */
  uid: string;
  startsAt: Date;
  endsAt: Date;
  title: string;
  location?: string | null;
  description?: string | null;
};

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Artweel//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.description
      ? [`DESCRIPTION:${escapeText(event.description)}`]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF throughout, per the spec. Outlook is the one that minds.
  return lines.map(fold).join('\r\n') + '\r\n';
}
