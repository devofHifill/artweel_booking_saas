/**
 * The user guides, shipped with the dashboard.
 *
 * They were Markdown files in docs/, read by nobody who uses the product, and
 * the Help page said there was no documentation. They live here now so they
 * ship with the code they describe: a change to a screen and the change to its
 * guide go out in the same build, and cannot drift apart unnoticed for long.
 */

export type Guide = {
  /** The URL segment: /help/guides/<slug>. */
  slug: string;
  title: string;
  /** One line for the list on Help & Support. */
  summary: string;
  /**
   * Who it is for. Both guides describe owner and admin work — every screen in
   * them refuses an instructor — so showing them to an instructor would be a
   * manual for buttons they do not have.
   */
  audience: 'admin' | 'everyone';
  /** The screen it explains, for the "How this works" link on that screen. */
  screen: string;
  /**
   * The text, fetched when a guide is opened. Loaded on demand rather than
   * imported, so the dashboard every page loads does not carry every guide.
   */
  load: () => Promise<string>;
};

export const GUIDES: Guide[] = [
  {
    slug: 'activities',
    title: 'Creating an activity',
    summary:
      'Set up your studio, create something customers can book, publish, and put the booking widget on your website.',
    audience: 'admin',
    screen: '/classes',
    load: () => import('./activities.md?raw').then((m) => m.default),
  },
  {
    slug: 'staff',
    title: 'Managing staff',
    summary:
      'Add instructors, make them bookable, give them a login, and deactivate or remove them.',
    audience: 'admin',
    screen: '/staff',
    load: () => import('./staff.md?raw').then((m) => m.default),
  },
];

export function findGuide(slug: string | undefined): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Owners and admins see every guide; everybody else the ones for everyone. */
export function guidesFor(role: string | undefined): Guide[] {
  const admin = role === 'OWNER' || role === 'ADMIN';
  return GUIDES.filter((g) => admin || g.audience === 'everyone');
}
