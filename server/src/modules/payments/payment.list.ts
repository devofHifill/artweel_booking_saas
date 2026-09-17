import type { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';
import { paidCentsOf } from '../analytics/analytics.service';

/**
 * Reading payments back.
 *
 * The payments module could take money, refund it and answer questions about a
 * single booking — and a studio had no way to ask "what came in this month".
 * Every other read in this product hangs off something else: a booking, a
 * customer, a session. This is the one surface where the money itself is the
 * subject.
 *
 * Deliberately separate from `payment.service.ts`, which is 1,000 lines of
 * Stripe orchestration — checkout, webhooks, refunds, Connect. Nothing here
 * talks to a provider or moves a cent; mixing a read model into that file would
 * mean every future reader of the refund logic scrolling past a query builder.
 */

/** Net of refunds — the same rule as analytics and `outstandingCents`. */
const MONEY_IN: PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];

export type PaymentFilters = {
  from?: Date;
  to?: Date;
  status?: PaymentStatus;
  /** Matches the customer's name or email. */
  search?: string;
  limit: number;
  cursor?: string;
};

export type PaymentRow = {
  id: string;
  createdAt: Date;
  succeededAt: Date | null;
  kind: string;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  netCents: number;
  currency: string;
  customer: { id: string; name: string } | null;
  subject: PaymentSubject;
};

function where(
  organizationId: string,
  filters: PaymentFilters,
): Prisma.PaymentWhereInput {
  return {
    organizationId,

    /*
      Windowed on `createdAt`, not `succeededAt`.

      A payment that failed or is still pending has no `succeededAt` at all, and
      those are exactly the rows somebody scanning a payments screen is looking
      for — a filter that silently dropped every failure would make the page
      answer a narrower question than it appears to. Revenue reporting uses
      succeededAt precisely because it is only ever counting money that landed;
      this list is not reporting, it is looking things up.
    */
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),

    ...(filters.status ? { status: filters.status } : {}),

    /*
      Searched across all THREE ways a payment reaches a customer, not just
      through a booking.

      A class pack is bought outright and a course is paid for as a course —
      neither has a booking — so a search that only followed `booking.customer`
      answered "no payments" for a customer whose pack purchase was sitting in
      the table underneath. A search box that hides rows is worse than no
      search box, because the empty result reads as an answer.
    */
    ...(filters.search ? { OR: customerSearch(filters.search) } : {}),
  };
}

/** The same name-or-email match, down each of the three relations. */
function customerSearch(search: string): Prisma.PaymentWhereInput[] {
  const customer = {
    is: {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ],
    },
  };

  return [
    { booking: { is: { customer } } },
    { enrollment: { is: { customer } } },
    { packPurchase: { is: { customer } } },
  ];
}

/**
 * What the money was for.
 *
 * The screen used to fall back to `kind` here, which is `FULL` on almost every
 * row in the product — so a class pack purchase read "full", and a course
 * enrolment read "full", and neither told anybody anything. The real answer is
 * which of the four foreign keys is set, and each of them has a name attached
 * one join away.
 */
export type PaymentSubject = {
  kind: 'CLASS' | 'COURSE' | 'PACK' | 'HOLD' | 'OTHER';
  label: string;
  /** The class date, where there is one. Null for packs and courses. */
  startsAt: Date | null;
  /** Set only for a class, which is the one subject with a page to link to. */
  bookingId: string | null;
};

const SUBJECT_SELECT = {
  booking: {
    select: {
      id: true,
      startsAt: true,
      serviceType: { select: { name: true } },
      customer: { select: { id: true, name: true } },
    },
  },
  enrollment: {
    select: {
      courseSeries: { select: { name: true } },
      customer: { select: { id: true, name: true } },
    },
  },
  packPurchase: {
    select: {
      classPack: { select: { name: true } },
      customer: { select: { id: true, name: true } },
    },
  },
} as const;

type WithSubject = {
  holdId: string | null;
  booking: {
    id: string;
    startsAt: Date;
    serviceType: { name: string };
    customer: { id: string; name: string };
  } | null;
  enrollment: {
    courseSeries: { name: string };
    customer: { id: string; name: string };
  } | null;
  packPurchase: {
    classPack: { name: string };
    customer: { id: string; name: string };
  } | null;
};

function subjectOf(row: WithSubject): PaymentSubject {
  if (row.booking) {
    return {
      kind: 'CLASS',
      label: row.booking.serviceType.name,
      startsAt: row.booking.startsAt,
      bookingId: row.booking.id,
    };
  }

  if (row.enrollment) {
    return {
      kind: 'COURSE',
      label: row.enrollment.courseSeries.name,
      startsAt: null,
      bookingId: null,
    };
  }

  if (row.packPurchase) {
    return {
      kind: 'PACK',
      label: row.packPurchase.classPack.name,
      startsAt: null,
      bookingId: null,
    };
  }

  /* A hold is a seat reserved while the customer is at the checkout. A payment
     still pointing at one either has not landed yet or never will, which is
     precisely the row somebody scanning this screen is hunting for — so it is
     named rather than swept into "other". */
  if (row.holdId) {
    return {
      kind: 'HOLD',
      label: 'Checkout in progress',
      startsAt: null,
      bookingId: null,
    };
  }

  return { kind: 'OTHER', label: 'Unattached', startsAt: null, bookingId: null };
}

/** Whoever paid, whichever of the three routes they came in by. */
function customerOf(row: WithSubject): { id: string; name: string } | null {
  return (
    row.booking?.customer ??
    row.enrollment?.customer ??
    row.packPurchase?.customer ??
    null
  );
}

export async function listPayments(
  organizationId: string,
  filters: PaymentFilters,
) {
  const rows = await prisma.payment.findMany({
    where: where(organizationId, filters),
    select: {
      id: true,
      createdAt: true,
      succeededAt: true,
      kind: true,
      status: true,
      amountCents: true,
      refundedCents: true,
      currency: true,
      holdId: true,
      ...SUBJECT_SELECT,
    },
    orderBy: { createdAt: 'desc' },
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  /*
    One extra row is fetched and then dropped. That is how the page knows there
    IS a next page without a second COUNT over the same filter — and a count
    that disagrees with the rows is how "next" buttons end up leading nowhere.
  */
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    payments: page.map(
      (p): PaymentRow => ({
        id: p.id,
        createdAt: p.createdAt,
        succeededAt: p.succeededAt,
        kind: p.kind,
        status: p.status,
        amountCents: p.amountCents,
        refundedCents: p.refundedCents,
        /* Computed once, here. Every screen that has ever summed `amountCents`
           and forgotten `refundedCents` has overstated a studio's takings. */
        netCents: MONEY_IN.includes(p.status)
          ? p.amountCents - p.refundedCents
          : 0,
        currency: p.currency,
        customer: customerOf(p),
        subject: subjectOf(p),
      }),
    ),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    counts: await statusCounts(organizationId, filters),
  };
}

/**
 * How many payments sit behind each status tab.
 *
 * Counted under every filter EXCEPT status, which is the only shape that makes
 * the tabs mean anything — the same rule the booking tabs follow, and worth
 * stating twice because getting it wrong is invisible until somebody clicks.
 * Count under the status filter too and every other tab collapses to zero the
 * moment one is chosen; count under none of the filters and the row describes
 * a different list from the one on screen.
 *
 * A `groupBy` rather than six counts: one query, and the statuses come back
 * from the data rather than from a list here that could fall behind the enum.
 */
async function statusCounts(
  organizationId: string,
  filters: PaymentFilters,
): Promise<Record<string, number>> {
  const { status: _ignored, ...whereWithoutStatus } = where(
    organizationId,
    filters,
  );

  const grouped = await prisma.payment.groupBy({
    by: ['status'],
    where: whereWithoutStatus,
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    total += row._count._all;
  }

  return { total, ...counts };
}

/**
 * Totals for the same filter the list is showing.
 *
 * Computed over the WHOLE filtered set, not the page — a total that only added
 * up the fifty rows on screen would change every time somebody paged, which is
 * worse than showing no total at all.
 */
export async function paymentTotals(
  organizationId: string,
  filters: PaymentFilters,
) {
  const rows = await prisma.payment.findMany({
    where: where(organizationId, filters),
    select: {
      status: true,
      amountCents: true,
      refundedCents: true,
      /* The four foreign keys, not the joins. The breakdown only needs to know
         WHICH subject a payment had, and that is answerable from columns
         already on the row — asking for the names here would be three joins
         across every payment in the range to build five bars. */
      bookingId: true,
      enrollmentId: true,
      packPurchaseId: true,
      holdId: true,
    },
  });

  let receivedCents = 0;
  let refundedCents = 0;
  let failed = 0;
  let pending = 0;
  const breakdown: Record<string, number> = {};

  for (const row of rows) {
    if (MONEY_IN.includes(row.status)) {
      const net = row.amountCents - row.refundedCents;
      receivedCents += net;

      const kind = row.bookingId
        ? 'CLASS'
        : row.enrollmentId
          ? 'COURSE'
          : row.packPurchaseId
            ? 'PACK'
            : row.holdId
              ? 'HOLD'
              : 'OTHER';

      breakdown[kind] = (breakdown[kind] ?? 0) + net;
    }
    refundedCents += row.refundedCents;
    if (row.status === 'FAILED') failed += 1;
    if (row.status === 'PENDING') pending += 1;
  }

  return {
    count: rows.length,
    receivedCents,
    refundedCents,
    failed,
    pending,
    /*
      Money RECEIVED per subject, not payments attempted. A failed charge
      belongs in the failed count above and nowhere near a chart headed "where
      it came from" — the bars are shares of a total that has to add up to the
      figure printed beside them, or the two contradict each other on one
      screen.
    */
    breakdown: Object.entries(breakdown)
      .map(([kind, cents]) => ({ kind, cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}

/**
 * One transaction, in full.
 *
 * Everything here is already stored and none of it can be seen anywhere in the
 * product: why a card was declined, what the charge is called in the studio's
 * Stripe dashboard, and what a refund was for. Those are the three reasons
 * anybody opens a payment, and the answer to all of them has been a database
 * query until now.
 *
 * Scoped by organization in the WHERE rather than checked after loading, so a
 * payment id from another studio is a 404 and not a leak.
 */
export async function getPayment(organizationId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId },
    select: {
      id: true,
      createdAt: true,
      succeededAt: true,
      kind: true,
      status: true,
      amountCents: true,
      refundedCents: true,
      currency: true,
      provider: true,
      providerPaymentIntentId: true,
      failureReason: true,
      holdId: true,
      ...SUBJECT_SELECT,
      refunds: {
        select: {
          id: true,
          amountCents: true,
          creditCents: true,
          reason: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!payment) throw AppError.notFound('Payment not found.');

  /*
    The booking's own money, loaded separately.

    A studio at the counter asks "is this one settled" about the BOOKING, not
    about the charge in front of them — and one booking can carry several
    payments. Reading them off this payment alone would answer confidently and
    wrongly the first time somebody paid in two goes.
  */
  let booking = null;
  if (payment.booking) {
    const full = await prisma.booking.findFirst({
      where: { id: payment.booking.id, organizationId },
      select: {
        id: true,
        status: true,
        totalCents: true,
        payments: {
          select: { amountCents: true, refundedCents: true, status: true },
        },
      },
    });

    if (full) {
      const paidCents = paidCentsOf(full.payments);
      booking = {
        id: full.id,
        status: full.status,
        totalCents: full.totalCents,
        paidCents,
        outstandingCents: Math.max(0, full.totalCents - paidCents),
      };
    }
  }

  return {
    id: payment.id,
    createdAt: payment.createdAt,
    succeededAt: payment.succeededAt,
    kind: payment.kind,
    status: payment.status,
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    netCents: MONEY_IN.includes(payment.status)
      ? payment.amountCents - payment.refundedCents
      : 0,
    currency: payment.currency,
    provider: payment.provider,
    /* The payment intent, not the checkout session: it is the id Stripe's own
       dashboard search takes, which is the entire point of showing one. */
    reference: payment.providerPaymentIntentId,
    failureReason: payment.failureReason,
    customer: customerOf(payment),
    subject: subjectOf(payment),
    refunds: payment.refunds,
    booking,
  };
}
