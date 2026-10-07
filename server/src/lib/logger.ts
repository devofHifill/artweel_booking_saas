import pino, { type Logger } from 'pino';
import pinoHttp from 'pino-http';
import { config } from '../config';

/**
 * Structured logging. Pretty-printed in development, JSON everywhere else so
 * logs stay machine-searchable in whatever aggregator we land on.
 *
 * Tests run near-silent — a passing suite should print its own results, not
 * a thousand query logs.
 */
/**
 * Credentials that ride along on every request log line.
 *
 * pino-http logs request and response headers in full, so without this each
 * line carried a working `Authorization: Bearer …` — anyone with `docker logs`
 * access could lift a signed-in session. Censored rather than removed, so a
 * log still shows that the header was present.
 */
export const REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'req.query.code',
    'req.query.state',
    'req.query.token',
  ],
  censor: '[Redacted]',
};

/** Query parameters whose values must never reach a log, wherever they appear. */
const SECRET_PARAMS = /([?&](?:code|state|token)=)[^&#]*/gi;

/**
 * The URL as logged. Google's OAuth callback carries a one-time `code` in the
 * query string, and redacting `req.query` alone leaves it readable in `url`.
 */
export function scrubUrl(url: string): string {
  return url.replace(SECRET_PARAMS, '$1[Redacted]');
}

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: REDACT,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});

/**
 * HTTP request logging. Headers are censored by the logger's own `redact`;
 * the URL needs a separate pass because the query string is part of it.
 */
export function requestLogger(base: Logger = logger) {
  return pinoHttp({
    logger: base,
    serializers: {
      req: (req: { url?: string }) => {
        if (req.url) req.url = scrubUrl(req.url);
        return req;
      },
    },
  });
}
