import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import {
  authenticate,
  requireAdmin,
  requireMember,
  requireRole,
  withOrganization,
} from '../../middleware/authenticate';
import { AppError } from '../../lib/app-error';
import { createOrganizationSchema, inviteMemberSchema } from '../auth/auth.schema';
import * as service from './organization.service';
import * as invitations from './invitation.service';
import { listMemberships } from '../auth/auth.service';

export const organizationRouter = Router();

// Everything below requires a signed-in user.
organizationRouter.use(authenticate);

organizationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ memberships: await listMemberships(req.auth!.userId) });
  }),
);

organizationRouter.post(
  '/',
  validateBody(createOrganizationSchema),
  asyncHandler(async (req, res) => {
    const organization = await service.createOrganization(
      req.auth!.userId,
      req.body,
    );
    res.status(201).json({ organization });
  }),
);

// --- Scoped to one organization ------------------------------------------
// withOrganization is the choke point: it proves membership before any
// handler below can touch a single row.

organizationRouter.get(
  '/:organizationId',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({
      organization: await service.getOrganization(req.tenant!.organizationId),
      role: req.tenant!.role,
    });
  }),
);

organizationRouter.patch(
  '/:organizationId',
  withOrganization(),
  requireAdmin,
  validateBody(
    z.object({
      name: z.string().min(1).max(120).optional(),
      timezone: z.string().max(64).optional(),
      currency: z.string().length(3).optional(),

      /**
       * Studio policy.
       *
       * These columns existed from the credits migration and nothing could
       * write them — not this route, not the seed, not onboarding. Only the
       * tests, reaching past the API. `makeUpCreditsEnabled` defaults to
       * false, so make-up credits were shipped switched off with no switch:
       * a whole workstream that no studio could ever reach.
       *
       * The bounds mirror the CHECK constraints in the migration, so a value
       * the database would reject is refused here with a readable message
       * rather than a 500.
       */
      makeUpCreditsEnabled: z.boolean().optional(),
      makeUpCreditDays: z.number().int().min(0).max(3650).optional(),
      makeUpRequiresNotice: z.boolean().optional(),
      makeUpNoticeHours: z.number().int().min(0).max(720).optional(),
      makeUpCrossCohort: z.boolean().optional(),
      pieceHoldDays: z.number().int().min(0).max(3650).optional(),

      /**
       * Business identity, for receipts and confirmations.
       *
       * Bounds mirror the CHECK constraints added in
       * `20260907200000_organization_settings`, so a value the database would
       * refuse is refused here with a sentence instead of a 500.
       */
      /*
        Contact details are writable HERE as well as on PATCH /page.

        Two screens legitimately edit them — Settings → Business information,
        and Website → Page content — because they are both the studio's
        contact details and the ones printed on the booking page. Validation is
        identical in both places and both write the same two columns, so there
        is no second source of truth; what there must never be is a second
        INTERPRETATION, so if one of these ever starts normalising a phone
        number, the other has to as well.
      */
      contactEmail: z.string().email().max(254).nullish().or(z.literal('')),
      contactPhone: z.string().max(40).nullish(),

      legalName: z.string().max(200).nullish(),
      address: z.string().max(500).nullish(),
      website: z.string().max(300).nullish(),
      businessType: z.string().max(80).nullish(),

      /**
       * Transactional email.
       *
       * No from-address, deliberately and permanently until domain
       * verification exists — see the migration. `emailReplyTo` is what puts
       * a customer's reply in the studio's inbox and needs no DNS at all.
       */
      emailFromName: z.string().max(120).nullish(),
      /* Stored whenever they like; applied only once their domain verifies.
         `emailDomainStatus` is NOT writable here — it is a fact about DNS,
         not a preference, and a studio marking itself ACTIVE would break
         every message it sends. */
      emailFromAddress: z.string().email().max(254).nullish().or(z.literal('')),
      emailReplyTo: z.string().email().max(254).nullish().or(z.literal('')),
      emailBcc: z.string().email().max(254).nullish().or(z.literal('')),
      emailFooter: z.string().max(1000).nullish(),

      /* Texts. No provider field — Twilio is the only one wired, so a stored
         choice would be a preference nothing honours. Quiet hours are stored
         as the operator sets them; applyQuietHours does the inversion. */
      smsEnabled: z.boolean().optional(),
      smsSenderId: z
        .string()
        .regex(/^[A-Za-z0-9 ]{1,11}$/, 'Up to 11 letters, digits or spaces.')
        .nullish()
        .or(z.literal('')),
      smsQuietFromHour: z.number().int().min(0).max(23).optional(),
      smsQuietToHour: z.number().int().min(0).max(23).optional(),

      /** Operator display only. Customers always get unambiguous dates. */
      dateFormat: z.string().max(40).optional(),
      timeFormat: z.enum(['12h', '24h']).optional(),

      /* Defaults the Create-activity form starts at. They do NOT reach back
         and change an activity somebody has already tuned. */
      defaultMinNoticeMinutes: z.number().int().min(0).max(20160).optional(),
      defaultMaxHorizonDays: z.number().int().min(1).max(730).optional(),

      /* Studio-wide booking rules. Bounds mirror the CHECK constraints in
         `20260907220000_booking_rules`, so a value the database would refuse
         is refused here with a sentence. */
      seatHoldMinutes: z.number().int().min(1).max(60).optional(),
      overbookingBuffer: z.number().int().min(0).max(20).optional(),
      allowSameDayBookings: z.boolean().optional(),
      autoConfirmOnPayment: z.boolean().optional(),
      requireWaiver: z.boolean().optional(),
      requirePhoneAtCheckout: z.boolean().optional(),
      allowChildTickets: z.boolean().optional(),

      /* Payments. No provider field: Stripe is the only one implemented, so
         a stored choice would be a preference the code cannot honour. */
      depositsEnabled: z.boolean().optional(),
      defaultDepositPercent: z.number().int().min(0).max(99).optional(),
      allowPayOnArrival: z.boolean().optional(),
      acceptCash: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json({
      organization: await service.updateOrganization(
        req.tenant!.organizationId,
        req.body,
      ),
    });
  }),
);

// --- Branding -------------------------------------------------------------
//
// Its own pair of routes rather than more fields on the settings PATCH above.
// Saving a theme has to DERIVE and validate a palette and can answer "your
// colour was adjusted, here is why", which is a different response shape from
// "here is the updated organization" — and folding it in would have made the
// settings route answer two unrelated questions.

organizationRouter.get(
  '/:organizationId/theme',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getTheme(req.tenant!.organizationId));
  }),
);

organizationRouter.patch(
  '/:organizationId/theme',
  withOrganization(),
  requireAdmin,
  validateBody(
    z.object({
      /**
       * A preset id, or the literal 'custom'.
       *
       * Not an enum of the known ids: the presets live in lib/brand.ts and the
       * service already resolves an unknown id to a readable 400. Restating the
       * list here would mean adding a preset in two files, and the day someone
       * updated only one, the new swatch would render in the picker and refuse
       * to save.
       */
      preset: z.string().min(1).max(32),

      /**
       * Six hex digits, lower or upper case; the service canonicalises to lower
       * before writing, matching the CHECK constraint on the column. Shorthand
       * (#abc) is refused rather than expanded so the stored value has exactly
       * one form.
       */
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, like #a6522c.')
        .nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await service.updateTheme(req.tenant!.organizationId, req.body));
  }),
);

// --- Storefront copy -----------------------------------------------------
//
// The paired shape borrows straight from /theme: the fields are read together
// on the Website & Widget page and written together when the studio hits Save,
// and folding them into the settings PATCH would have made an owner's edit to
// their tagline share a request with their cancellation rules.
//
// The bounds mirror the CHECK constraints in the migration, so a value the
// database would reject is refused here with a readable message rather than
// a 500. Every field accepts null explicitly, so the UI can clear a value
// back to the fallback rather than only ever appending to it.

organizationRouter.get(
  '/:organizationId/page',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getPageContent(req.tenant!.organizationId));
  }),
);

organizationRouter.patch(
  '/:organizationId/page',
  withOrganization(),
  requireAdmin,
  validateBody(
    z.object({
      tagline: z.string().max(160).nullish(),
      about: z.string().max(2000).nullish(),
      contactEmail: z.string().email().max(254).nullish().or(z.literal('')),
      contactPhone: z.string().max(40).nullish(),
      seoTitle: z.string().max(70).nullish(),
      seoDescription: z.string().max(200).nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await service.updatePageContent(req.tenant!.organizationId, req.body),
    );
  }),
);

organizationRouter.get(
  '/:organizationId/permissions',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json(await service.getPermissions(req.tenant!.organizationId));
  }),
);

/*
  requireAdmin, not the matrix itself. Letting a role edit the table that
  decides what that role may do is a ladder anybody can climb — an admin could
  grant themselves billing, or a manager could grant themselves settings.
*/
organizationRouter.put(
  '/:organizationId/permissions',
  withOrganization(),
  requireAdmin,
  validateBody(
    z.object({
      role: z.string().min(1).max(32),
      permission: z.string().min(1).max(64),
      allowed: z.boolean(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { role, permission, allowed } = req.body as {
      role: string;
      permission: string;
      allowed: boolean;
    };
    res.json(
      await service.setPermission(
        req.tenant!.organizationId,
        role,
        permission,
        allowed,
      ),
    );
  }),
);

organizationRouter.get(
  '/:organizationId/members',
  withOrganization(),
  requireMember,
  asyncHandler(async (req, res) => {
    res.json({ members: await service.listMembers(req.tenant!.organizationId) });
  }),
);

// --- Invitations (S9) -----------------------------------------------------
//
// The path by which anybody other than a founder gets into a studio. `register`
// only ever mints an OWNER, so until these routes existed ADMIN, INSTRUCTOR and
// FRONT_DESK were enforced everywhere and grantable nowhere.
//
// `requireAdmin`, not `requireRole('OWNER')`: adding an instructor is ordinary
// studio administration. Handing over OWNERSHIP is not, and is not something
// these routes can do — `inviteMemberSchema` has no OWNER in its enum and the
// database has a CHECK constraint saying the same.

organizationRouter.get(
  '/:organizationId/invitations',
  withOrganization(),
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      invitations: await invitations.listInvitations(req.tenant!.organizationId),
    });
  }),
);

organizationRouter.post(
  '/:organizationId/invitations',
  withOrganization(),
  requireAdmin,
  validateBody(inviteMemberSchema),
  asyncHandler(async (req, res) => {
    const result = await invitations.inviteMember(
      req.tenant!.organizationId,
      req.auth!.userId,
      req.body,
    );

    res.status(201).json({
      invitation: result.invitation,
      /**
       * The link, handed back to the admin who created it.
       *
       * Not a leak — they already administer this studio — and it is what lets
       * an owner pass the link along by hand when their invitation email lands
       * in somebody's spam folder. Without it that is a support ticket nobody
       * can resolve.
       */
      inviteUrl: `${config.APP_URL}/invite/${encodeURIComponent(result.token)}`,
    });
  }),
);

organizationRouter.delete(
  '/:organizationId/invitations/:invitationId',
  withOrganization(),
  requireAdmin,
  asyncHandler(async (req, res) => {
    const invitationId = req.params.invitationId;
    if (!invitationId) throw AppError.badRequest('Missing invitationId.');

    res.json(
      await invitations.revokeInvitation(
        req.tenant!.organizationId,
        invitationId,
      ),
    );
  }),
);

organizationRouter.patch(
  '/:organizationId/members/:membershipId',
  withOrganization(),
  requireRole('OWNER'),
  validateBody(
    z.object({
      role: z.enum(['OWNER', 'ADMIN', 'INSTRUCTOR', 'FRONT_DESK']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const membershipId = req.params.membershipId;
    if (!membershipId) throw AppError.badRequest('Missing membershipId.');

    res.json({
      membership: await service.changeMemberRole(
        req.tenant!.organizationId,
        membershipId,
        req.body.role,
      ),
    });
  }),
);

organizationRouter.delete(
  '/:organizationId/members/:membershipId',
  withOrganization(),
  requireRole('OWNER'),
  asyncHandler(async (req, res) => {
    const membershipId = req.params.membershipId;
    if (!membershipId) throw AppError.badRequest('Missing membershipId.');

    await service.removeMember(req.tenant!.organizationId, membershipId);
    res.status(204).send();
  }),
);
