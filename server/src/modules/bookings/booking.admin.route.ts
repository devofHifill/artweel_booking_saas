import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody, validateQuery } from '../../middleware/validate';
import {
  requireAdmin,
  requireFrontDesk,
  requireMember,
  requirePermission,
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
      source: z.enum(['web', 'embed', 'admin']).optional(),
      payment: z.enum(['paid', 'part', 'unpaid']).optional(),
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
    z
      .object({
        serviceTypeId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        staffId: z.string().uuid().optional(),
        startsAt: z.coerce.date().optional(),
        seats: z.number().int().min(1).max(50).default(1),
        /** How many of `seats` are children. Adults are the remainder. */
        children: z.number().int().min(0).max(50).default(0),
        /** An existing customer, or the details for a new one. */
        customerId: z.string().uuid().optional(),
        customer: z
          .object({
            name: z.string().min(1).max(120),
            email: z.string().email().max(255),
            phone: z.string().max(32).optional(),
            country: z.string().max(80).optional(),
          })
          .optional(),
        notes: z.string().max(2000).optional(),
        status: z.enum(['CONFIRMED', 'PENDING']).optional(),
        /* The desk's claim about the money, which the payment rows may
           contradict. See the column's comment before relying on it. */
        paymentState: z.enum(['PAID', 'PARTIALLY_PAID', 'PENDING']).optional(),
        waiverSigned: z.boolean().optional(),
        /* Front desk only, and bounded. See the note on the service. */
        totalCents: z.number().int().min(0).max(100_000_000).optional(),
        payment: z
          .object({
            /* Recorded as the payment's provider, so the ledger says how the
               money arrived rather than implying Stripe saw it. */
            method: z.enum(['cash', 'card', 'transfer', 'other']),
            amountCents: z.number().int().min(0).max(100_000_000),
          })
          .optional(),
      })
      .refine(
        (b) => Boolean(b.customerId) !== Boolean(b.customer),
        'Give either an existing customer or the details for a new one.',
      )
      /* Caught here so it reads as a sentence. The `bookings_children_within
         _seats` CHECK would otherwise reject it as a raw constraint error. */
      .refine(
        (b) => b.children <= b.seats,
        'There cannot be more children than guests.',
      ),
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
  requirePermission('booking.cancel'),
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

const customerStatusSchema = z.enum(['ACTIVE', 'VIP', 'BLOCKED']);

const customerListQuerySchema = z.object({
  search: z.string().max(120).optional(),
  status: customerStatusSchema.optional(),
  /** Highest spend, most bookings, most recent visit, or name. */
  sort: z.enum(['name', 'spent', 'bookings', 'recent']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/**
 * The write shape, shared by create and edit.
 *
 * Consent fields are absent on purpose and must stay absent: `smsConsentAt`
 * and `smsOptedOutAt` record what the CUSTOMER did under TCPA, and a studio
 * form that could set them would let somebody who texted STOP be resubscribed
 * by editing their row.
 */
const customerWriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).nullish(),
  country: z.string().trim().max(80).nullish(),
  status: customerStatusSchema.optional(),
  notes: z.string().trim().max(2000).nullish(),
});

customerRouter.get(
  '/',
  requireMember,
  validateQuery(customerListQuerySchema),
  asyncHandler(async (req, res) => {
    res.json(
      await service.listCustomers(
        req.tenant!.organizationId,
        req.query as unknown as z.infer<typeof customerListQuerySchema>,
      ),
    );
  }),
);

/*
  Registered BEFORE `/:customerId`, or Express hands "export.csv" to the
  param route and the studio gets "Customer not found" for a download.
*/
customerRouter.get(
  '/export.csv',
  requireMember,
  validateQuery(customerListQuerySchema.omit({ page: true, pageSize: true })),
  asyncHandler(async (req, res) => {
    const csv = await service.exportCustomersCsv(
      req.tenant!.organizationId,
      req.query as unknown as {
        search?: string;
        status?: 'ACTIVE' | 'VIP' | 'BLOCKED';
        sort: service.CustomerSort;
      },
    );

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="customers-${stamp}.csv"`,
    );
    /*
      A BOM, because Excel on Windows reads a CSV as the system codepage
      unless one is present — and the first studio with an accented name in
      its list would open the export to mojibake.
    */
    res.send(`﻿${csv}`);
  }),
);

customerRouter.post(
  '/',
  requireFrontDesk,
  validateBody(customerWriteSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      customer: await service.createCustomer(
        req.tenant!.organizationId,
        req.body as service.CustomerWrite,
      ),
    });
  }),
);

customerRouter.patch(
  '/:customerId',
  requireFrontDesk,
  validateBody(customerWriteSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json({
      customer: await service.updateCustomer(
        req.tenant!.organizationId,
        id(req, 'customerId'),
        req.body as Partial<service.CustomerWrite>,
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
