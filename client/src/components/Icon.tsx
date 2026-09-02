/**
 * The icon set.
 *
 * Inline SVG rather than a font or a package: nineteen glyphs do not justify a
 * dependency, an icon font is a well-known accessibility problem (it renders as
 * a random letter when the font fails), and inlining means they inherit
 * `currentColor` and animate with everything else.
 *
 * All 24×24 on the same grid, stroked not filled, at a single weight. Mixing
 * stroke and fill icons — or two stroke weights — is the most common way an
 * icon set reads as assembled from three different libraries, because it
 * usually was.
 *
 * Decorative by default: an icon beside a text label is `aria-hidden`, because
 * a screen reader announcing "calendar, Calendar" is noise. Pass a `title` only
 * when the icon is the ONLY thing carrying the meaning.
 */

export type IconName =
  | 'today' | 'calendar' | 'bookings' | 'classes' | 'courses' | 'register'
  | 'studio' | 'customers' | 'packs' | 'plan'
  | 'overview' | 'studios' | 'health' | 'audit'
  | 'menu' | 'close' | 'search' | 'chevron' | 'external' | 'sun' | 'moon'
  | 'eye' | 'eye-off' | 'signin' | 'settings' | 'bell' | 'staff' | 'plug' | 'site'
  | 'money' | 'refund' | 'download' | 'plus';

const PATHS: Record<IconName, string> = {
  today: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  bookings: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  classes: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  courses: 'M12 3 2 8l10 5 10-5-10-5ZM2 16l10 5 10-5M2 12l10 5 10-5',
  register: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  // A kiln: a chamber with heat rising from it.
  studio: 'M4 21V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11M4 21h16M9 8V6a3 3 0 0 1 6 0v2M12 12v5',
  customers: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  packs: 'M3 9h18M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M9 13h6',
  plan: 'M2 9h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7ZM6 15h4',
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  studios: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 11h.01M15 11h.01',
  health: 'M22 12h-4l-3 9L9 3l-3 9H2',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  chevron: 'M9 18l6-6-6-6',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.9M6.6 7.5A17.4 17.4 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18',
  // An arrow moving INTO a doorway: the door is the account, the arrow is you.
  signin: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  /* Sliders rather than the usual cog: at 24px on a 1.6 stroke a cog's teeth
     collapse into a grey ring, which is why every icon set that keeps one draws
     it heavier than its neighbours. Three rules on the same grid do not. */
  settings:
    'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M16 4v4M8 10v4M14 16v4',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  /*
     A staff badge, not another group of people.

     The obvious choice — two figures — is what `customers` already is, and the
     two sit four rows apart in the same sidebar. At 18px the difference between
     "two people" and "two people, one behind" is not a difference anybody sees;
     they read as the same icon used twice, which makes the whole set look
     careless. A lanyard badge says "staff" and cannot be confused with a crowd.
  */
  staff: 'M9 3h6M12 3v3M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8.5 18a3.5 3.5 0 0 1 7 0',
  /* A plug with its two pins, mid-connection. */
  plug: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5',
  /* A browser window with a "handle" bar — the way an owner recognises the
     tab their storefront lives in. The row of small marks is a nod to the
     traffic-light window controls without drawing them literally, which at
     18px would blur into three dots on any theme. */
  site: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM2 9h20M6 6.5h.01M9 6.5h.01M12 6.5h.01',
  /*
     Money, and money coming back.

     The payments screen is the first place three amounts sit in a row, and
     `plan`'s card was going to be the icon on all three — which is the same as
     having no icons at all.

     Two coins rather than a currency mark. A dollar sign is the obvious glyph
     and the wrong one here: studios bill in their own currency, and a `$` on a
     figure denominated in pounds is a small lie told by the interface. Coins
     mean money in every currency there is. The returning arrow is the pair's
     opposite and reads as one at 16px.
  */
  money: 'M9.5 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11M14.5 20.5a5.5 5.5 0 0 0 0-11',
  refund: 'M3 9h13a5 5 0 0 1 0 10h-2M3 9l4-4M3 9l4 4',
  /* A tray with an arrow coming down into it. The arrow alone reads as
     "scroll down" at this size; the tray is what makes it a download. */
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  plus: 'M12 5v14M5 12h14',
};

export function Icon({
  name,
  size = 18,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  /** Supply ONLY when the icon carries meaning no adjacent text carries. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={['icon', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
> 
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
