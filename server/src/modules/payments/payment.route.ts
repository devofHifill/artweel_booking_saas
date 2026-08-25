import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import * as service from './payment.service';
import * as list from './payment.list';
import * as analytics from '../analytics/analytics.service';
import { validateQuery } from '../../middleware/validate';

/**
 * Studio-side payment settings. Mounted under the org-scoped router, so
 * membership is already proved.
 */
export const paymentRouter = Router({ mergeParams: true });

/**
 * The money itself, listed.
 *
 * Declared before '/status' would be harmless — these are distinct literal
 * paths — but it is first because it is the route this screen is built on and
 * the rest of the file is Connect plumbing.
 *
 * `requireMember`, not `requireAdmin`: front desk needs to answer "did that
 * payment go through" without being able to move money. Refunding is already
 * admin-only on its own route.
 */
paymentRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z
        .enum([
          'PENDING',
          'SUCCEEDED',
          'FAILED',
          'CANCELLED',
          'REFUNDED',
          'PARTIALLY_REFUNDED',
        ])
        .optional(),
      search: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const filters = req.query as unknown as list.PaymentFilters;
    const organizationId = req.tenant!.organizationId;

    /* Totals cover the whole filtered set, so they are queried alongside the
       page rather than derived from it. */
    const [page, totals, outstandingCents] = await Promise.all([
      list.listPayments(organizationId, filters),
      list.paymentTotals(organizationId, filters),
      analytics.outstandingTotal(organizationId),
    ]);

    /*
      `outstandingCents` sits OUTSIDE `totals`, deliberately.

      Everything in `totals` obeys the date range and the filters; what a
      studio is owed does not, and cannot — an unpaid class from March is still
      owed while you are looking at last week. Nesting it beside figures that
      do move with the filter would state, by its position, something untrue
      about it, and the screen labels it accordingly.
    */
    res.json({ ...page, totals, outstandingCents });
  }),
);

paymentRouter.get(
  '/status',
  requireMember,
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.tenant!.organizationId },
      select: {
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeOnboardedAt: true,
      },
    });

    res.json({
      connected: org.stripeAccountId !== null,
      chargesEnabled: org.stripeChargesEnabled,
      payoutsEnabled: org.stripePayoutsEnabled,
      onboardedAt: org.stripeOnboardedAt,
      // The account id is not secret, but it is not useful to anyone below
      // admin either, so it is not published here.
    });
  }),
);

/**
 * Begins Stripe onboarding. Owner/admin only — this decides where the
 * studio's money lands.
 */
paymentRouter.post(
  '/connect',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await service.startConnectOnboarding(
      req.tenant!.organizationId,
      req.auth!.email,
    );

    res.json({ url: result.url, expiresAt: result.expiresAt });
  }),
);

/**
 * Pulls the latest verdict from Stripe.
 *
 * Called when the studio returns from onboarding. The account.updated webhook
 * covers this too, but a customer sitting on the settings page should not have
 * to wait for a webhook to see that they are live.
 */
paymentRouter.post(
  '/refresh',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await service.refreshConnectStatus(req.tenant!.organizationId));
  }),
);

paymentRouter.get(
  '/bookings/:bookingId',
  requireMember,
  asyncHandler(async (req, res) => {
    const bookingId = req.params.bookingId;
    if (!bookingId) throw AppError.badRequest('Missing bookingId.');

    res.json(
      await service.getBookingPaymentSummary(
        req.tenant!.organizationId,
        bookingId,
      ),
    );
  }),
);

/** Refunds according to policy. Owner/admin only — it moves money. */
paymentRouter.post(
  '/bookings/:bookingId/refund',
  requireAdmin,
  validateBody(
    z.object({
      reason: z.string().max(500).optional(),
      /** Overrides the computed notice, for a goodwill refund. */
      hoursOfNotice: z.number().min(0).max(8760).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const bookingId = req.params.bookingId;
    if (!bookingId) throw AppError.badRequest('Missing bookingId.');

    res.json(
      await service.refundForCancellation(
        req.tenant!.organizationId,
        bookingId,
        req.body,
      ),
    );
  }),
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One transaction.
 *
 * LAST in the file, and it has to be. Express matches routes in order, and
 * '/:paymentId' happily matches '/status' — putting this above it turned the
 * Connect status endpoint that Integrations and Settings both read into a
 * lookup for a payment called "status". The uuid guard below made that a 404
 * rather than a crash, which is exactly how a mistake like this survives a
 * green test suite. Anything literal added to this router goes ABOVE here.
 */
paymentRouter.get(
  '/:paymentId',
  requireMember,
  asyncHandler(async (req, res) => {
    const paymentId = req.params.paymentId;

    /* A non-uuid cannot be a payment id, so it is a missing page rather than a
       bad request — same answer the rest of the product gives for an id that
       belongs to another studio, and for the same reason. */
    if (!paymentId || !UUID.test(paymentId)) {
      throw AppError.notFound('Payment not found.');
    }

    res.json(await list.getPayment(req.tenant!.organizationId, paymentId));
  }),
);
