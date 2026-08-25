import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import {
  requireAdmin,
  requireFrontDesk,
  requireMember,
} from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import * as service from './booking.admin.service';

export const bookingAdminRouter = Router({ mergeParams: true });

const id = (req: { params: Record<string, string | undefined> }, key: string) => {
  const value = req.params[key];
  if (!value) throw AppError.badRequest(`Missing ${key}.`);
  return value;
};

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

bookingAdminRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',') : undefined)),
      staffId: z.string().uuid().optional(),
      serviceTypeId: z.string().uuid().optional(),
      search: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.listBookings(
        req.tenant!.organizationId,
        req.query as unknown as service.BookingListFilters,
      ),
    );
  }),
);

bookingAdminRouter.get(
  '/today',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getToday(req.tenant!.organizationId));
  }),
);

/**
 * Bulk cancel.
 *
 * MUST be declared before `/:bookingId/cancel`, or Express matches this path
 * with bookingId = "bulk" and the id reaches Postgres as a malformed UUID —
 * a 500 that looks nothing like the routing mistake it is.
 *
 * Capped at 50 and reported per-booking rather than all-or-nothing: a studio
 * cancelling a snow day needs to know which ones actually went, not a single
 * failure that hides nineteen successes.
 */
bookingAdminRouter.post(
  '/bulk/cancel',
  requireAdmin,
  validateBody(
    z.object({
      bookingIds: z.array(z.string().uuid()).min(1).max(50),
      refund: z.boolean().default(true),
      reason: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const results = [];

    for (const bookingId of req.body.bookingIds) {
      try {
        const result = await service.cancelBookingAsStudio(
          req.tenant!.organizationId,
          bookingId,
          { refund: req.body.refund, reason: req.body.reason },
        );
        results.push({ bookingId, ok: true, ...result });
      } catch (err) {
        results.push({
          bookingId,
          ok: false,
          error: err instanceof Error ? err.message : 'Failed',
        });
      }
    }

    res.json({
      results,
      cancelled: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  }),
);

bookingAdminRouter.get(
  '/:bookingId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      booking: await service.getBooking(
        req.tenant!.organizationId,
        id(req, 'bookingId'),
      ),
    });
  }),
);

/** A booking taken over the phone or at the counter. */
bookingAdminRouter.post(
  '/',
  // The counter's job, and the counter's role. An instructor teaching a class
  // has no reason to be selling a place in it.
  requireFrontDesk,
  validateBody(
    z.object({
      serviceTypeId: z.string().uuid(),
      sessionId: z.string().uuid().optional(),
      staffId: z.string().uuid().optional(),
      startsAt: z.coerce.date().optional(),
      seats: z.number().int().min(1).max(50).default(1),
      customer: z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().max(255),
        phone: z.string().max(32).optional(),
      }),
      notes: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      booking: await service.createManualBooking(
        req.tenant!.organizationId,
        req.body,
      ),
    });
  }),
);

bookingAdminRouter.post(
  '/:bookingId/cancel',
  /*
    Cancelling moves money — the refund ladder runs on this path — and it
    cancels somebody's plans. It was reachable by every member, which since S9
    means any instructor could cancel any booking in the studio.
  */
  requireFrontDesk,
  validateBody(
    z.object({
      /** Studios sometimes cancel and settle the refund off-platform. */
      refund: z.boolean().default(true),
      reason: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.cancelBookingAsStudio(
        req.tenant!.organizationId,
        id(req, 'bookingId'),
        req.body,
      ),
    );
  }),
);

bookingAdminRouter.get(
  '/:bookingId/reschedule-options',
  requireMember,
  validateQuery(z.object({ from: localDate, to: localDate })),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as unknown as { from: string; to: string };
    res.json(
      await service.reschedulingOptions(
        req.tenant!.organizationId,
        id(req, 'bookingId'),
        from,
        to,
      ),
    );
  }),
);

bookingAdminRouter.post(
  '/:bookingId/reschedule',
  // Same reasoning as cancel: it moves a customer's booking, and the customer
  // called the counter about it, not the person teaching.
  requireFrontDesk,
  validateBody(z.object({ startsAt: z.coerce.date() })),
  asyncHandler(async (req, res) => {
    res.json({
      booking: await service.rescheduleBooking(
        req.tenant!.organizationId,
        id(req, 'bookingId'),
        req.body.startsAt,
      ),
    });
  }),
);

bookingAdminRouter.post(
  '/:bookingId/attendance',
  requireMember,
  validateBody(
    z.object({ status: z.enum(['ATTENDED', 'NO_SHOW', 'CONFIRMED']) }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      booking: await service.markAttendance(
        req.tenant!.organizationId,
        id(req, 'bookingId'),
        req.body.status,
      ),
    });
  }),
);

// --- Customers -------------------------------------------------------------

export const customerRouter = Router({ mergeParams: true });

customerRouter.get(
  '/',
  requireMember,
  validateQuery(
    z.object({
      search: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      /** Highest spend, most bookings, most recent visit, or name. */
      sort: z.enum(['name', 'spent', 'bookings', 'recent']).default('name'),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      customers: await service.listCustomers(
        req.tenant!.organizationId,
        req.query as unknown as {
          search?: string;
          limit: number;
          sort: service.CustomerSort;
        },
      ),
    });
  }),
);

customerRouter.get(
  '/:customerId',
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      customer: await service.getCustomer(
        req.tenant!.organizationId,
        id(req, 'customerId'),
      ),
    });
  }),
);
