import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireMember } from '../../middleware/authenticate';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';

/**
 * Everything this studio is plugged into, on one screen.
 *
 * Nothing new is stored. Stripe already mirrors its own verdict onto the
 * organization via `account.updated`, every calendar connection carries a
 * status, and whether SMS can be sent at all is a fact about the deployment.
 * This route puts four existing truths in one response so a studio does not have
 * to visit four screens to find out why something is not working.
 *
 * Deliberately NOT included: worker heartbeats. They are Artweel's
 * infrastructure, not the studio's integrations, and the platform health
 * endpoint is deliberately invisible to a studio owner — there is a test
 * asserting exactly that. A studio does not care whether our queue drains; it
 * cares whether its messages arrive, which the notifications log already
 * answers.
 */
export const integrationRouter = Router({ mergeParams: true });

integrationRouter.get(
  '/',
  requireMember,
  asyncHandler(async (req, res) => {
    const organizationId = req.tenant!.organizationId;

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

    res.json({
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
        quietHours: {
          startHour: config.SMS_QUIET_START_HOUR,
          endHour: config.SMS_QUIET_END_HOUR,
        },
        optedOutCustomers: optedOut,
      },
    });
  }),
);
