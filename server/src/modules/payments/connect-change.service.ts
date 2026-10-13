import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/app-error';
import { getPaymentProvider } from './provider.registry';
import { getEmailProvider } from '../notifications/registry';
import { connectStatusUpdate, startConnectOnboarding } from './payment.service';
import type { ConnectAccountStatus } from './provider';

/**
 * A studio leaving one Stripe account for another, by its own hand.
 *
 * Two situations, deliberately kept apart because the stakes differ:
 *
 * START OVER — the account never took a payment (an abandoned or rejected
 * setup). Nothing depends on it, so it is dropped and a new one begins at
 * once. Owners and admins.
 *
 * CHANGE — the account is taking payments. Earlier bookings were paid into it
 * and their refunds and disputes still land there, so it cannot simply be
 * dropped. The new account is built ALONGSIDE it (`pendingStripeAccountId`)
 * while the current one keeps taking bookings, and the two swap only when
 * Stripe says the new one can take payments. Abandoning the new setup changes
 * nothing. Owners only — it is their money and their business identity.
 *
 * Refunds need nothing special: every payment records the account it was taken
 * on (`providerAccountId`) and refunds go back through that, so a booking paid
 * before the change is refunded from the old account after it.
 */

const RETURN_URLS = {
  refreshUrl: `${config.APP_URL}/settings?section=payments&refresh=1`,
  returnUrl: `${config.APP_URL}/settings?section=payments&done=1`,
};

/**
 * How long a PENDING payment is treated as somebody still at checkout. Stripe
 * sessions here live 32 minutes for a seat and 60 for a class pack; anything
 * older has expired whether or not its webhook has arrived.
 */
const OPEN_CHECKOUT_MINUTES = 65;

// ---------------------------------------------------------------------------
// Start over
// ---------------------------------------------------------------------------

/**
 * Drops an unfinished Stripe setup and begins a fresh one in the same step.
 *
 * Refused once the account can take payments: that is a change, with its own
 * flow, because dropping a working account would strand its money.
 */
export async function restartConnectOnboarding(
  organizationId: string,
  actorEmail: string,
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  if (!org.stripeAccountId) {
    throw AppError.conflict(
      'There is no Stripe setup to start over. Connect Stripe instead.',
      'STRIPE_NOT_CONNECTED',
    );
  }
  if (org.stripeChargesEnabled) {
    throw AppError.conflict(
      'This Stripe account is taking payments. Use "Change Stripe account" to move to a different one.',
      'STRIPE_ACCOUNT_ACTIVE',
    );
  }
  // Two new accounts at once would leave nobody sure which one is coming.
  if (org.pendingStripeAccountId) {
    throw AppError.conflict(
      'A switch to a new Stripe account is under way. Finish it or cancel it first.',
      'ACCOUNT_CHANGE_PENDING',
    );
  }

  const abandoned = org.stripeAccountId;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      stripeAccountId: null,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeOnboardedAt: null,
    },
  });

  logger.info(
    { organizationId, abandonedAccountId: abandoned },
    'Studio started Stripe setup over',
  );

  // It never took money, so nothing is lost by closing it, and it stops
  // cluttering the platform's list of connected accounts.
  await getPaymentProvider().closeAccount(abandoned);

  return startConnectOnboarding(organizationId, actorEmail);
}

// ---------------------------------------------------------------------------
// Change
// ---------------------------------------------------------------------------

/**
 * Starts — or resumes — moving a working studio to a new Stripe account.
 *
 * The first call creates the new account and parks it as pending; later calls
 * hand back a fresh setup link for the same pending account, so following the
 * button twice never makes two. A pending account Stripe no longer recognises
 * is replaced, which is safe because it never took a payment.
 */
export async function startAccountChange(
  organizationId: string,
  actorEmail: string,
  /** The owner typed the confirmation. Needed to start, not to resume. */
  confirmed: boolean,
) {
  const provider = getPaymentProvider();
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  if (!org.stripeAccountId || !org.stripeChargesEnabled) {
    throw AppError.conflict(
      'Changing account is for a studio already taking payments. Finish or start over the current Stripe setup instead.',
      'STRIPE_NOT_ACTIVE',
    );
  }
  if (!org.pendingStripeAccountId && !confirmed) {
    throw AppError.badRequest('Type CHANGE to confirm.', 'CONFIRMATION_REQUIRED');
  }

  /* Nobody mid-payment. A checkout open on the current account would still
     complete there, which is fine for the money, but a change started while a
     customer is paying reads as the studio pulling the rug, and the wait is a
     few minutes. Only checked when starting; resuming a pending change does
     not move bookings anywhere yet. */
  if (!org.pendingStripeAccountId) {
    const open = await prisma.payment.count({
      where: {
        organizationId,
        status: 'PENDING',
        createdAt: { gt: new Date(Date.now() - OPEN_CHECKOUT_MINUTES * 60_000) },
      },
    });
    if (open > 0) {
      throw AppError.conflict(
        'A customer is paying right now. Try again in a few minutes.',
        'CHECKOUT_IN_PROGRESS',
      );
    }
  }

  const createPending = async () => {
    const created = await provider.createConnectAccount({
      email: actorEmail,
      organizationName: org.name,
      country: config.STRIPE_ACCOUNT_COUNTRY,
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        pendingStripeAccountId: created.accountId,
        pendingStripeStartedAt: new Date(),
      },
    });
    logger.info(
      { organizationId, currentAccountId: org.stripeAccountId, pendingAccountId: created.accountId },
      'Studio started changing Stripe account',
    );
    return created.accountId;
  };

  let pending = org.pendingStripeAccountId ?? (await createPending());
  let link;
  try {
    link = await provider.createAccountLink({ accountId: pending, ...RETURN_URLS });
  } catch (err) {
    const unreachable =
      err instanceof AppError && err.code === 'STRIPE_ACCOUNT_UNREACHABLE';
    if (!unreachable || pending !== org.pendingStripeAccountId) throw err;
    pending = await createPending();
    link = await provider.createAccountLink({ accountId: pending, ...RETURN_URLS });
  }

  return { pendingAccountId: pending, url: link.url, expiresAt: link.expiresAt };
}

/** Abandons a pending change. The current account carries on untouched. */
export async function cancelAccountChange(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { pendingStripeAccountId: true },
  });
  if (!org.pendingStripeAccountId) {
    throw AppError.conflict('There is no account change to cancel.', 'NO_ACCOUNT_CHANGE');
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { pendingStripeAccountId: null, pendingStripeStartedAt: null },
  });
  logger.info(
    { organizationId, pendingAccountId: org.pendingStripeAccountId },
    'Studio cancelled a Stripe account change',
  );
  await getPaymentProvider().closeAccount(org.pendingStripeAccountId);
}

/**
 * Makes the pending account the studio's account, once Stripe says it can take
 * payments. Called with the pending account's status from wherever it was
 * learned: the owner's refresh on returning from Stripe, or `account.updated`.
 *
 * The swap is one conditional update — it only matches while the account is
 * still the pending one — so a refresh and a webhook arriving together switch
 * once and email once.
 */
export async function promotePendingAccount(
  organizationId: string,
  pendingAccountId: string,
  status: Pick<ConnectAccountStatus, 'chargesEnabled' | 'payoutsEnabled' | 'detailsSubmitted'>,
): Promise<boolean> {
  if (!status.chargesEnabled) return false;

  const before = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { stripeAccountId: true, name: true },
  });

  const now = new Date();
  const { count } = await prisma.organization.updateMany({
    where: { id: organizationId, pendingStripeAccountId: pendingAccountId },
    data: {
      stripeAccountId: pendingAccountId,
      pendingStripeAccountId: null,
      pendingStripeStartedAt: null,
      previousStripeAccountId: before.stripeAccountId,
      stripeAccountChangedAt: now,
      ...connectStatusUpdate(
        { accountId: pendingAccountId, requirements: [], ...status },
        null,
      ),
    },
  });
  if (count === 0) return false;

  logger.info(
    { organizationId, previousAccountId: before.stripeAccountId, accountId: pendingAccountId },
    'Studio switched to its new Stripe account',
  );
  await emailOwners(organizationId, before.name);
  return true;
}

/** Tells every owner the change happened, and what the old account still does. */
async function emailOwners(organizationId: string, studioName: string) {
  const owners = await prisma.membership.findMany({
    where: { organizationId, role: 'OWNER' },
    select: { user: { select: { email: true, name: true } } },
  });

  for (const { user } of owners) {
    await getEmailProvider()
      .send({
        to: user.email,
        subject: `${studioName} is now paid into your new Stripe account`,
        fromName: 'Artweel',
        text: [
          `Hi ${user.name || 'there'},`,
          '',
          `Stripe has finished setting up the new account for ${studioName}, and new bookings are now paid into it.`,
          '',
          'Your previous Stripe account stays open, and it still matters:',
          '- Money already in it pays out to its bank as usual.',
          '- Refunds for bookings paid before today come from it.',
          '- Any dispute on an earlier payment is answered from it.',
          '',
          'Keep it open, with enough balance for refunds, for at least six months.',
          '',
          `If you did not make this change, reply to this email straight away.`,
        ].join('\n'),
      })
      .catch((err: unknown) =>
        logger.error({ err, organizationId }, 'Could not email an owner about a Stripe account change'),
      );
  }
}

/**
 * Re-reads a pending account and switches to it if it is ready. For the
 * owner's refresh; returns what the screen needs to say.
 */
export async function checkPendingAccount(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { pendingStripeAccountId: true },
  });
  if (!org.pendingStripeAccountId) return null;

  const status = await getPaymentProvider().getAccountStatus(org.pendingStripeAccountId);
  const switched = await promotePendingAccount(
    organizationId,
    org.pendingStripeAccountId,
    status,
  );
  return { switched, requirements: switched ? [] : status.requirements };
}
