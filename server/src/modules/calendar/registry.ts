import { config } from '../../config';
import { logger } from '../../lib/logger';
import { FakeCalendarProvider } from './fake.provider';
import { GoogleCalendarProvider } from './google.provider';
import type { CalendarProvider } from './provider';

let instance: CalendarProvider | null = null;

export function getCalendarProvider(): CalendarProvider {
  if (instance) return instance;

  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    instance = new GoogleCalendarProvider(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
    );
  } else {
    if (config.NODE_ENV !== 'test') {
      logger.warn(
        'No Google credentials configured — calendar sync is using the fake provider.',
      );
    }
    instance = new FakeCalendarProvider();
  }

  return instance;
}

export function setCalendarProvider(provider: CalendarProvider) {
  instance = provider;
}

export function isCalendarConfigured(): boolean {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}
