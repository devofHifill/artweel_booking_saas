import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateQuery } from '../../middleware/validate';
import { requireAdmin } from '../../middleware/authenticate';
import { prisma } from '../../lib/prisma';
import * as analytics from '../analytics/analytics.service';

/**
 * Reports.
 *
 * Six views over one window, fetched once. The tabs switch client-side rather
 * than refetching, because they are six readings of the same period — changing
 * tab is not a new question, only a different way of looking at the answer to
 * the one already asked.
 *
 * Every figure comes from `analytics`, which is the point of that module: the
 * dashboard's "revenue this week" and this screen's are the same function, so
 * they cannot drift apart and leave an owner deciding which number to believe.
 *
 * `requireAdmin`, unlike most reads in this product. Everything else an
 * instructor can see is operational — today's classes, a customer's history.
 * This is the studio's commercial position: takings, what sells, and a per-
 * instructor performance table with their colleagues' names on it.
 */
export const reportRouter = Router({ mergeParams: true });

reportRouter.get(
  '/',
  requireAdmin,
  validateQuery(
    z.object({
      /*
        A fixed set rather than a free number. These four are the windows a
        studio actually reasons in, they bound the work per request, and each
        maps onto a sentence somebody would say out loud: today, this week, this
        month, this quarter.
      */
      days: z.coerce.number().int().refine((n) => [1, 7, 30, 90].includes(n), {
        message: 'Choose 1, 7, 30 or 90 days.',
      }).default(30),
    }),
  ),
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;
    const { days } = req.query as unknown as { days: number };

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { currency: true, timezone: true },
    });

    const [revenue, bookings, popular, sources, customers, staff] =
      await Promise.all([
        /*
          The revenue series is capped at 90 points even for the 90-day window,
          which is one bar per day. Beyond that a chart stops being readable and
          starts being a texture; a longer window would want weekly buckets, and
          that is a different feature rather than a bigger number here.
        */
        analytics.revenueByDay(organizationId, { days }),
        analytics.bookingBreakdown(organizationId, { days }),
        analytics.popularServices(organizationId, { days, limit: 10 }),
        analytics.bookingSources(organizationId, { days }),
        analytics.customerStats(organizationId, { days, limit: 10 }),
        analytics.staffPerformance(organizationId, { days }),
      ]);

    const receivedCents = revenue.reduce((sum, day) => sum + day.cents, 0);

    res.json({
      range: { days, currency: org.currency, timezone: org.timezone },
      revenue,
      totals: {
        receivedCents,
        /* Per booking that actually happened, not per booking taken — a
           cancelled booking never earned anything and would drag the average
           down for a reason that has nothing to do with pricing. */
        averageBookingCents:
          bookings.total - (bookings.byStatus.find((s) => s.status === 'CANCELLED')?.count ?? 0) > 0
            ? Math.round(
                receivedCents /
                  (bookings.total -
                    (bookings.byStatus.find((s) => s.status === 'CANCELLED')?.count ?? 0)),
              )
            : 0,
      },
      bookings,
      popular,
      sources,
      customers,
      staff,
    });
  }),
);
