import { prisma } from '../../lib/prisma';
import { config } from '../../config';

/**
 * Everything a studio is plugged into, as one answer.
 *
 * Extracted from the route in S10, when the platform needed the same picture
 * for an arbitrary studio. Two implementations of "is their Stripe connected"
 * would drift the first time one of them learned about a new state, and the
 * drift would surface as an operator and an owner reading the same studio
 * differently while on the phone to each other — which is precisely the moment
 * it matters most that they agree.
 *
 * Nothing new is stored. Stripe already mirrors its own verdict onto the
 * organization via `account.updated`, every calendar connection carries a
 * status, and whether SMS can be sent at all is a fact about the deployment.
 */
export async function getIntegrationStatus(organizationId: string) {
  const [org, staff, optedOut] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeOnboardedAt: true,
      },
    }),

    /*
      Every active instructor, connected or not. Listing only the connected
      ones would answer "which calendars sync" while hiding the more useful
      question — who is still missing, and therefore whose availability we
      cannot see.
    */
    prisma.staff.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        calendarConnection: {
          select: {
            status: true,
            accountEmail: true,
            provider: true,
            channelExpiresAt: true,
            lastSyncedAt: true,
            lastError: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),

    prisma.customer.count({
      where: { organizationId, smsOptedOutAt: { not: null } },
    }),
  ]);

  return {
    payments: {
      provider: 'stripe',
      connected: org.stripeAccountId !== null,
      chargesEnabled: org.stripeChargesEnabled,
      payoutsEnabled: org.stripePayoutsEnabled,
      onboardedAt: org.stripeOnboardedAt,
    },

    calendars: staff.map((person) => ({
      staffId: person.id,
      staffName: person.name,
      connected: person.calendarConnection !== null,
      status: person.calendarConnection?.status ?? null,
      accountEmail: person.calendarConnection?.accountEmail ?? null,
      provider: person.calendarConnection?.provider ?? null,
      lastChangedAt: person.calendarConnection?.updatedAt ?? null,

      /*
        When it last actually pulled, rather than when the row last changed.

        `updatedAt` moves for any reason at all — a token refresh, a status
        flip — so a connection that has not synced since Tuesday can carry
        this morning's timestamp. The difference matters here because this
        page exists to answer "is it working", and the two questions have
        different answers exactly when something is wrong.
      */
      lastSyncedAt: person.calendarConnection?.lastSyncedAt ?? null,
      lastError: person.calendarConnection?.lastError ?? null,

      /*
        Google expires a push channel after about a week. Once it lapses,
        inbound sync stops without anything failing: the calendar simply
        stops telling us about changes, availability keeps being offered from
        stale data, and the studio finds out from a double booking. It was
        already being selected here and dropped before it reached anybody.
      */
      pushExpiresAt: person.calendarConnection?.channelExpiresAt ?? null,
    })),

    sms: {
      /*
        Whether the deployment can send SMS at all. A studio whose reminders
        are silently not going out deserves to be told the reason is
        configuration rather than their customers' phones — but only the
        boolean: credentials never leave the server.
      */
      available: Boolean(
        config.TWILIO_ACCOUNT_SID &&
          config.TWILIO_AUTH_TOKEN &&
          config.TWILIO_FROM_NUMBER,
      ),
      /*
        `sendingWindow`, not `quietHours`, and the rename is the point: these
        two config values are when texting is ALLOWED (8am to 9pm), so a field
        called quietHours means the opposite of what it says. This screen
        happened to render it correctly by inverting the pair; the
        notifications panel read it straight and described the rule backwards.
        One of the two readers getting it wrong is the argument for the name.
      */
      sendingWindow: {
        fromHour: config.SMS_QUIET_START_HOUR,
        toHour: config.SMS_QUIET_END_HOUR,
      },
      optedOutCustomers: optedOut,
    },
  };
}
