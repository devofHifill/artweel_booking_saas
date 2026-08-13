import { DateTime } from 'luxon';

/**
 * Built-in message templates.
 *
 * A studio that never opens the settings page still sends sensible messages —
 * for a self-serve product with nobody staffing support, the defaults ARE the
 * product for most customers.
 *
 * Substitution is deliberately dumb: `{{name}}`, nothing else. No loops, no
 * conditionals, no expression evaluation. A studio owner editing their
 * confirmation email must not be able to write something that throws at send
 * time, and a template language is an injection surface nobody needs.
 */

export const TemplateKey = {
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_RESCHEDULED: 'booking.rescheduled',
  REMINDER_24H: 'reminder.24h',
  REMINDER_2H: 'reminder.2h',
  /**
   * "Your work is ready."
   *
   * The one message in the system a customer is actively waiting for, and the
   * reason piece tracking earns its keep — a studio otherwise fields the same
   * phone call from twelve people a week.
   */
  PIECE_READY: 'piece.ready',
  /**
   * "A place has opened up." Time-limited by nature — the message has to say
   * so, or somebody replies three days later expecting the seat to be there.
   */
  WAITLIST_OFFER: 'waitlist.offer',
} as const;

export type TemplateKey = (typeof TemplateKey)[keyof typeof TemplateKey];

type Template = { subject?: string; body: string };

export const DEFAULT_TEMPLATES: Record<
  string,
  { EMAIL: Template; SMS?: Template }
> = {
  [TemplateKey.BOOKING_CONFIRMED]: {
    EMAIL: {
      subject: 'You are booked in — {{serviceName}} on {{dateShort}}',
      body: `Hi {{customerName}},

You are booked in for {{serviceName}}.

When: {{dateLong}} at {{time}} ({{timezoneLabel}})
Where: {{locationLine}}{{staffLine}}{{seatsLine}}
Total: {{total}}

Need to change or cancel? {{manageUrl}}

See you soon,
{{studioName}}`,
    },
    SMS: {
      body: '{{studioName}}: booked in for {{serviceName}}, {{dateShort}} at {{time}}. Manage: {{manageUrl}} Reply STOP to opt out.',
    },
  },

  [TemplateKey.REMINDER_24H]: {
    EMAIL: {
      subject: 'Tomorrow: {{serviceName}} at {{time}}',
      body: `Hi {{customerName}},

A reminder that {{serviceName}} is tomorrow.

When: {{dateLong}} at {{time}} ({{timezoneLabel}})
Where: {{locationLine}}

Can't make it? Let us know as soon as you can: {{manageUrl}}

{{studioName}}`,
    },
    SMS: {
      body: '{{studioName}}: reminder, {{serviceName}} tomorrow at {{time}}. {{manageUrl}} Reply STOP to opt out.',
    },
  },

  [TemplateKey.REMINDER_2H]: {
    EMAIL: {
      subject: 'Today: {{serviceName}} at {{time}}',
      body: `Hi {{customerName}},

{{serviceName}} starts at {{time}} today.

Where: {{locationLine}}

{{studioName}}`,
    },
    SMS: {
      body: '{{studioName}}: {{serviceName}} starts at {{time}} today. See you soon!',
    },
  },

  [TemplateKey.BOOKING_CANCELLED]: {
    EMAIL: {
      subject: 'Cancelled — {{serviceName}} on {{dateShort}}',
      body: `Hi {{customerName}},

Your booking for {{serviceName}} on {{dateLong}} has been cancelled.

{{refundLine}}

{{studioName}}`,
    },
    SMS: {
      body: '{{studioName}}: your booking for {{serviceName}} on {{dateShort}} is cancelled. {{refundLine}}',
    },
  },

  [TemplateKey.BOOKING_RESCHEDULED]: {
    EMAIL: {
      subject: 'Moved — {{serviceName}} is now {{dateShort}}',
      body: `Hi {{customerName}},

Your booking for {{serviceName}} has moved.

New time: {{dateLong}} at {{time}} ({{timezoneLabel}})
Where: {{locationLine}}

Manage this booking: {{manageUrl}}

{{studioName}}`,
    },
  },

  [TemplateKey.PIECE_READY]: {
    EMAIL: {
      subject: 'Your work is ready to collect',
      body: `Hi {{customerName}},

{{pieceLabel}} is out of the kiln and ready to collect.

{{shelfLine}}
{{holdLine}}

{{studioName}}`,
    },
    SMS: {
      // Kept short deliberately: this is the one message most likely to be
      // read on a phone in a supermarket queue.
      body: '{{studioName}}: your work ({{pieceLabel}}) is ready to collect. {{holdLine}}',
    },
  },

  [TemplateKey.WAITLIST_OFFER]: {
    EMAIL: {
      subject: 'A place has opened — {{serviceName}} on {{dateShort}}',
      body: `Hi {{customerName}},

A place has come free in {{serviceName}}.

When: {{dateLong}} at {{time}} ({{timezoneLabel}})
Where: {{locationLine}}

It is being held for you until {{offerExpiry}}. After that it goes to the
next person on the list.

Take it: {{claimUrl}}

{{studioName}}`,
    },
    SMS: {
      body: '{{studioName}}: a place opened in {{serviceName}} on {{dateShort}}. Held for you until {{offerExpiry}}: {{claimUrl}}',
    },
  },
};

/**
 * Replaces `{{token}}` with its value.
 *
 * Unknown tokens collapse to an empty string rather than being left visible.
 * A customer seeing a literal `{{staffLine}}` in their confirmation is worse
 * than a slightly terse sentence, and a studio WILL eventually paste a token
 * that does not exist.
 */
export function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

export type BookingContext = {
  customerName: string;
  studioName: string;
  serviceName: string;
  startsAt: Date;
  timezone: string;
  locationName?: string | null;
  locationAddress?: string | null;
  staffName?: string | null;
  seats: number;
  totalCents: number;
  currency: string;
  manageUrl: string;
  refundCents?: number;
};

/**
 * Turns a booking into template values.
 *
 * Times are formatted in the STUDIO's zone, not the server's and not the
 * customer's browser. A reminder saying 2pm must mean 2pm at the studio door.
 */
export function buildValues(ctx: BookingContext): Record<string, string> {
  const dt = DateTime.fromJSDate(ctx.startsAt, { zone: ctx.timezone });

  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: ctx.currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);

  // Assembled as whole lines so a template can drop them without leaving a
  // dangling label like "With:" on its own.
  const staffLine = ctx.staffName ? `\nWith: ${ctx.staffName}` : '';
  const seatsLine = ctx.seats > 1 ? `\nPlaces: ${ctx.seats}` : '';
  const locationLine =
    [ctx.locationName, ctx.locationAddress].filter(Boolean).join(' — ') ||
    'Details to follow';

  const refundLine =
    ctx.refundCents === undefined
      ? ''
      : ctx.refundCents > 0
        ? `A refund of ${money(ctx.refundCents)} is on its way.`
        : 'No refund is due under the cancellation policy.';

  return {
    customerName: ctx.customerName,
    studioName: ctx.studioName,
    serviceName: ctx.serviceName,
    dateShort: dt.toFormat('d LLL'),
    dateLong: dt.toFormat('cccc d LLLL yyyy'),
    time: dt.toFormat('h:mm a'),
    timezoneLabel: dt.toFormat('ZZZZ'),
    locationLine,
    staffLine,
    seatsLine,
    seats: String(ctx.seats),
    total: money(ctx.totalCents),
    manageUrl: ctx.manageUrl,
    refundLine,
  };
}
