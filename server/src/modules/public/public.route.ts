import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rate-limit';
import { AppError } from '../../lib/app-error';
import { config } from '../../config';
import * as service from './public.service';
import { startCheckout } from '../payments/payment.service';
import { renderBookingPage, renderManagePage } from './booking-page';
import { buildIcs } from './ics';

/**
 * Unauthenticated. Everything here is reachable by anyone with the URL, so
 * every route is rate limited and every response is an explicit projection
 * rather than a raw record.
 *
 * Reads get a generous budget because a customer clicking through a calendar
 * legitimately makes many requests; writes get a tight one.
 */
export const publicRouter = Router();

const readLimit = rateLimit({ windowMs: 60_000, max: 120, name: 'public-read' });
const writeLimit = rateLimit({ windowMs: 60_000, max: 10, name: 'public-write' });

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const param = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

// --- Server-rendered pages ------------------------------------------------

/**
 * The booking page itself.
 *
 * Server-rendered rather than a client bundle: it is the page a studio links
 * from its Instagram bio, so it has to be fast on a phone on mobile data and
 * legible to a search crawler. The interactive steps are progressive
 * enhancement on top of real HTML.
 */
publicRouter.get(
  '/:slug',
  readLimit,
  asyncHandler(async (req, res) => {
    const data = await service.getStudioPage(param(req, 'slug'));
    res.type('html').send(renderBookingPage(data));
  }),
);

/** Where the link in a confirmation email lands. */
publicRouter.get(
  '/bookings/:token/manage',
  readLimit,
  asyncHandler(async (req, res) => {
    const data = await service.getBookingByToken(param(req, 'token'));
    res.type('html').send(renderManagePage(data, param(req, 'token')));
  }),
);

// --- JSON API used by the page --------------------------------------------

publicRouter.get(
  '/:slug/data',
  readLimit,
  asyncHandler(async (req, res) => {
    res.json(await service.getStudioPage(param(req, 'slug')));
  }),
);

publicRouter.get(
  '/:slug/services/:serviceTypeId/staff',
  readLimit,
  asyncHandler(async (req, res) => {
    const studio = await service.getStudio(param(req, 'slug'));
    res.json({
      staff: await service.getPublicStaff(studio.id, param(req, 'serviceTypeId')),
    });
  }),
);

publicRouter.get(
  '/:slug/availability',
  readLimit,
  validateQuery(
    z.object({
      serviceTypeId: z.string().uuid(),
      from: localDate,
      to: localDate,
      locationId: z.string().uuid().optional(),
      staffId: z.string().uuid().optional(),
      seats: z.coerce.number().int().min(1).max(50).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      serviceTypeId: string;
      from: string;
      to: string;
      locationId?: string;
      staffId?: string;
      seats?: number;
      lat?: number;
      lng?: number;
    };

    res.json(
      await service.getPublicAvailability({
        slug: param(req, 'slug'),
        serviceTypeId: q.serviceTypeId,
        fromLocalDate: q.from,
        toLocalDate: q.to,
        locationId: q.locationId,
        staffId: q.staffId,
        seats: q.seats,
        customerLocation:
          q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined,
      }),
    );
  }),
);

/** Asked before a time is chosen, never after. */
publicRouter.post(
  '/:slug/coverage',
  readLimit,
  validateBody(
    z.object({
      locationId: z.string().uuid(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.checkPublicCoverage(param(req, 'slug'), req.body.locationId, {
        lat: req.body.lat,
        lng: req.body.lng,
      }),
    );
  }),
);

publicRouter.post(
  '/:slug/bookings',
  writeLimit,
  validateBody(
    z.object({
      serviceTypeId: z.string().uuid(),
      sessionId: z.string().uuid().optional(),
      staffId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      startsAt: z.string().datetime().optional(),
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      serviceAddress: z
        .object({
          line1: z.string().min(1).max(200),
          city: z.string().max(100).optional(),
          postcode: z.string().max(20).optional(),
          lat: z.number().min(-90).max(90).optional(),
          lng: z.number().min(-180).max(180).optional(),
          notes: z.string().max(1000).optional(),
        })
        .optional(),
      /** TCPA: explicit, unbundled, and recorded with a timestamp. */
      smsConsent: z.boolean().default(false),
      notes: z.string().max(2000).optional(),
      /*
        Which surface the booking came from. Whitelisted rather than free-form
        so a caller cannot make up its own channel and end up in the dashboard
        donut as a slice nobody recognises. The embedded widget is the only
        thing that says anything other than 'web'; new channels get added here
        and to the SOURCE_LABELS map on the dashboard.
      */
      source: z.enum(['web', 'embed']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const booking = await service.createPublicBooking({
      ...req.body,
      slug: param(req, 'slug'),
      source: req.body.source ?? 'web',
    });

    res.status(201).json({
      booking: {
        id: booking!.id,
        /* The quotable half of the pair below: safe to print, safe to read
           down a phone, and useless to anybody who finds it. */
        reference: booking!.reference,
        startsAt: booking!.startsAt,
        endsAt: booking!.endsAt,
        seats: booking!.seats,
        status: booking!.status,
        totalCents: booking!.totalCents,
        travelFeeCents: booking!.travelFeeCents,
      },
      // The customer's only credential for managing this booking.
      manageToken: service.encodeToken(booking!.cancelToken),
    });
  }),
);

// --- Waitlists ------------------------------------------------------------

/** The alternative to a dead end when a class is full. */
publicRouter.post(
  '/:slug/sessions/:sessionId/waitlist',
  writeLimit,
  validateBody(
    z.object({
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      smsConsent: z.boolean().default(false),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await service.joinWaitlistPublic({
      ...req.body,
      slug: param(req, 'slug'),
      sessionId: param(req, 'sessionId'),
    });

    res.status(201).json({
      /** "You are third." The number that decides whether they keep waiting. */
      place: result.place,
      seats: result.entry.seats,
      status: result.entry.status,
    });
  }),
);

/**
 * The offer link from the email.
 *
 * Read and claim are separate so the link opens a page describing what is on
 * offer rather than silently booking somebody the moment they tap it from a
 * notification.
 */
publicRouter.get(
  '/waitlist/:token/claim',
  readLimit,
  asyncHandler(async (req, res) => {
    res.json(await service.getWaitlistOffer(param(req, 'token')));
  }),
);

publicRouter.post(
  '/waitlist/:token/claim',
  writeLimit,
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.claimWaitlistOffer(param(req, 'token')));
  }),
);

// --- Course cohorts -------------------------------------------------------

publicRouter.get(
  '/:slug/courses',
  readLimit,
  asyncHandler(async (req, res) => {
    res.json(await service.getPublicCourses(param(req, 'slug')));
  }),
);

/**
 * Enrolment on an unpriced cohort. Priced ones are refused with
 * COURSE_REQUIRES_PAYMENT rather than enrolled for free — see the note on
 * `enrollPublic` for why paid course checkout is separate.
 */
publicRouter.post(
  '/:slug/courses/:seriesId/enrollments',
  writeLimit,
  validateBody(
    z.object({
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      smsConsent: z.boolean().default(false),
      notes: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await service.enrollPublic({
      ...req.body,
      slug: param(req, 'slug'),
      courseSeriesId: param(req, 'seriesId'),
    });

    res.status(201).json({
      enrollment: {
        id: result.enrollment.id,
        seats: result.enrollment.seats,
        status: result.enrollment.status,
        totalCents: result.enrollment.totalCents,
        courseName: result.courseName,
        sessionCount: result.sessionCount,
      },
      manageToken: service.encodeToken(result.enrollment.cancelToken),
    });
  }),
);

/**
 * What will this cost, and how much of it now?
 *
 * G1. The summary panel needs a subtotal, a travel fee, a total and the
 * deposit split, and `money.ts` opens with the rule that an amount charged to
 * a customer is computed on the server. Working the deposit out again in the
 * page script would be a second copy of that arithmetic, drifting from the
 * first the moment either changes — so the page asks instead.
 *
 * A read, not a write: it reserves nothing, charges nothing, and takes the
 * read budget. The authoritative amount is still the one `startCheckout`
 * computes when the money actually moves; this is the same function run for
 * display.
 */
publicRouter.post(
  '/:slug/quote',
  readLimit,
  validateBody(
    z.object({
      serviceTypeId: z.string().uuid(),
      /** Quoting a whole cohort. Its price wins over the service's. */
      courseSeriesId: z.string().uuid().optional(),
      seats: z.number().int().min(1).max(50).default(1),
      /* Quoted, never trusted: the fee is re-derived from the studio's own
         bands at checkout. It is here so the summary can show a total that
         matches what the coverage check already told the customer. */
      travelFeeCents: z.number().int().min(0).max(1_000_00).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.quoteBooking({
        slug: param(req, 'slug'),
        serviceTypeId: req.body.serviceTypeId,
        courseSeriesId: req.body.courseSeriesId,
        seats: req.body.seats,
        travelFeeCents: req.body.travelFeeCents,
      }),
    );
  }),
);

/**
 * Buying a priced cohort.
 *
 * Same shape as class checkout and for the same reason: seats are held first,
 * across every week, and the enrolment is created by the webhook rather than
 * by the browser coming back. A student who pays and closes the tab is still
 * enrolled.
 */
publicRouter.post(
  '/:slug/courses/:seriesId/checkout',
  writeLimit,
  validateBody(
    z.object({
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      // No amount field. The price comes from the cohort record.
    }),
  ),
  asyncHandler(async (req, res) => {
    const { organization, series } = await service.getPublicCourseForCheckout(
      param(req, 'slug'),
      param(req, 'seriesId'),
    );

    const base = `${config.PUBLIC_URL}/public/${organization.slug}`;

    const result = await startCheckout({
      organizationId: organization.id,
      serviceTypeId: series.serviceTypeId,
      courseSeriesId: series.id,
      seats: req.body.seats,
      customerEmail: req.body.customer.email,
      customerName: req.body.customer.name,
      successUrl: `${base}?enrolled=1`,
      cancelUrl: `${base}?cancelled=1`,
    });

    res.status(201).json({
      checkoutUrl: result.checkoutUrl,
      expiresAt: result.expiresAt,
      price: result.price,
      courseName: series.name,
    });
  }),
);

/**
 * Paid bookings go through here instead of POST /bookings.
 *
 * The seats are held first, then the customer is sent to Stripe. The booking
 * itself is created by the webhook, not by the browser coming back — a
 * customer who pays and immediately closes the tab must still end up booked.
 */
publicRouter.post(
  '/:slug/checkout',
  writeLimit,
  validateBody(
    z.object({
      serviceTypeId: z.string().uuid(),
      sessionId: z.string().uuid(),
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      // Note there is no amount field. The price is computed server-side from
      // the service record; a client-supplied total is not merely ignored, it
      // has nowhere to be supplied.
    }),
  ),
  asyncHandler(async (req, res) => {
    const studio = await service.getStudio(param(req, 'slug'));
    const base = `${config.PUBLIC_URL}/public/${studio.slug}`;

    const result = await startCheckout({
      organizationId: studio.id,
      serviceTypeId: req.body.serviceTypeId,
      sessionId: req.body.sessionId,
      seats: req.body.seats,
      customerEmail: req.body.customer.email,
      customerName: req.body.customer.name,
      successUrl: `${base}?paid=1`,
      cancelUrl: `${base}?cancelled=1`,
    });

    res.status(201).json({
      checkoutUrl: result.checkoutUrl,
      expiresAt: result.expiresAt,
      price: result.price,
    });
  }),
);

// --- Self-service by token ------------------------------------------------

publicRouter.get(
  '/bookings/:token',
  readLimit,
  asyncHandler(async (req, res) => {
    const data = await service.getBookingByToken(param(req, 'token'));

    res.json({
      booking: {
        id: data.booking.id,
        reference: data.booking.reference,
        startsAt: data.booking.startsAt,
        endsAt: data.booking.endsAt,
        status: data.booking.status,
        seats: data.booking.seats,
        totalCents: data.booking.totalCents,
        service: data.booking.serviceType.name,
        staff: data.booking.staff?.name ?? null,
        location: data.booking.location?.name ?? null,
        studio: data.booking.organization.name,
        timezone: data.booking.timezone,
      },
      cancellationQuote: data.cancellationQuote,
      canReschedule: data.canReschedule,
    });
  }),
);

/**
 * The booking as a calendar file.
 *
 * G5. Served rather than built in the browser so the link works from the
 * confirmation EMAIL too, where there is no page script to build a blob — and
 * on a phone, where tapping a data: URI is unreliable and tapping a
 * text/calendar URL opens the calendar app.
 *
 * The token is the same secret the manage page uses. Anyone holding it can
 * already see and cancel the booking, so a calendar file tells them nothing
 * new; anyone without it gets the same 404 every other token route gives.
 */
publicRouter.get(
  '/bookings/:token/calendar.ics',
  readLimit,
  asyncHandler(async (req, res) => {
    const { booking } = await service.getBookingByToken(param(req, 'token'));

    const where =
      booking.location?.locationType === 'FIXED'
        ? [booking.location.name, booking.location.address]
            .filter(Boolean)
            .join(', ')
        : (booking.location?.name ?? null);

    const ics = buildIcs({
      /* The booking id, not the token. A UID is written into the reader's
         calendar and may be synced onward; the token is a credential and has
         no business travelling with it. */
      uid: `booking-${booking.id}@artweel`,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      title: `${booking.serviceType.name} — ${booking.organization.name}`,
      location: where,
      description: [
        booking.reference ? `Booking reference ${booking.reference}` : null,
        booking.serviceType.preparationNotes,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    res
      .type('text/calendar; charset=utf-8')
      .set(
        'Content-Disposition',
        `attachment; filename="${booking.reference ?? 'booking'}.ics"`,
      )
      .send(ics);
  }),
);

publicRouter.post(
  '/bookings/:token/cancel',
  writeLimit,
  asyncHandler(async (req, res) => {
    res.json(await service.cancelByToken(param(req, 'token')));
  }),
);

publicRouter.post(
  '/bookings/:token/reschedule',
  writeLimit,
  validateBody(z.object({ startsAt: z.string().datetime() })),
  asyncHandler(async (req, res) => {
    res.json(
      await service.rescheduleByToken(param(req, 'token'), req.body.startsAt),
    );
  }),
);
