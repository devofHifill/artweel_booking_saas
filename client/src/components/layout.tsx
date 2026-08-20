import type { ReactNode } from 'react';

/**
 * Page-level layout primitives.
 *
 * These are extraction, not invention. `.page-head`, `.toolbar`, `.stats`,
 * `table`/`th` and `.tag` all already existed in styles.css — what did not exist
 * was one way to write them, so every page wrote its own. Customers opened with
 * a `<div class="page-head">` wrapping a nested `<div>`; Classes used a
 * `<header>` with the toolbar inside it and no subtitle at all. Both render, and
 * the vertical rhythm differs by a few pixels between them for no reason anybody
 * chose.
 *
 * Loading, empty and skeleton states live in `states.tsx` and are NOT duplicated
 * here.
 */

/**
 * The heading block every page opens with.
 *
 * `actions` is a separate slot rather than something callers append to
 * `children`, because the two behave differently when the screen narrows: the
 * title wraps, the actions drop to their own row and stay on one line.
 */
export function PageHead({
  title,
  lede,
  actions,
}: {
  title: ReactNode;
  /** One line on what this page is for. Optional — most pages need none. */
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="ph-text">
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}

/** Filters and controls that act on the page below them. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function StatGrid({
  children,
  className = 'stats',
}: {
  children: ReactNode;
  /** Today's figure row is not an even grid, so it passes its own class. */
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

/**
 * One figure.
 *
 * The label comes first in the DOM and reads first on screen, which is the
 * opposite of how these are usually built. A number with no label is not
 * information, and a screen reader announcing "6" before "classes today" makes
 * somebody wait for the meaning.
 */
export function Stat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <p className="sub">{hint}</p>}
    </div>
  );
}

/**
 * A table that survives a narrow screen.
 *
 * The wrapper is the whole point. A wide table with no scroll container makes
 * the PAGE scroll sideways, which moves the navigation off screen and is
 * indistinguishable from a broken layout. Scrolling the table alone is a
 * recognised gesture; scrolling the document sideways is a bug report.
 */
export function DataTable({
  head,
  children,
  caption,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Announced to screen readers; visually hidden. */
  caption?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A status pill.
 *
 * The colour comes from the status class already defined in styles.css — there
 * are twenty-nine of them, covering bookings, waitlists, pieces and firings, and
 * this deliberately does not add a thirtieth vocabulary of its own.
 *
 * Colour is never the only carrier: the status is also spelled out in the label.
 */
export function StatusPill({
  status,
  children,
}: {
  /** An UPPER_SNAKE status, matching the `.tag.X` classes. */
  status: string;
  /** Overrides the humanised status when the page has better words for it. */
  children?: ReactNode;
}) {
  return (
    <span className={`tag ${status}`}>{children ?? humanise(status)}</span>
  );
}

/** NO_SHOW → "No show". Shouting at the user is not a design decision. */
function humanise(status: string): string {
  const lower = status.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export type TabItem = { id: string; label: ReactNode; count?: number };

/**
 * Tabs over one page's content.
 *
 * Buttons in a `tablist`, not links. These switch what is shown within a screen
 * and do not deserve their own history entries — a reader who tabbed through
 * four views and pressed Back expects to leave the page, not to walk back
 * through the tabs.
 */
export function Tabs({
  items,
  active,
  onChange,
  label,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** Names the group for screen readers, e.g. "Report sections". */
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === active}
          className={`tab ${item.id === active ? 'on' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && item.count > 0 && (
            <span className="tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A segmented control, for a small set of mutually exclusive choices.
 *
 * Distinct from Tabs, which switch what is displayed. This changes a PARAMETER
 * of what is displayed — a date range, a theme — and the two look similar enough
 * that using one for the other's job teaches people the wrong thing about both.
 *
 * The styles arrived with the Appearance screen, which was the first place a
 * three-way choice needed to sit beside its label.
 */
export function SegRange<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          className={option.value === value ? 'on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
