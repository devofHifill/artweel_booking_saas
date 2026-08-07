import pino from 'pino';
import { config } from '../config';

/**
 * Structured logging. Pretty-printed in development, JSON everywhere else so
 * logs stay machine-searchable in whatever aggregator we land on.
 *
 * Tests run near-silent — a passing suite should print its own results, not
 * a thousand query logs.
 */
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});
