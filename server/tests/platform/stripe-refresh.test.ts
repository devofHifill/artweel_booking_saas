import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/fixtures';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { signUpStudio, type Studio } from '../helpers/api';
import { grantPlatformAdmin } from '../../src/modules/platform/platform.service';
import { listAuditLog } from '../../src/modules/platform/audit.service';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { setPaymentProvider } from '../../src/modules/payments/provider.registry';
import { accountError } from '../../src/modules/payments/stripe.provider';

/**
 * Re-reading a studio's Connect status without waiting for `account.updated`.
 *
 * The webhook is the intended path, but it can be missed entirely — a
 * destination aimed at the wrong host left studios "restricted" long after they
 * finished onboarding. The platform needs a way to unstick them, and the owner
 * needs to land back somewhere that actually re-reads the status.
 */

/** What Stripe answers for a connected account made under another platform key. */
function accountInvalid() {
  return new Stripe.errors.StripePermissionError({
    type: 'invalid_request_error',
    code: 'account_invalid',
    message: "The provided key 'sk_test_***' does not have access to account 'acct_x'.",
  });
}

/** What Stripe answers when asked for an onboarding link to that same account. */
function noSuchAccount() {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    param: 'account',
    message: "No such account: 'acct_x'",
  });
}

/**
 * Records the URLs onboarding hands Stripe, so the test can read them back, and
 * can play an account this key no longer reaches.
 */
class RecordingProvider extends FakePaymentProvider {
  links: { accountId: string; returnUrl: string; refreshUrl: string }[] = [];
  unreachable = false;
  /** Accounts that answer "No such account" when a link is minted for them. */
  dead = new Set<string>();

  override async getAccountStatus(accountId: string) {
    if (this.unreachable) throw accountError(accountInvalid());
    return super.getAccountStatus(accountId);
  }

  override async createAccountLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }) {
    if (this.dead.has(input.accountId)) throw accountError(noSuchAccount());
    this.links.push({
      accountId: input.accountId,
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
    });
    return super.createAccountLink(input);
  }
}

const app = createApp();

let provider: RecordingProvider;
let admin: Studio;
let target: Studio;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  provider = new RecordingProvider();
  setPaymentProvider(provider);

  admin = await signUpStudio(app, { organizationName: 'Artweel HQ' });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { email: true },
  });
  await grantPlatformAdmin({ email: user.email });

  target = await signUpStudio(app, { organizationName: 'Clay & Co' });
});

function adminRefresh(as: Studio = admin) {
  return request(app)
    .post(`/api/platform/organizations/${target.organizationId}/stripe-refresh`)
    .set(as.headers);
}

/** Starts onboarding as the owner and returns the new Connect account id. */
async function connect() {
  await request(app).post(`${target.base}/payments/connect`).set(target.headers);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: target.organizationId },
  });
  return org.stripeAccountId!;
}

describe('platform refresh of a studio Connect status', () => {
  it('copies Stripe’s verdict when the webhook never arrived, and audits it', async () => {
    const accountId = await connect();
    // Stripe now says the studio can take money; no webhook has told us.
    provider.completeOnboarding(accountId);

    const res = await adminRefresh();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
    });

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeChargesEnabled).toBe(true);
    expect(org.stripePayoutsEnabled).toBe(true);
    expect(org.stripeOnboardedAt).not.toBeNull();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      action: 'organization.stripe_refresh',
      organizationId: target.organizationId,
    });
    expect(entry!.metadata).toMatchObject({
      before: { chargesEnabled: false, payoutsEnabled: false },
      after: { chargesEnabled: true, payoutsEnabled: true },
    });
  });

  it('reports what Stripe still wants when the account is still restricted', async () => {
    await connect();

    const res = await adminRefresh();

    expect(res.status).toBe(200);
    expect(res.body.chargesEnabled).toBe(false);
    expect(res.body.requirements).toEqual(['business_profile.url', 'external_account']);
  });

  it('refuses a studio that never connected Stripe, without an audit row', async () => {
    const res = await adminRefresh();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_NOT_CONNECTED');
    expect(await listAuditLog()).toHaveLength(0);
  });

  it('is invisible to a studio owner', async () => {
    await connect();

    const res = await adminRefresh(target);

    expect(res.status).toBe(404);
  });
});

describe('the way back from Stripe onboarding', () => {
  /**
   * The client has no `/settings/payments` route. Those URLs fell through to the
   * dashboard and dropped `done=1`, so nothing ever re-read the status.
   */
  it('lands on the Payments section of Settings, which the client can open', async () => {
    await connect();

    const [link] = provider.links;
    expect(new URL(link!.returnUrl).pathname).toBe('/settings');
    expect(new URL(link!.returnUrl).search).toBe('?section=payments&done=1');
    expect(new URL(link!.refreshUrl).pathname).toBe('/settings');
    expect(new URL(link!.refreshUrl).search).toBe('?section=payments&refresh=1');
  });
});

describe('a connected account this platform key cannot reach', () => {
  it('maps Stripe’s account_invalid to a 409 that says what to do', () => {
    const mapped = accountError(accountInvalid()) as { statusCode: number; code: string; message: string };

    expect(mapped.statusCode).toBe(409);
    expect(mapped.code).toBe('STRIPE_ACCOUNT_UNREACHABLE');
    expect(mapped.message).toMatch(/connect Stripe again/);
    // Stripe's own message echoes part of the secret key; it must not be passed on.
    expect(mapped.message).not.toMatch(/sk_test/);
  });

  it('maps "No such account" on an onboarding link the same way', () => {
    const mapped = accountError(noSuchAccount()) as { code: string };

    expect(mapped.code).toBe('STRIPE_ACCOUNT_UNREACHABLE');
  });

  it('leaves a missing resource that is not the account alone', () => {
    const missingSession = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      message: "No such checkout.session: 'cs_test_x'",
    });

    expect(accountError(missingSession)).toBe(missingSession);
  });

  it('leaves every other error alone, so a bug still surfaces as a bug', () => {
    const other = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'parameter_missing',
      message: 'Missing required param: amount.',
    });
    const plain = new Error('boom');

    expect(accountError(other)).toBe(other);
    expect(accountError(plain)).toBe(plain);
  });

  it('answers the platform refresh with that 409 instead of a 500, and audits nothing', async () => {
    await connect();
    provider.unreachable = true;

    const res = await adminRefresh();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_ACCOUNT_UNREACHABLE');
    expect(await listAuditLog()).toHaveLength(0);
  });
});

describe('platform reset of a studio Stripe connection', () => {
  const REASON = 'connected under the old staging Stripe sandbox';

  function adminReset(body: object, as: Studio = admin) {
    return request(app)
      .post(`/api/platform/organizations/${target.organizationId}/stripe-reset`)
      .set(as.headers)
      .send(body);
  }

  it('forgets the account, keeps its id in the audit row, and lets the owner connect afresh', async () => {
    const oldAccount = await connect();

    const res = await adminReset({ reason: REASON });

    expect(res.status).toBe(200);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeAccountId).toBeNull();
    expect(org.stripeChargesEnabled).toBe(false);
    expect(org.stripeOnboardedAt).toBeNull();

    const [entry] = await listAuditLog();
    expect(entry).toMatchObject({
      action: 'organization.stripe_reset',
      organizationId: target.organizationId,
      reason: REASON,
    });
    expect(entry!.metadata).toMatchObject({ before: { stripeAccountId: oldAccount } });

    // Connecting again creates a new account rather than reusing the dead one.
    const fresh = await connect();
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(oldAccount);
  });

  it('requires a real reason', async () => {
    await connect();

    const res = await adminReset({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a studio that is taking payments, and changes nothing', async () => {
    const accountId = await connect();
    provider.completeOnboarding(accountId);
    await adminRefresh();

    const res = await adminReset({ reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_ACCOUNT_ACTIVE');
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeAccountId).toBe(accountId);
  });

  it('refuses a studio with nothing to reset', async () => {
    const res = await adminReset({ reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_NOT_CONNECTED');
  });

  it('is invisible to a studio owner', async () => {
    await connect();

    const res = await adminReset({ reason: REASON }, target);

    expect(res.status).toBe(404);
  });
});

describe('the owner connecting again over an unreachable account', () => {
  function ownerConnect() {
    return request(app).post(`${target.base}/payments/connect`).set(target.headers);
  }

  it('swaps a dead account that never took payments for a new one, and onboards that', async () => {
    const dead = await connect();
    provider.dead.add(dead);

    const res = await ownerConnect();

    expect(res.status).toBe(200);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeAccountId).toBeTruthy();
    expect(org.stripeAccountId).not.toBe(dead);
    expect(provider.links.at(-1)!.accountId).toBe(org.stripeAccountId);
  });

  it('refuses to replace an account that has been taking payments', async () => {
    const live = await connect();
    provider.completeOnboarding(live);
    await adminRefresh();
    provider.dead.add(live);

    const res = await ownerConnect();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STRIPE_ACCOUNT_UNREACHABLE');
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeAccountId).toBe(live);
  });

  it('resumes a reachable account rather than making another', async () => {
    const first = await connect();

    const res = await ownerConnect();

    expect(res.status).toBe(200);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organizationId },
    });
    expect(org.stripeAccountId).toBe(first);
  });
});
