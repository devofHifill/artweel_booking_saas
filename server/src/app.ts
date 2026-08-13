import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import { healthRouter } from './modules/health/health.route';
import { authRouter } from './modules/auth/auth.route';
import { organizationRouter } from './modules/organizations/organization.route';
import { orgScopedRouter } from './routes/org-scoped';
import { publicRouter } from './modules/public/public.route';
import { allowEmbedding, embedRouter } from './modules/public/embed';
import { webhookRouter } from './modules/payments/webhook.route';
import { marketingRouter } from './modules/marketing/marketing.route';
import { inboundRouter } from './modules/notifications/inbound.route';
import {
  calendarCallbackRouter,
  calendarWebhookRouter,
} from './modules/calendar/calendar.route';
import { notFound } from './middleware/not-found';
import { errorHandler } from './middleware/error-handler';

/**
 * Builds the Express app. Deliberately does NOT call listen() — that is
 * server.ts's job. Keeping "build" separate from "start" means tests can
 * import a fully-wired app without opening a network port.
 *
 * `trust proxy` is on because the app sits behind nginx in every deployed
 * environment; without it req.ip is the proxy's address, which makes rate
 * limiting and session audit records useless.
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // The booking page inlines its own CSS and JS to ship in one request, so
  // the default CSP (which forbids inline anything) has to be relaxed for it.
  // Nothing is loaded from a third party, so 'self' plus inline is the whole
  // policy — there is no CDN to trust.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(cors());

  /**
   * Webhooks are mounted BEFORE the JSON parser, deliberately.
   *
   * Stripe signs the exact bytes it sent. Once express.json has parsed and the
   * body has been re-serialised, the signature cannot verify — and the failure
   * looks like a bad secret rather than a middleware ordering mistake, which
   * is a genuinely expensive afternoon. This router uses express.raw instead.
   */
  app.use('/webhooks', webhookRouter);
  // Twilio posts form-encoded, not JSON, and brings its own parser.
  app.use('/webhooks', inboundRouter);
  // Google pushes carry no body; nothing to parse.
  app.use('/webhooks', calendarWebhookRouter);

  // 100kb is generous for JSON here and keeps a hostile body from becoming a
  // memory problem before validation ever runs.
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  // Google redirects the instructor's browser here after consent, so it
  // cannot be behind authentication — the state parameter carries identity.
  app.use('/api/calendar', calendarCallbackRouter);
  app.use('/api/organizations', organizationRouter);
  // Everything a studio owns. Authentication and membership are enforced once,
  // inside this router, so no child module can forget them.
  app.use('/api/organizations/:organizationId', orgScopedRouter);
  // Unauthenticated, rate limited, and the only surface a stranger can reach.
  /**
   * The booking page, and the only thing in this app that may be framed.
   *
   * `allowEmbedding` runs before the router rather than inside it, so every
   * public route inherits it and a new one cannot be added that forgets. The
   * dashboard, the API and the marketing site all keep helmet's default
   * refusal — see the comment on `allowEmbedding` for why that separation is
   * load-bearing rather than tidiness.
   */
  app.use('/public', allowEmbedding, publicRouter);

  // The widget loader. Served from the root because a studio pastes an
  // absolute URL into their own site.
  app.use(embedRouter);

  /**
   * The marketing site sits at the root and is mounted LAST.
   *
   * Its slug matcher calls next() for anything it does not own, but mounting
   * it after the API and the booking pages means it can never shadow them
   * even if a future page slug collides.
   */
  app.use(marketingRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
