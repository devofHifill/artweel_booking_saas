import type { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

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
  booking: { id: string; serviceName: string; startsAt: Date } | null;
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

    ...(filters.search
      ? {
          booking: {
            is: {
              customer: {
                is: {
                  OR: [
                    { name: { contains: filters.search, mode: 'insensitive' } },
                    { email: { contains: filters.search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        }
      : {}),
  };
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
      booking: {
        select: {
          id: true,
          startsAt: true,
          serviceType: { select: { name: true } },
          customer: { select: { id: true, name: true } },
        },
      },
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
        customer: p.booking?.customer ?? null,
        booking: p.booking
          ? {
              id: p.booking.id,
              serviceName: p.booking.serviceType.name,
              startsAt: p.booking.startsAt,
            }
          : null,
      }),
    ),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
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
    select: { status: true, amountCents: true, refundedCents: true },
  });

  let receivedCents = 0;
  let refundedCents = 0;
  let failed = 0;
  let pending = 0;

  for (const row of rows) {
    if (MONEY_IN.includes(row.status)) {
      receivedCents += row.amountCents - row.refundedCents;
    }
    refundedCents += row.refundedCents;
    if (row.status === 'FAILED') failed += 1;
    if (row.status === 'PENDING') pending += 1;
  }

  return { count: rows.length, receivedCents, refundedCents, failed, pending };
}
