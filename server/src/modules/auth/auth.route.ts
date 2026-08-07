import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
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

// --- Public ---------------------------------------------------------------
authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(controller.register),
);

authRouter.post('/login', validateBody(loginSchema), asyncHandler(controller.login));

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
  validateBody(forgotPasswordSchema),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
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
