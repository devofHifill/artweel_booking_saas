import { useId, useState } from 'react';
import { money, type MrrHistory, type MrrPoint } from './types';

/**
 * MRR over time, and the movements that produced it.
 *
 * The chart draws what has been recorded and nothing else. There is no line
 * before the first snapshot, because MRR history was never kept and cannot be
 * reconstructed — `organizations.plan` holds one value with no transition log,
 * and the Stripe webhook trail misses every comped or admin-set plan. So a new
 * deployment sees an empty panel that fills in daily rather than a year of
 * plausible-looking curve.
 *
 * Contraction is a series here even though the reference design had only four.
 * Without it a downgrade vanishes: it is neither new, nor expansion, nor churn,
 * so the movements would silently fail to reconcile with the MRR line above
 * them.
 */

type SeriesKey =
  | 'mrrCents'
  | 'newCents'
  | 'expansionCents'
  | 'contractionCents'
  | 'churnedCents';

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'mrrCents', label: 'MRR', color: 'var(--clay)' },
  { key: 'newCents', label: 'New MRR', color: 'var(--ok)' },
  { key: 'expansionCents', label: 'Expansion', color: 'var(--clay-text)' },
  { key: 'contractionCents', label: 'Contraction', color: 'var(--warn)' },
  { key: 'churnedCents', label: 'Churned MRR', color: 'var(--danger)' },
];

export default function MrrPanel({
  history,
  currentMrrCents,
}: {
  history: MrrHistory | null;
  currentMrrCents: number;
}) {
  const [active, setActive] = useState<SeriesKey[]>(['mrrCents']);

  function toggle(key: SeriesKey) {
    setActive((prev) =>
      prev.includes(key)
        ? // Never leave the chart with nothing plotted — an empty axis reads
          // as broken rather than as a deliberate choice.
          prev.length === 1
          ? prev
          : prev.filter((k) => k !== key)
        : [...prev, key],
    );
  }

  const points = history?.points ?? [];

  return (
    <div className="card mrr-panel">
      <div className="mrr-head">
        <div>
          <h2>Monthly Recurring Revenue</h2>
          <p className="sub">
            {points.length > 0
              ? `${points.length} day${points.length === 1 ? '' : 's'} recorded · ${money(currentMrrCents)} current MRR`
              : `${money(currentMrrCents)} current MRR`}
          </p>
        </div>

        <div className="mrr-series" role="group" aria-label="Series">
          {SERIES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={active.includes(s.key) ? 'is-active' : ''}
              style={
                active.includes(s.key)
                  ? { borderColor: s.color, color: s.color }
                  : undefined
              }
              aria-pressed={active.includes(s.key)}
              onClick={() => toggle(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <Empty />
      ) : points.length === 1 ? (
        <OneDay point={points[0]!} />
      ) : (
        <Chart points={points} active={active} />
      )}
    </div>
  );
}

/**
 * The honest empty state.
 *
 * Says why there is nothing rather than drawing an empty grid, and says when
 * that changes — an operator who opens this on deploy day should not have to
 * wonder whether it is broken.
 */
function Empty() {
  return (
    <div className="mrr-empty">
      <p>
        <strong>No history recorded yet.</strong>
      </p>
      <p className="sub">
        MRR is written down once an hour from today onward. It was never stored
        before now and cannot be backfilled, so this chart starts at the first
        snapshot and grows a point a day. If it stays empty past the hour, check
        the <strong>mrrSnapshot</strong> worker on the health panel.
      </p>
    </div>
  );
}

/** One point is not a trend. Say the number instead of drawing a dot. */
function OneDay({ point }: { point: MrrPoint }) {
  return (
    <div className="mrr-empty">
      <p>
        <strong>{money(point.mrrCents)}</strong> on {point.date}
      </p>
      <p className="sub">
        The first snapshot. A second day of history turns this into a line.
      </p>
    </div>
  );
}

function Chart({
  points,
  active,
}: {
  points: MrrPoint[];
  active: SeriesKey[];
}) {
  const clipId = useId();

  const width = 640;
  const height = 240;
  const padL = 62;
  const padR = 12;
  const padT = 12;
  const padB = 28;

  const shown = SERIES.filter((s) => active.includes(s.key));

  /* The domain always includes zero: the movement series live around it, and a
     churn line that never touches the axis it is measured from is unreadable. */
  const values = shown.flatMap((s) => points.map((p) => p[s.key]));
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  /* A flat all-zero series would divide by zero; give it a nominal span so the
     line renders along the axis instead of vanishing. */
  const span = rawMax - rawMin || 100;
  const max = rawMax + span * 0.08;
  const min = rawMin - span * 0.08;

  const x = (i: number) =>
    padL + (i * (width - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v: number) =>
    padT + ((max - v) / (max - min)) * (height - padT - padB);

  const ticks = niceTicks(min, max, 4);

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mrr-chart"
        role="img"
        aria-label={`${shown.map((s) => s.label).join(', ')} over ${points.length} days`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={padL}
              y={padT}
              width={width - padL - padR}
              height={height - padT - padB}
            />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth="1"
              /* The zero line is the one the negative series are read against,
                 so it is drawn solid while the rest stay dashed. */
              strokeDasharray={t === 0 ? undefined : '3 4'}
            />
            <text
              x={padL - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              className="mrr-axis-label"
            >
              {money(t)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {shown.map((s) => (
            <path
              key={s.key}
              d={points
                .map(
                  (p, i) =>
                    `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`,
                )
                .join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Dots stop being dots once they touch, so they go once the series
              is denser than the box can separate. */}
          {points.length <= 31 &&
            shown.map((s) =>
              points.map((p, i) => (
                <circle
                  key={`${s.key}-${p.date}`}
                  cx={x(i).toFixed(1)}
                  cy={y(p[s.key]).toFixed(1)}
                  r="2.4"
                  fill="var(--card)"
                  stroke={s.color}
                  strokeWidth="1.6"
                >
                  <title>{`${p.date} · ${s.label}: ${money(p[s.key])}`}</title>
                </circle>
              )),
            )}
        </g>
      </svg>

      <div className="mrr-axis-x">
        <span>{points[0]!.date}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </>
  );
}

/** Round gridline values, so the axis reads $200 rather than $187.43. */
function niceTicks(min: number, max: number, count: number): number[] {
  const rough = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(rough) || 1));
  const step = Math.ceil(rough / mag) * mag || 1;

  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    out.push(Math.round(v));
  }
  // Zero is the reference for every movement series; never let rounding drop it.
  if (!out.includes(0) && min <= 0 && max >= 0) out.push(0);
  return out;
}
