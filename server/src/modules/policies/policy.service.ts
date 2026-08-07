import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/app-error';

/**
 * Cancellation terms as configurable data.
 *
 * Every studio wants different terms and they change seasonally. Encoded in
 * application logic, each change is a deploy — which for a self-serve product
 * with nobody staffing support is simply not viable.
 */

export type PolicyTier = {
  /** Hours of notice required to reach this tier. */
  hoursBefore: number;
  /** Percentage refunded to the original payment method. */
  refundPercent: number;
  /** Percentage returned as studio credit instead. */
  creditPercent?: number;
};

/**
 * Tiers are evaluated most-generous-first and the first match wins, so the
 * ladder must descend. An ascending or duplicated ladder would quietly apply
 * the wrong terms, and the studio would only find out from an angry customer.
 */
function validateTiers(tiers: PolicyTier[]) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw AppError.badRequest('A policy needs at least one tier.');
  }

  let previous = Number.POSITIVE_INFINITY;

  for (const tier of tiers) {
    if (typeof tier?.hoursBefore !== 'number' || tier.hoursBefore < 0) {
      throw AppError.badRequest('Each tier needs a notice period of zero or more hours.');
    }
    if (tier.hoursBefore >= previous) {
      throw AppError.badRequest(
        'Tiers must be listed longest notice first, with no repeats.',
        'TIERS_OUT_OF_ORDER',
      );
    }

    const refund = tier.refundPercent;
    const credit = tier.creditPercent ?? 0;

    if (typeof refund !== 'number' || refund < 0 || refund > 100) {
      throw AppError.badRequest('Refund percentage must be between 0 and 100.');
    }
    if (credit < 0 || credit > 100) {
      throw AppError.badRequest('Credit percentage must be between 0 and 100.');
    }
    if (refund + credit > 100) {
      throw AppError.badRequest(
        'Refund and credit together cannot exceed 100 percent.',
        'OVER_REFUND',
      );
    }

    previous = tier.hoursBefore;
  }

  // Without a zero-hour tier there is no answer for a last-minute
  // cancellation, and the caller would have to invent one.
  if (tiers[tiers.length - 1]!.hoursBefore !== 0) {
    throw AppError.badRequest(
      'The final tier must use 0 hours, so late cancellations have defined terms.',
      'MISSING_FINAL_TIER',
    );
  }
}

export async function listPolicies(organizationId: string) {
  return prisma.cancellationPolicy.findMany({
    where: { organizationId },
    include: { _count: { select: { serviceTypes: true } } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function createPolicy(
  organizationId: string,
  input: {
    name: string;
    tiers: PolicyTier[];
    isDefault?: boolean;
    noShowFeeCents?: number;
    allowReschedule?: boolean;
    rescheduleCutoffHours?: number;
  },
) {
  validateTiers(input.tiers);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // A partial unique index enforces one default per studio, so the previous
    // default must be cleared inside the same transaction or the insert fails.
    if (input.isDefault) {
      await tx.cancellationPolicy.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.cancellationPolicy.create({
      data: {
        organizationId,
        name: input.name,
        tiers: input.tiers as unknown as Prisma.InputJsonValue,
        isDefault: input.isDefault ?? false,
        noShowFeeCents: input.noShowFeeCents ?? 0,
        allowReschedule: input.allowReschedule ?? true,
        rescheduleCutoffHours: input.rescheduleCutoffHours ?? 24,
      },
    });
  });
}

export async function updatePolicy(
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.cancellationPolicy.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw AppError.notFound('Policy not found.');

  if (input.tiers) validateTiers(input.tiers as PolicyTier[]);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.isDefault === true) {
      await tx.cancellationPolicy.updateMany({
        where: { organizationId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.cancellationPolicy.update({
      where: { id },
      data: input as Prisma.CancellationPolicyUncheckedUpdateInput,
    });
  });
}

export async function deletePolicy(organizationId: string, id: string) {
  const policy = await prisma.cancellationPolicy.findFirst({
    where: { id, organizationId },
  });
  if (!policy) throw AppError.notFound('Policy not found.');

  const inUse = await prisma.serviceType.count({
    where: { cancellationPolicyId: id },
  });
  if (inUse > 0) {
    throw AppError.conflict(
      `${inUse} service(s) still use this policy. Point them at another one first.`,
      'POLICY_IN_USE',
    );
  }

  await prisma.cancellationPolicy.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Works out what a cancellation is worth, given how much notice was actually
 * given. Pure and exported so the refund path in W1.4 and the customer-facing
 * "what happens if I cancel" preview share one implementation.
 */
export function evaluatePolicy(
  tiers: PolicyTier[],
  amountCents: number,
  hoursOfNotice: number,
): { refundCents: number; creditCents: number; tier: PolicyTier | null } {
  const match = tiers.find((t) => hoursOfNotice >= t.hoursBefore) ?? null;

  if (!match) return { refundCents: 0, creditCents: 0, tier: null };

  // Round down: never refund more than was taken because of float dust.
  const refundCents = Math.floor((amountCents * match.refundPercent) / 100);
  const creditCents = Math.floor(
    (amountCents * (match.creditPercent ?? 0)) / 100,
  );

  return { refundCents, creditCents, tier: match };
}

/** The policy that applies to a service, falling back to the studio default. */
export async function resolvePolicyForService(
  organizationId: string,
  serviceTypeId: string,
) {
  const service = await prisma.serviceType.findFirst({
    where: { id: serviceTypeId, organizationId },
    include: { cancellationPolicy: true },
  });
  if (!service) throw AppError.notFound('Service not found.');

  if (service.cancellationPolicy) return service.cancellationPolicy;

  return prisma.cancellationPolicy.findFirst({
    where: { organizationId, isDefault: true },
  });
}
