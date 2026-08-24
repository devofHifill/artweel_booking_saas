import type { Request, Response } from 'express';
import { AppError } from '../../lib/app-error';
import * as authService from './auth.service';
import {
  rotateRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
} from './token.service';
import { prisma } from '../../lib/prisma';

function clientContext(req: Request) {
  return {
    userAgent: req.headers['user-agent']?.slice(0, 255),
    ip: req.ip,
  };
}

export async function register(req: Request, res: Response) {
  const result = await authService.register({
    ...req.body,
    ...clientContext(req),
  });

  res.status(201).json({
    user: result.user,
    organization: result.organization,
    tokens: result.tokens,
    // Until W1.5 wires the mailer, the caller needs this to complete the flow.
    // It must be removed the moment email sending lands.
    verificationToken: result.verificationToken,
  });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login({
    ...req.body,
    ...clientContext(req),
  });
  res.json(result);
}

export async function refresh(req: Request, res: Response) {
  const tokens = await rotateRefreshToken(
    req.body.refreshToken,
    clientContext(req),
  );
  res.json({ tokens });
}

export async function logout(req: Request, res: Response) {
  await revokeRefreshToken(req.body.refreshToken);
  res.status(204).send();
}

export async function logoutEverywhere(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const count = await revokeAllUserTokens(req.auth.userId);
  res.json({ sessionsRevoked: count });
}

export async function me(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth.userId },
  });

  /**
   * A support session reports the studio it is scoped to, and ONLY that one.
   *
   * The operator's own memberships are deliberately not returned here. They
   * are real — a platform admin may also own a studio of their own — but a
   * support token cannot reach them, so listing them would put studios in the
   * dashboard's switcher that every request for would 404. The client renders
   * what it is told; telling it the truth about this token's reach is what
   * keeps the two in agreement.
   */
  if (req.support) {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: req.support.organizationId },
      select: { id: true, name: true, slug: true, timezone: true, currency: true },
    });

    res.json({
      user: authService.publicUser(user),
      memberships: [
        {
          organizationId: organization.id,
          // Matches what `withOrganization` grants, so the client hides the
          // same controls the server would refuse.
          role: 'ADMIN' as const,
          organization,
        },
      ],
      support: {
        sessionId: req.support.sessionId,
        organizationId: req.support.organizationId,
        readOnly: req.support.readOnly,
        studioName: organization.name,
      },
    });
    return;
  }

  res.json({
    user: authService.publicUser(user),
    memberships: await authService.listMemberships(user.id),
  });
}

export async function verifyEmail(req: Request, res: Response) {
  const user = await authService.verifyEmail(req.body.token);
  res.json({ user });
}

export async function resendVerification(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const token = await authService.resendVerification(req.auth.userId);
  res.json({ verificationToken: token });
}

export async function forgotPassword(req: Request, res: Response) {
  const result = await authService.requestPasswordReset(req.body.email);

  // Always 202, whether or not the address exists. The response must not
  // reveal who has an account.
  res.status(202).json({
    message: 'If that address has an account, a reset link is on its way.',
    ...(result.token ? { resetToken: result.token } : {}),
  });
}

export async function resetPassword(req: Request, res: Response) {
  const result = await authService.resetPassword(
    req.body.token,
    req.body.password,
  );
  res.json(result);
}

export async function changePassword(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();

  const result = await authService.changePassword(
    req.auth.userId,
    req.body.currentPassword,
    req.body.newPassword,
  );

  res.json(result);
}

// --- Invitations (S9) -----------------------------------------------------

function inviteToken(req: Request): string {
  const token = req.params.token;
  if (!token) throw AppError.notFound('That invitation link is not valid.');
  return token;
}

/** Describes an invitation so the accept page can say what it is offering. */
export async function readInvitation(req: Request, res: Response) {
  const { getInvitation } = await import(
    '../organizations/invitation.service'
  );
  res.json(await getInvitation(inviteToken(req)));
}

/**
 * Accepting signs them straight in.
 *
 * Landing on the login screen after clicking "join the team" and choosing a
 * password is a dead end — they have just proved who they are twice over, and
 * asking again reads as the product having lost track.
 */
export async function acceptInvitation(req: Request, res: Response) {
  const { acceptInvitation: accept } = await import(
    '../organizations/invitation.service'
  );

  const result = await accept({
    token: inviteToken(req),
    password: req.body.password,
    ...clientContext(req),
  });

  res.status(201).json(result);
}
