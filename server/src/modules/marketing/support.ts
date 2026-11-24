import { BRAND, type Page } from './content';
import { LEGAL, SUPPORT_HOURS } from './legal';

/**
 * /support: how to reach BookAIHub, and where to go instead when we are not
 * the right people.
 *
 * Two kinds of visitor land here and need different answers:
 * - a BUSINESS on BookAIHub (an account problem, billing, Stripe, setup), who
 *   we can help directly;
 * - a CUSTOMER who booked with one of those businesses, whose booking,
 *   refund and cancellation terms belong to that business (Terms §5). We
 *   cannot change their booking, so the page says so and sends them to the
 *   link in their confirmation or to the business.
 *
 * Contact details come from LEGAL, so the phone, email and hours here can
 * never disagree with the legal pages. Every answer describes something the
 * product does today; see the rule at the top of content.ts.
 */

/**
 * The dashboard's own guides (client/src/guides/index.ts). Listed here by
 * title so a signed-out visitor can see what exists; the links open them in
 * the dashboard, behind sign-in. Keep in step with that file.
 */
export const DASHBOARD_GUIDES = [
  { slug: 'setup', title: 'Setting up your studio' },
  { slug: 'running', title: 'Running your studio day to day' },
  { slug: 'activities', title: 'Creating an activity' },
  { slug: 'staff', title: 'Managing staff' },
  { slug: 'stripe', title: 'Connecting Stripe' },
];

export const SUPPORT: Page = {
  slug: 'support',
  title: `Support | ${BRAND}`,
  description: `Contact ${BRAND} support by email or phone, find answers to common questions, and see who to ask about a booking.`,
  h1: 'How can we help?',
  intro:
    'Real people, not a ticket queue. Tell us what is going on and we will sort it out with you.',
  sections: [],
  faqs: [
    {
      q: 'I forgot my password.',
      a: 'Choose "Forgot your password?" on the sign-in screen and enter your email. We send a reset link that works once and expires within the hour.',
    },
    {
      q: 'How do I change or cancel my plan?',
      a: 'From Billing in your dashboard. You can move to another plan whenever you like. A cancellation takes effect at the end of the period you have paid for, and you are not charged again.',
    },
    {
      q: 'When do I get paid for bookings?',
      a: `Customers pay into your own Stripe account, and Stripe pays out to your bank on its usual schedule. ${BRAND} never holds your money and takes no commission. Connect Stripe under Settings, then Payments.`,
    },
    {
      q: 'A customer wants to cancel or get a refund.',
      a: 'Customers can cancel or move a booking themselves from the link in their confirmation, under the cancellation terms you set, and any refund follows those terms automatically.',
    },
    {
      q: 'Can I take my data with me?',
      a: 'Yes. You can export your bookings as a spreadsheet (CSV) from Bookings at any time.',
    },
    {
      q: 'I booked with a business and need to change it.',
      a: `Use the link in your booking confirmation email to move or cancel it. Each business sets its own cancellation and refund terms, so for anything else, contact the business directly: ${BRAND} cannot change a business's bookings.`,
    },
  ],
};

/** How to reach us, in the order people prefer them. */
export const CONTACT = {
  email: LEGAL.supportEmail,
  phone: LEGAL.supportPhone,
  /** Digits only, for the tel: link. */
  phoneHref: `tel:${LEGAL.supportPhone.replace(/[^+\d]/g, '')}`,
  hours: SUPPORT_HOURS,
  timeZone: 'Pacific Time',
  address: `${LEGAL.entity}, ${LEGAL.address}`,
};
