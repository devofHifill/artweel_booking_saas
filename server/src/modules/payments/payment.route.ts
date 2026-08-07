import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { requireAdmin, requireMember } from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { prisma } from '../../lib/prisma';
import * as service from './payment.service';

/**
 * Studio-side payment settings. Mounted under the org-scoped router, so
 * membership is already proved.
 */
export const paymentRouter = Router({ mergeParams: true });

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
