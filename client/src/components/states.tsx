import type { ReactNode } from 'react';

/**
 * Loading, empty and error presentation.
 *
 * Every screen in this app previously rendered `<div className="empty">Loading…</div>`
 * — centred grey text on a blank page — and then snapped to a full layout. Two
 * costs to that: the page feels slower than it is, because nothing suggests
 * anything is coming; and the content lands with a jump, because nothing was
 * holding its shape.
 *
 * A skeleton fixes both for almost no code. It is not decoration: it is a
 * promise about what is about to appear, so it must match the real layout's
 * shape. A skeleton that lies about the coming content is worse than a spinner.
 */

/** One shimmering block. `w`/`h` accept any CSS length. */
export function Skeleton({
  w = '100%',
  h = '1em',
  radius,
  style,
}: {
  w?: string;
  h?: string;
  radius?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: radius, ...style }}
    />
  );
}

/**
 * Lines of text at varying widths.
 *
 * Uniform-width lines read as a loading graphic; ragged ones read as text, which
 * is the point — the eye should recognise the shape of a paragraph.
 */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ['100%', '92%', '68%', '84%', '76%'];
  return (
    <span className="skeleton-text">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={widths[i % widths.length]} h=".8em" />
      ))}
    </span>
  );
}

/** A card-shaped placeholder, for list screens built from cards. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card skeleton-card">
      <Skeleton w="42%" h="1.1em" />
      <SkeletonText lines={lines} />
    </div>
  );
}

export function SkeletonList({ count = 4, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/**
 * Matches the `.stats` grid, so tiles do not jump when the numbers arrive.
 *
 * `className` exists for pages whose figure row is not an even auto-fit grid:
 * Today's leads with a wide tile, and a skeleton in the default grid would
 * settle into different columns the moment the data landed.
 */
export function SkeletonStats({
  count = 4,
  className = 'stats',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div className="card stat" key={i}>
          <Skeleton w="55%" h=".7em" />
          <Skeleton w="38%" h="1.5em" style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}

/** Rows in a table's shape, including the header rule. */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} w={c === 0 ? '70%' : '45%'} h=".8em" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Announces loading to a screen reader.
 *
 * The skeletons themselves are `aria-hidden`, because a shimmering rectangle
 * read aloud is noise. Somebody who cannot see the shimmer still needs to know
 * the page is working, which is what this is for.
 */
export function LoadingRegion({ label = 'Loading', children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * An empty state.
 *
 * Presentation only — the message each screen passes is unchanged from what it
 * rendered before. The gain here is hierarchy and breathing room rather than
 * words: an empty result currently reads as a system failure because it looks
 * identical to one.
 */
export function EmptyState({
  children,
  icon = '◍',
  hint,
}: {
  children: ReactNode;
  /** A quiet mark, not an illustration. Decorative, so hidden from readers. */
  icon?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-title">{children}</p>
      {hint && <p className="sub">{hint}</p>}
    </div>
  );
}
