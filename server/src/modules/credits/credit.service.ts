import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, BookingErrorCode } from '../../lib/app-error';
import { bookSeats } from '../../scheduling/booking.service';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Make-up credits.
 *
 * ---------------------------------------------------------------------------
 * EVERY RULE BELOW IS A GUESS. None of it has been checked against a real
 * studio. The guesses are deliberately confined to the policy fields on
 * `organizations` so that changing one's mind is an UPDATE rather than a
 * rewrite — see the block comment on that model.
 * ---------------------------------------------------------------------------
 *
 * The shape that is NOT a guess is the integrity: one absence mints at most
 * one credit, and a credit is spent at most once. Both are enforced in
 * Postgres, because both are the kind of thing a retried request or two staff
 * on two phones would otherwise get wrong.
 */

/**
 * Whether an absence earns a credit, under the studio's policy.
 *
 * The notice rule is the load-bearing judgement: a student who warns the
 * studio is treated differently from one who simply does not appear. That
 * rewards the behaviour a studio wants, but it is exactly the kind of call a
 * studio may find harsh — hence `makeUpRequiresNotice`.
 */
function earnsCredit(
  policy: {
    makeUpCreditsEnabled: boolean;
    makeUpRequiresNotice: boolean;
    makeUpNoticeHours: number;
  },
  booking: { status: string; startsAt: Date; updatedAt: Date },
): { earns: boolean; reason: string } {
  if (!policy.makeUpCreditsEnabled) {
    return { earns: false, reason: 'Make-up credits are switched off.' };
  }

  if (booking.status === 'NO_SHOW') {
    if (policy.makeUpRequiresNotice) {
      return {
        earns: false,
        reason: `No notice was given (this studio asks for ${policy.makeUpNoticeHours}h).`,
      };
    }
    return { earns: true, reason: 'Missed the class.' };
  }

  if (booking.status === 'CANCELLED') {
    if (!policy.makeUpRequiresNotice) {
      return { earns: true, reason: 'Cancelled the class.' };
    }

    /**
     * `updatedAt` stands in for "when they told us", because cancellation does
     * not record its own timestamp. That is an approximation: any later edit
     * to the row moves it. It holds for the ordinary path — a cancelled
     * booking is rarely touched again — and a dedicated `cancelledAt` is the
     * right fix if this ever matters.
     */
    const noticeMs = policy.makeUpNoticeHours * 3_600_000;
    const gave = booking.startsAt.getTime() - booking.updatedAt.getTime();

    if (gave >= noticeMs) {
      return { earns: true, reason: 'Cancelled with notice.' };
    }
    return {
      earns: false,
      reason: `Cancelled with less than ${policy.makeUpNoticeHours}h notice.`,
    };
  }

  return { earns: false, reason: 'The class was attended.' };
}

/**
 * Issues a credit for one missed class, if policy allows it.
 *
 * Idempotent by way of the partial unique index on `source_booking_id`: called
 * twice for the same booking, the second insert loses and the existing credit
 * is returned. That matters because the register is the caller, and a register
 * can be saved repeatedly.
 */
export async function issueCreditForBooking(
  organizationId: string,
  bookingId: string,
): Promise<{ issued: boolean; reason: string; creditId?: string }> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      updatedAt: true,
      customerId: true,
      enrollmentId: true,
    },
  });
  if (!booking) throw AppError.notFound('Booking not found.');

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      makeUpCreditsEnabled: true,
      makeUpRequiresNotice: true,
      makeUpNoticeHours: true,
      makeUpCreditDays: true,
    },
  });

  /**
   * Credits are for COURSE students only.
   *
   * A drop-in who misses a class they paid for individually has a refund
   * question, not a credit question — the cancellation policy already answers
   * that, and issuing both would pay them twice.
   */
  if (!booking.enrollmentId) {
    return { issued: false, reason: 'Not a course booking.' };
  }

  const verdict = earnsCredit(org, booking);
  if (!verdict.earns) return { issued: false, reason: verdict.reason };

  const expiresAt =
    org.makeUpCreditDays > 0
      ? new Date(Date.now() + org.makeUpCreditDays * 86_400_000)
      : null;

  try {
    const credit = await prisma.classCredit.create({
      data: {
        organizationId,
        customerId: booking.customerId,
        enrollmentId: booking.enrollmentId,
        sourceBookingId: booking.id,
        status: 'AVAILABLE',
        expiresAt,
        reason: verdict.reason,
      },
    });
    return { issued: true, reason: verdict.reason, creditId: credit.id };
  } catch (err) {
    if (isDuplicateCredit(err)) {
      const existing = await prisma.classCredit.findFirst({
        where: { sourceBookingId: booking.id, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      return {
        issued: false,
        reason: 'A credit was already issued for this class.',
        creditId: existing?.id,
      };
    }
    throw err;
  }
}

function isDuplicateCredit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { target?: unknown }; message?: unknown };
  if (e.code === 'P2002') return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return message.includes('class_credits_one_per_absence');
}

/**
 * Spends a credit on a class.
 *
 * The credit row is locked FOR UPDATE before anything else happens, so two
 * simultaneous redemptions of one credit queue rather than both succeeding.
 * The seat is then taken through the ordinary `bookSeats` path — a make-up
 * student occupies a real seat and must contend for it exactly like a paying
 * one, or a class quietly runs over capacity.
 *
 * Order matters: the seat is claimed BEFORE the credit is marked spent. If the
 * class turns out to be full, the credit must still be there afterwards.
 */
export async function redeemCredit(
  organizationId: string,
  creditId: string,
  sessionId: string,
) {
  const locked = await prisma.$transaction(async (tx: Tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        customer_id: string;
        status: string;
        expires_at: Date | null;
        enrollment_id: string | null;
      }[]
    >`
      SELECT id, customer_id, status::text AS status, expires_at, enrollment_id
      FROM class_credits
      WHERE id = ${creditId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;

    const credit = rows[0];
    if (!credit) throw AppError.notFound('Credit not found.');

    if (credit.status === 'REDEEMED') {
      throw AppError.conflict('This credit has already been used.', 'CREDIT_SPENT');
    }
    if (credit.status === 'CANCELLED') {
      throw AppError.conflict('This credit was withdrawn.', 'CREDIT_CANCELLED');
    }
    if (credit.expires_at && credit.expires_at <= new Date()) {
      throw AppError.conflict('This credit has expired.', 'CREDIT_EXPIRED');
    }

    return credit;
  }, TX_OPTIONS);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { makeUpCrossCohort: true },
  });

  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId },
    select: { id: true, courseSeriesId: true, status: true, startsAt: true },
  });
  if (!session) throw AppError.notFound('Class not found.');

  if (session.startsAt <= new Date()) {
    throw AppError.conflict(
      'That class has already started.',
      BookingErrorCode.SLOT_NOT_BOOKABLE,
    );
  }

  /**
   * Whether a credit earned on one course can be spent on another.
   *
   * Defaulting to permissive: a student who missed week three of the Tuesday
   * course and can only make Saturdays is the case make-up credits exist to
   * solve, and refusing it makes the feature nearly useless. A studio running
   * strictly sequential curricula will disagree, which is what the setting is
   * for.
   */
  if (!org.makeUpCrossCohort && locked.enrollment_id) {
    const origin = await prisma.enrollment.findUnique({
      where: { id: locked.enrollment_id },
      select: { courseSeriesId: true },
    });

    if (origin && session.courseSeriesId !== origin.courseSeriesId) {
      throw AppError.conflict(
        'This credit can only be used on another week of the same course.',
        'CREDIT_WRONG_COHORT',
      );
    }
  }

  // A real seat, contended for like any other.
  const booking = await bookSeats({
    organizationId,
    sessionId,
    customerId: locked.customer_id,
    seats: 1,
    source: 'make-up-credit',
    notes: 'Make-up class',
  });

  try {
    return await prisma.$transaction(async (tx: Tx) => {
      const spent = await tx.classCredit.updateMany({
        where: { id: creditId, status: 'AVAILABLE' },
        data: {
          status: 'REDEEMED',
          redeemedAt: new Date(),
          redeemedBookingId: booking!.id,
        },
      });

      // Somebody spent it between the lock and here. Give the seat back
      // rather than leaving the student booked into a class they did not pay
      // for and no credit to show for it.
      if (spent.count === 0) {
        throw AppError.conflict(
          'This credit was used elsewhere a moment ago.',
          'CREDIT_SPENT',
        );
      }

      return {
        credit: await tx.classCredit.findUniqueOrThrow({ where: { id: creditId } }),
        booking: booking!,
      };
    }, TX_OPTIONS);
  } catch (err) {
    const { cancelBooking } = await import('../../scheduling/booking.service');
    await cancelBooking(organizationId, booking!.id).catch(() => {});
    throw err;
  }
}

export async function listCredits(
  organizationId: string,
  opts: { customerId?: string; status?: string } = {},
) {
  return prisma.classCredit.findMany({
    where: {
      organizationId,
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      enrollment: {
        select: { id: true, courseSeries: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

/** Granted by hand — a studio squaring something up outside the rules. */
export async function grantCredit(
  organizationId: string,
  input: { customerId: string; reason?: string; expiresInDays?: number },
) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw AppError.badRequest('Customer not found.');

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { makeUpCreditDays: true },
  });

  const days = input.expiresInDays ?? org.makeUpCreditDays;

  return prisma.classCredit.create({
    data: {
      organizationId,
      customerId: input.customerId,
      status: 'AVAILABLE',
      expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
      reason: input.reason ?? 'Granted by the studio',
    },
  });
}

export async function cancelCredit(organizationId: string, creditId: string) {
  const credit = await prisma.classCredit.findFirst({
    where: { id: creditId, organizationId },
  });
  if (!credit) throw AppError.notFound('Credit not found.');

  if (credit.status === 'REDEEMED') {
    throw AppError.conflict(
      'This credit has been used and cannot be withdrawn.',
      'CREDIT_SPENT',
    );
  }

  return prisma.classCredit.update({
    where: { id: creditId },
    data: { status: 'CANCELLED' },
  });
}

/**
 * Lapses credits past their date.
 *
 * A dated sweep rather than a check at read time, so that "how many credits
 * are outstanding" is answerable by counting rows — which is what a studio
 * wondering about its liability actually asks.
 */
export async function expireCredits(now: Date = new Date()) {
  const result = await prisma.classCredit.updateMany({
    where: { status: 'AVAILABLE', expiresAt: { not: null, lte: now } },
    data: { status: 'EXPIRED' },
  });
  return { expired: result.count };
}
