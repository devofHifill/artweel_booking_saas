import { config } from '../../config';
import { logger } from '../../lib/logger';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
  ResendEmailProvider,
  TwilioSmsProvider,
  type EmailProvider,
  type SmsProvider,
} from './provider';

let email: EmailProvider | null = null;
let sms: SmsProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (email) return email;

  if (config.RESEND_API_KEY) {
    email = new ResendEmailProvider(config.RESEND_API_KEY, config.EMAIL_FROM);
  } else {
    if (config.NODE_ENV !== 'test') {
      logger.warn('No email provider configured — messages will only be logged.');
    }
    email = new ConsoleEmailProvider();
  }

  return email;
}

export function getSmsProvider(): SmsProvider {
  if (sms) return sms;

  if (
    config.TWILIO_ACCOUNT_SID &&
    config.TWILIO_AUTH_TOKEN &&
    config.TWILIO_FROM_NUMBER
  ) {
    sms = new TwilioSmsProvider(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      config.TWILIO_FROM_NUMBER,
    );
  } else {
    if (config.NODE_ENV !== 'test') {
      logger.warn('No SMS provider configured — messages will only be logged.');
    }
    sms = new ConsoleSmsProvider();
  }

  return sms;
}

/** Tests swap in recording fakes. */
export function setProviders(providers: {
  email?: EmailProvider;
  sms?: SmsProvider;
}) {
  if (providers.email) email = providers.email;
  if (providers.sms) sms = providers.sms;
}
