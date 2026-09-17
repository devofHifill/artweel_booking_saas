import { useId } from 'react';

/**
 * Charts, drawn by hand.
 *
 * No charting library, and the reason is the same one the prototype gives: the
 * whole of this file is a path, some rectangles and a few labels, and the
 * smallest credible library is around 90KB to draw them. It also keeps the
 * charts inside the token system — a library brings its own palette and its own
 * idea of dark mode, and reconciling those is more work than the drawing.
 *
 * Two shapes, and the split is deliberate. A **series over time** gets a line:
 * the reader is following a shape, and ninety bars is a texture rather than a
 * chart. A **small set of named things** gets bars, because the comparison is
 * between them rather than along anything.
 */

/** One bar. `caption` is what a screen reader and the tooltip both get. */
export type Bar = {
  key: string;
  value: number;
  /** Under the bar. Omitted when there are too many to read. */
  label?: string;
  caption: string;
  /** Today, or the row being highlighted. */
  highlight?: boolean;
};

/**
 * Bars in CSS.
 *
 * Extracted in D8 from the two copies that had grown — the dashboard's week
 * chart and the reports tab — which were identical apart from the text in the
 * tooltip. The value is the bar's accessible NAME rather than a title alone, so
 * a screen reader gets "Tuesday, $240" instead of a wall of unlabelled divs.
 */
export function BarSeries({ bars, dense = false }: { bars: Bar[]; dense?: boolean }) {
  const max = Math.max(1, ...bars.map((b) => b.value));

  /*
    The column count comes from the DATA, not from the stylesheet.

    `.chart-bars` was written for the dashboard's week and hard-codes
    `repeat(7, 1fr)`; the dense variant for 90 days overrides it. Anything in
    between — a thirty-day series, say — quietly wrapped into five rows of
    seven, which is not a chart. Setting it here means no caller has to know
    that, and the rule stays for anyone still using the class directly.
  */
  return (
    <div
      className={`chart-bars ${dense ? 'dense' : ''}`.trim()}
      style={dense ? undefined : { gridTemplateColumns: `repeat(${bars.length}, 1fr)` }}
    >
      {bars.map((bar) => (
        <div className="chart-col" key={bar.key}>
          <div
            className={`chart-bar ${bar.highlight ? 'today' : ''}`.trim()}
            /* A floor of 3%, so a day with nothing still draws a mark. An
               invisible bar reads as missing data rather than as a zero. */
            style={{ height: `${Math.max(3, Math.round((bar.value / max) * 100))}%` }}
            title={bar.caption}
            role="img"
            aria-label={bar.caption}
          />
          {!dense && bar.label && <span className="chart-label">{bar.label}</span>}
        </div>
      ))}
    </div>
  );
}

export type TrendPoint = {
  key: string;
  value: number;
  /** What this point is called when read aloud, e.g. "Tue 12 Aug: $240". */
  caption: string;
  /** Shown under the axis at the two ends only. */
  short: string;
};

/**
 * A line over time, with the area under it tinted.
 *
 * `preserveAspectRatio="none"` because the viewBox is stretched to whatever
 * width the card has: the shape is the information, not the angle. Stroke width
 * is compensated in the other direction by drawing at a fixed viewBox height,
 * which keeps the line an even weight instead of the smear you get from
 * scaling a stroke non-uniformly.
 *
 * Colour comes from the studio's accent token, so it follows the six brand
 * presets and both themes without this file knowing anything about either.
 */
export function TrendChart({
  points,
  label,
}: {
  points: TrendPoint[];
  /** Names the whole chart for a screen reader — it cannot read the line. */
  label: string;
}) {
  /* The gradient needs an id, and an id has to be unique in the document. A
     literal one works right up until a screen renders two of these, at which
     point both charts reference whichever definition happened to render
     first — the kind of bug that only appears on the page nobody tested. */
  const fillId = useId();

  if (points.length === 0) return null;

  /* One point is a line with no direction. Rather than draw a dot in the
     middle of an empty box, say the number. */
  if (points.length === 1) {
    return <p className="single-day">{points[0]!.caption}</p>;
  }

  const width = 620;
  const height = 180;
  const pad = 8;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (width - pad * 2) / (points.length - 1);

  const coords = points.map((point, index) => ({
    x: pad + index * step,
    y: height - pad - (point.value / max) * (height - pad * 2),
    point,
  }));

  const line = coords
    .map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  const area =
    `${line} L${coords[coords.length - 1]!.x.toFixed(1)},${height - pad}` +
    ` L${pad},${height - pad} Z`;

  /* Dots stop being dots once they touch each other. Ninety of them on a
     620-wide box is a dotted line, which reads as a different chart type. */
  const showDots = points.length <= 31;

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="trend"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--clay)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--clay)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${fillId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--clay)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {showDots &&
          coords.map((c) => (
            <circle
              key={c.point.key}
              cx={c.x.toFixed(1)}
              cy={c.y.toFixed(1)}
              r="2.6"
              fill="var(--card)"
              stroke="var(--clay)"
              strokeWidth="1.8"
              vectorEffect="non-scaling-stroke"
            >
              <title>{c.point.caption}</title>
            </circle>
          ))}
      </svg>

      <div className="trend-axis">
        <span>{points[0]!.short}</span>
        <span>{points[points.length - 1]!.short}</span>
      </div>
    </>
  );
}
