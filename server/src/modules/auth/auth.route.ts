import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { config } from '../../config';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rate-limit';
import * as controller from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schema';

export const authRouter = Router();

/**
 * Limiters are keyed per route name, so a budget spent guessing passwords
 * cannot also be spent farming accounts or spamming resets.
 *
 * Keyed on IP, which stops the ordinary case: one machine working through a
 * password list. It does NOT stop a distributed attempt against one known
 * address, because each source IP arrives with its own budget. Closing that
 * properly means counting FAILED attempts per email and resetting on success —
 * a per-email counter that blocks before the password is checked is an
 * account-lockout weapon, since anyone who knows your address could hold you
 * out of your own studio. That needs a decision about which failure mode is
 * worse, and it is deliberately not made here.
 */
const windowMs = config.AUTH_RATE_WINDOW_MINUTES * 60_000;

const loginLimit = rateLimit({
  windowMs,
  max: config.AUTH_LOGIN_RATE_MAX,
  name: 'auth-login',
});

const registerLimit = rateLimit({
  windowMs,
  max: config.AUTH_REGISTER_RATE_MAX,
  name: 'auth-register',
});

/**
 * Shared by forgot-password and reset-password on purpose: they are two halves
 * of one flow, and one budget for the pair is harder to game than two.
 *
 * The threat here is NOT token guessing — reset tokens are 32 random bytes, so
 * grinding them is not an attack anyone can mount. It is volume: mailbombing
 * somebody else's address with reset emails from our domain, which costs us
 * deliverability reputation and costs them their patience. `verify-email` is
 * left unlimited for the same reason inverted — it consumes an equally
 * unguessable token and nobody can be spammed by it.
 */
const resetLimit = rateLimit({
  windowMs,
  max: config.AUTH_RESET_RATE_MAX,
  name: 'auth-reset',
});

// --- Public ---------------------------------------------------------------
authRouter.post(
  '/register',
  registerLimit,
  validateBody(registerSchema),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  loginLimit,
  validateBody(loginSchema),
  asyncHandler(controller.login),
);

/**
 * Refresh is deliberately NOT limited by IP.
 *
 * It is the one route here that every signed-in client hits automatically, on a
 * 15-minute cycle, unprompted — so a studio's whole staff behind one office IP
 * generates steady legitimate traffic, and a limit tight enough to matter would
 * sign them all out. It is also already protected by something stronger than a
 * counter: rotation with family revocation means a stolen or replayed token
 * kills the whole family rather than granting attempts.
 */
authRouter.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler(controller.refresh),
);

authRouter.post(
  '/logout',
  validateBody(refreshSchema),
  asyncHandler(controller.logout),
);

authRouter.post(
  '/verify-email',
  validateBody(verifyEmailSchema),
  asyncHandler(controller.verifyEmail),
);

authRouter.post(
  '/forgot-password',
  resetLimit,
  validateBody(forgotPasswordSchema),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  resetLimit,
  validateBody(resetPasswordSchema),
  asyncHandler(controller.resetPassword),
);

// --- Authenticated --------------------------------------------------------
authRouter.get('/me', authenticate, asyncHandler(controller.me));

authRouter.post(
  '/resend-verification',
  authenticate,
  asyncHandler(controller.resendVerification),
);

authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(controller.changePassword),
);

authRouter.post(
  '/logout-everywhere',
  authenticate,
  asyncHandler(controller.logoutEverywhere),
);
