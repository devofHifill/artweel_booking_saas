import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 15_000,
  maxWait: 15_000,
} as const;

/**
 * Class packs — "ten classes for £400".
 *
 * A pack is a purchase that books nothing. That is the whole novelty: every
 * other payment in this system attaches to a session or a cohort, and this one
 * attaches to an entitlement the customer spends later.
 *
 * Spending it is NOT new. A pack mints `ClassCredit` rows, the same currency a
 * missed class produces, and they are redeemed through the same path — which
 * already locks the credit `FOR UPDATE`, claims the seat through `bookSeats`
 * before marking it spent, and hands the seat back if it loses a race. A
 * separate pack-redemption path would have been a second place to get
 * double-spending wrong, and the customer would have had two balances.
 */

export type CreatePackInput = {
  name: string;
  description?: string;
  creditCount: number;
  priceCents: number;
  validityDays?: number;
  serviceTypeId?: string;
};

export async function createPack(organizationId: string, input: CreatePackInput) {
  if (input.serviceTypeId) {
    const service = await prisma.serviceType.findFirst({
      where: { id: input.serviceTypeId, organizationId },
      select: { id: true },
    });
    if (!service) throw AppError.badRequest('Service not found.');
  }

  return prisma.classPack.create({
    data: {
      organizationId,
      name: input.name,
      description: input.description,
      creditCount: input.creditCount,
      priceCents: input.priceCents,
      validityDays: input.validityDays ?? 365,
      serviceTypeId: input.serviceTypeId,
    },
  });
}

export async function listPacks(
  organizationId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.classPack.findMany({
    where: {
      organizationId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: {
      serviceType: { select: { id: true, name: true } },
      _count: { select: { purchases: true } },
    },
    orderBy: [{ isActive: 'desc' }, { priceCents: 'asc' }],
  });
}

export async function updatePack(
  organizationId: string,
  packId: string,
  input: Record<string, unknown>,
) {
  const pack = await prisma.classPack.findFirst({
    where: { id: packId, organizationId },
    select: { id: true },
  });
  if (!pack) throw AppError.notFound('Pack not found.');

  /**
   * Edits touch the PRODUCT only. Purchases snapshot price, credit count and
   * validity at the moment of sale, so raising a price cannot retroactively
   * charge somebody more and shortening validity cannot expire a credit
   * already in a customer's hands.
   */
  return prisma.classPack.update({
    where: { id: packId },
    data: input as Prisma.ClassPackUncheckedUpdateInput,
  });
}

/**
 * Withdraws a pack from sale.
 *
 * Deactivation rather than deletion, always. Purchases reference it, and a
 * studio that sold forty of something needs the record of what it was.
 */
export async function deactivatePack(organizationId: string, packId: string) {
  const pack = await prisma.classPack.findFirst({
    where: { id: packId, organizationId },
    select: { id: true },
  });
  if (!pack) throw AppError.notFound('Pack not found.');

  return prisma.classPack.update({
    where: { id: packId },
    data: { isActive: false },
  });
}

/**
 * Starts a purchase. No credits exist yet.
 *
 * The PENDING row is created before Stripe is involved, so the webhook has
 * something to attach to — the same shape as a booking hold, minus the seat,
 * because a pack takes nothing away from anybody while it is being paid for.
 * An abandoned purchase is simply a PENDING row nobody ever completes, which
 * costs the studio nothing and is worth keeping as a record of intent.
 */
export async function startPurchase(
  organizationId: string,
  packId: string,
  customerId: string,
) {
  const pack = await prisma.classPack.findFirst({
    where: { id: packId, organizationId, isActive: true },
  });
  if (!pack) throw AppError.notFound('Pack not found.');

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw AppError.badRequest('Customer not found.');

  return prisma.classPackPurchase.create({
    data: {
      organizationId,
      classPackId: pack.id,
      customerId,
      status: 'PENDING',
      // Snapshotted. See updatePack.
      creditCount: pack.creditCount,
      pricePaidCents: pack.priceCents,
      validityDays: pack.validityDays,
      serviceTypeId: pack.serviceTypeId,
    },
  });
}

/**
 * Turns a paid purchase into credits.
 *
 * Idempotent against Stripe redelivery, and the guard is the status change
 * rather than a count: `updateMany ... where status = 'PENDING'` either wins
 * once or reports zero rows. Counting existing credits instead would race with
 * itself — two deliveries could both count nine and both mint the tenth.
 *
 * The credits and the status move in ONE transaction. Minting them outside it
 * would allow a crash to leave a purchase that is paid, ACTIVE and worth
 * nothing.
 */
export async function issuePurchaseCredits(
  organizationId: string,
  purchaseId: string,
) {
  return prisma.$transaction(async (tx: Tx) => {
    const purchase = await tx.classPackPurchase.findFirst({
      where: { id: purchaseId, organizationId },
    });
    if (!purchase) throw AppError.notFound('Purchase not found.');

    if (purchase.status === 'ACTIVE') {
      const existing = await tx.classCredit.count({
        where: { packPurchaseId: purchaseId },
      });
      return { issued: 0, alreadyIssued: existing, replayed: true };
    }

    if (purchase.status === 'REFUNDED') {
      throw AppError.conflict(
        'This purchase was refunded and cannot issue credits.',
        'PURCHASE_REFUNDED',
      );
    }

    const now = new Date();
    const expiresAt =
      purchase.validityDays > 0
        ? new Date(now.getTime() + purchase.validityDays * 86_400_000)
        : null;

    // Claim the transition first. A second delivery finds zero rows here and
    // never reaches the mint below.
    const claimed = await tx.classPackPurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING' },
      data: { status: 'ACTIVE', issuedAt: now, expiresAt },
    });

    if (claimed.count === 0) {
      const existing = await tx.classCredit.count({
        where: { packPurchaseId: purchaseId },
      });
      return { issued: 0, alreadyIssued: existing, replayed: true };
    }

    await tx.classCredit.createMany({
      data: Array.from({ length: purchase.creditCount }, () => ({
        organizationId,
        customerId: purchase.customerId,
        source: 'PACK' as const,
        packPurchaseId: purchase.id,
        status: 'AVAILABLE' as const,
        expiresAt,
        reason: 'Class pack',
      })),
    });

    return { issued: purchase.creditCount, alreadyIssued: 0, replayed: false };
  }, TX_OPTIONS);
}

/**
 * Refunds a purchase and withdraws what is left of it.
 *
 * Only UNSPENT credits are cancelled. A customer who used four of ten and then
 * refunded keeps the four classes they actually attended — clawing those back
 * would mean un-booking somebody from a class they have already been to.
 * Whether the refund should be partial in that case is the studio's call, and
 * the money side is deliberately left to them.
 */
export async function refundPurchase(organizationId: string, purchaseId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const purchase = await tx.classPackPurchase.findFirst({
      where: { id: purchaseId, organizationId },
    });
    if (!purchase) throw AppError.notFound('Purchase not found.');
    if (purchase.status === 'REFUNDED') return { purchase, cancelled: 0, spent: 0 };

    const spent = await tx.classCredit.count({
      where: { packPurchaseId: purchaseId, status: 'REDEEMED' },
    });

    const cancelled = await tx.classCredit.updateMany({
      where: { packPurchaseId: purchaseId, status: 'AVAILABLE' },
      data: { status: 'CANCELLED' },
    });

    const updated = await tx.classPackPurchase.update({
      where: { id: purchaseId },
      data: { status: 'REFUNDED' },
    });

    return { purchase: updated, cancelled: cancelled.count, spent };
  }, TX_OPTIONS);
}

export async function listPurchases(
  organizationId: string,
  opts: { customerId?: string; status?: string } = {},
) {
  return prisma.classPackPurchase.findMany({
    where: {
      organizationId,
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      classPack: { select: { id: true, name: true } },
      _count: { select: { credits: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * What a customer has left, across every source.
 *
 * One number, which is the reason packs and absences share a table. A customer
 * asking "how many classes do I have?" does not distinguish between the one
 * they are owed for missing week three and the nine left on their pack, and a
 * product that shows them two balances is making its own schema their problem.
 */
export async function creditBalance(organizationId: string, customerId: string) {
  const now = new Date();

  const credits = await prisma.classCredit.findMany({
    where: {
      organizationId,
      customerId,
      status: 'AVAILABLE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, source: true, expiresAt: true },
    orderBy: [{ expiresAt: 'asc' }],
  });

  const bySource = credits.reduce<Record<string, number>>((acc, c) => {
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});

  return {
    available: credits.length,
    bySource,
    /** The date the first one lapses, which is what a reminder would use. */
    nextExpiry: credits.find((c) => c.expiresAt)?.expiresAt ?? null,
  };
}

/**
 * Called by the Stripe webhook once a pack is paid for.
 *
 * Kept here rather than in the payments module so the issuance rules live with
 * the packs. The payments side only knows it has a purchase id.
 */
export async function completePackCheckout(input: {
  organizationId: string;
  purchaseId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
}) {
  const result = await issuePurchaseCredits(input.organizationId, input.purchaseId);

  await prisma.payment.updateMany({
    where: { providerCheckoutSessionId: input.checkoutSessionId },
    data: {
      packPurchaseId: input.purchaseId,
      status: 'SUCCEEDED',
      providerPaymentIntentId: input.paymentIntentId,
      succeededAt: new Date(),
    },
  });

  if (result.replayed) {
    logger.info(
      { purchaseId: input.purchaseId },
      'Pack checkout webhook replayed; credits already issued',
    );
  } else {
    logger.info(
      { purchaseId: input.purchaseId, credits: result.issued },
      'Class pack credits issued',
    );
  }

  return result;
}
