import { Router } from 'express';
import { authenticate, withOrganization } from '../middleware/authenticate';
import { serviceRouter } from '../modules/services/service.route';
import { staffRouter } from '../modules/staff/staff.route';
import { locationRouter } from '../modules/locations/location.route';
import { resourceRouter } from '../modules/resources/resource.route';
import { scheduleRouter } from '../modules/schedules/schedule.route';
import { policyRouter } from '../modules/policies/policy.route';
import { paymentRouter } from '../modules/payments/payment.route';
import { notificationRouter } from '../modules/notifications/notification.route';
import { calendarRouter } from '../modules/calendar/calendar.route';
import {
  bookingAdminRouter,
  customerRouter,
} from '../modules/bookings/booking.admin.route';
import {
  billingRouter,
  requireActiveSubscription,
} from '../modules/billing/billing.route';
import { onboardingRouter } from '../modules/onboarding/onboarding.route';
import { getTrafficSummary } from '../modules/marketing/marketing.route';
import { asyncHandler } from '../lib/async-handler';
import { requireMember } from '../middleware/authenticate';

/**
 * Everything a studio owns hangs off this router, and it is mounted at
 * `/api/organizations/:organizationId`.
 *
 * The point is structural. `authenticate` and `withOrganization` run once,
 * here, before any child route exists — so a new module cannot forget its
 * tenant check, because there is nowhere to forget it. Handlers below read
 * `req.tenant.organizationId`, which has already been proved to belong to the
 * caller, and never trust an organization id from a body or query string.
 *
 * mergeParams is required or `:organizationId` would not reach the children.
 */
export const orgScopedRouter = Router({ mergeParams: true });

orgScopedRouter.use(authenticate, withOrganization());

/**
 * Billing and onboarding are mounted BEFORE the subscription gate.
 *
 * Otherwise a lapsed studio cannot reach the page that would let them pay,
 * which is the most self-defeating checkout wall it is possible to build.
 */
orgScopedRouter.use('/billing', billingRouter);
orgScopedRouter.use('/onboarding', onboardingRouter);

/** Which marketing pages bring people in. Read-only, aggregate only. */
orgScopedRouter.get(
  '/traffic',
  requireMember,
  asyncHandler(async (_req, res) => {
    res.json(await getTrafficSummary());
  }),
);

/**
 * Everything below requires a live subscription to CHANGE. Reads stay open
 * even when suspended — a studio must always be able to look up tomorrow's
 * bookings and phone the customers.
 */
orgScopedRouter.use(requireActiveSubscription);

orgScopedRouter.use('/services', serviceRouter);
orgScopedRouter.use('/staff', staffRouter);
orgScopedRouter.use('/locations', locationRouter);
orgScopedRouter.use('/resources', resourceRouter);
orgScopedRouter.use('/schedules', scheduleRouter);
orgScopedRouter.use('/cancellation-policies', policyRouter);
orgScopedRouter.use('/payments', paymentRouter);
orgScopedRouter.use('/notifications', notificationRouter);
orgScopedRouter.use('/calendar', calendarRouter);
orgScopedRouter.use('/bookings', bookingAdminRouter);
orgScopedRouter.use('/customers', customerRouter);
