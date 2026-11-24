import { BRAND, type Page } from './content';

/**
 * The legal pages: /terms, /privacy and /refund-policy.
 *
 * Stripe expects all three to be public and linked from the site footer before
 * live payments are reviewed.
 *
 * DRAFTS. The text came from Suren's draft on 2026-11-24, corrected where it
 * described things the product does not do (annual plans, AI features,
 * analytics cookies). It has not had a legal review.
 *
 * The business details are in LEGAL below, filled in by Suren on 2026-11-24.
 * The entity name and address must match the Stripe account exactly.
 */
export const LEGAL = {
  entity: 'BookAIHub Inc',
  address: '10 Evergreen Ave #D, Imperial Beach, CA 91932',
  governingLaw: 'the State of California, USA',
  supportEmail: 'support@bookaihub.com',
  supportPhone: '+1 619-920-6864',
  supportHours:
    'Monday to Thursday, 2:00 PM to 6:00 PM, and Friday to Sunday, 10:00 AM to 7:30 PM (Pacific Time)',
  updated: 'November 24, 2026',
};

const updated = `Last updated ${LEGAL.updated}.`;

export const TERMS: Page = {
  slug: 'terms',
  title: `Terms of Service | ${BRAND}`,
  description: `The terms that apply when you use ${BRAND} booking and scheduling software.`,
  h1: 'Terms of Service',
  intro: updated,
  sections: [
    {
      heading: '1. Agreement to terms',
      body: [
        `By accessing or using the website bookaihub.com, the web application at app.bookaihub.com, or any related services (together, the "Service") operated by ${LEGAL.entity} ("${BRAND}", "we", "us" or "our"), you agree to be bound by these Terms of Service ("Terms"). If you accept these Terms on behalf of a business or studio, you confirm that you have the authority to bind that business.`,
      ],
    },
    {
      heading: '2. Description of the Service',
      body: [
        `${BRAND} provides cloud-based booking, scheduling, payment and client management software for studios, workshops, tour operators and other service businesses ("Merchants"), and the booking pages their customers use ("End Users").`,
      ],
    },
    {
      heading: '3. Accounts and security',
      body: [
        'You must give accurate and complete registration information and keep your account credentials secure. You are responsible for all activity under your account.',
      ],
    },
    {
      heading: '4. Subscriptions, billing and payment processing',
      body: [
        'Subscription plans: paid access is billed monthly, in advance, at the price of the plan you choose at checkout or in your account.',
        'Automatic renewal: subscriptions renew at the end of each monthly billing period unless you cancel before the renewal date.',
        `Payment processing: subscription payments are processed by our payment processor, Stripe, Inc. ("Stripe"). By providing a payment method, you authorise us and Stripe to charge the applicable subscription fees and taxes.`,
        'Failed payments: if a payment fails, we may retry the charge and may suspend paid features until the balance is paid.',
      ],
    },
    {
      heading: '5. Stripe Connect and End User payments (for Merchants)',
      body: [
        `If you use ${BRAND} to take payments or deposits from your End Users, you must connect a valid Stripe account and accept the Stripe Connected Account Agreement.`,
        `${BRAND} is a software provider and is not a party to transactions between Merchants and End Users. Merchants are solely responsible for their own cancellation and refund terms, for delivering the services they sell, for handling customer disputes and chargebacks, and for complying with applicable tax laws.`,
      ],
    },
    {
      heading: '6. Acceptable use',
      body: [
        "You agree not to use the Service to process transactions prohibited under Stripe's restricted businesses list, to transmit unlawful or fraudulent content, to reverse-engineer the Service, or to interfere with its security.",
      ],
    },
    {
      heading: '7. Intellectual property',
      body: [
        `${BRAND} keeps all rights, title and interest in the Service, its software and its trademarks. You keep ownership of your business data and the customer records you put into the Service.`,
      ],
    },
    {
      heading: '8. Disclaimer and limitation of liability',
      body: [
        `The Service is provided "as is" and "as available". To the maximum extent permitted by law, ${BRAND} is not liable for any indirect, incidental or consequential damages, or for lost profits, revenue or data arising from your use of the Service. Our total liability will not exceed the fees you paid to ${BRAND} in the twelve (12) months before the claim.`,
      ],
    },
    {
      heading: '9. Governing law and contact',
      body: [
        `These Terms are governed by the laws of ${LEGAL.governingLaw}, without regard to conflict-of-law principles.`,
        `Questions about these Terms: email ${LEGAL.supportEmail}, call ${LEGAL.supportPhone}, or write to ${LEGAL.entity}, ${LEGAL.address}.`,
      ],
    },
  ],
};

export const PRIVACY: Page = {
  slug: 'privacy',
  title: `Privacy Policy | ${BRAND}`,
  description: `What personal data ${BRAND} collects, how it is used and shared, and the choices you have.`,
  h1: 'Privacy Policy',
  intro: updated,
  sections: [
    {
      heading: '1. Overview',
      body: [
        `${LEGAL.entity} ("${BRAND}", "we", "us" or "our") respects your privacy and protects the personal data collected through bookaihub.com and app.bookaihub.com.`,
      ],
    },
    {
      heading: '2. Information we collect',
      body: [
        'Account and business information: name, email address, phone number, business name, studio address and login credentials.',
        'Billing and transaction information: subscription plan, billing history and limited card details such as card brand and last four digits. We do not store full card numbers or bank account credentials on our servers.',
        'End User booking data: names, contact details, booking history and attendance records, entered by Merchants or submitted by End Users when they book.',
        'Calendar data: if a Merchant connects Google Calendar, we read and write the events needed to keep their schedule in sync.',
        'Technical data: IP address, browser type and request logs, used to run and secure the Service. The marketing site counts page views in aggregate only. It sets no tracking cookies and uses no third-party analytics.',
      ],
    },
    {
      heading: '3. How we use information',
      body: [
        `We use this information to provide and maintain the ${BRAND} booking platform; to process subscription billing and Merchant payouts; to send booking confirmations, reminders and support replies; and to keep the Service reliable, prevent fraud and meet our legal obligations.`,
      ],
    },
    {
      heading: '4. Payment processing (Stripe)',
      body: [
        "We use Stripe, Inc. to process payments, manage subscriptions and pay out Merchants. Payment details and identity verification data go directly to Stripe and are governed by Stripe's Privacy Policy (stripe.com/privacy). We share transaction and account data with Stripe only as needed to process payments, prevent fraud and comply with financial regulations.",
      ],
    },
    {
      heading: '5. Data sharing and security',
      body: [
        'We do not sell personal information. We share data only with service providers that help us run the Service (hosting, email delivery, text message delivery and payments), who are bound to keep it confidential, or when the law requires it.',
        'Data is encrypted in transit using TLS.',
      ],
    },
    {
      heading: '6. Data retention and your rights',
      body: [
        `We keep account data for as long as your account is active, or as needed for legal, tax and accounting obligations. Depending on where you live (including under the GDPR and the CCPA/CPRA), you can ask to access, correct or delete your personal data by emailing ${LEGAL.supportEmail}.`,
      ],
    },
    {
      heading: '7. Contact us',
      body: [
        `Questions about this policy or our data practices: email ${LEGAL.supportEmail}, call ${LEGAL.supportPhone}, or write to ${LEGAL.entity}, ${LEGAL.address}.`,
      ],
    },
  ],
};

export const REFUND_POLICY: Page = {
  slug: 'refund-policy',
  title: `Refund & Cancellation Policy | ${BRAND}`,
  description: `How cancelling a ${BRAND} subscription works, when refunds apply, and who to contact about a studio booking.`,
  h1: 'Refund & Cancellation Policy',
  intro: updated,
  sections: [
    {
      heading: '1. Free trial',
      body: [
        `New ${BRAND} accounts start with a 14-day free trial. No card is needed, and you are not charged unless you choose a paid plan.`,
      ],
    },
    {
      heading: '2. Cancelling your subscription',
      body: [
        `How to cancel: cancel at any time from Billing in your account at app.bookaihub.com, or email ${LEGAL.supportEmail} at least 24 hours before your next renewal date.`,
        'What happens: cancellation takes effect at the end of your current billing period. You keep full access until the end of the period you have paid for, and you will not be charged again.',
      ],
    },
    {
      heading: '3. Subscription refunds',
      body: [
        'Monthly subscription fees are non-refundable once a billing period has started, except where the law requires otherwise.',
        `Billing errors: if you think you were billed in error or charged twice, email ${LEGAL.supportEmail} within 30 days of the charge. We will review it promptly and refund any verified error in full.`,
      ],
    },
    {
      heading: '4. Bookings made with a studio',
      body: [
        `For classes, appointments, parties or deposits booked with a studio or business that uses ${BRAND}, that business sets its own cancellation, rescheduling and refund terms, which are shown when you book.`,
        'To cancel a booking or ask for a refund, use the link in your booking confirmation or contact the studio directly.',
      ],
    },
    {
      heading: '5. Support and disputes',
      body: [
        `Before opening a chargeback with your bank or card issuer, please contact us so we can sort out any billing issue directly. Email ${LEGAL.supportEmail} or call ${LEGAL.supportPhone}. Phone support is available ${LEGAL.supportHours}. We usually reply to email within one business day.`,
      ],
    },
  ],
};

export const LEGAL_PAGES: Page[] = [TERMS, PRIVACY, REFUND_POLICY];
