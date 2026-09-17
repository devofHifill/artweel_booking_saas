import { useId } from 'react';
import type { BookingVolume, PlatformGrowth } from './types';

/**
 * Studio growth and booking volume — the two genuinely historical charts.
 *
 * Unlike MRR, most of this needed no snapshot to exist: a studio's signup and a
 * booking's creation are dated on the row, so these series reach back as far as
 * the data does.
 *
 * The exception is churn, and it is drawn as an exception. Nothing records when
 * a studio stopped paying, so churn is derived from the daily MRR snapshot and
 * exists only for months that snapshot covers. Those months carry a number;
 * every earlier month is a hole in the line rather than a zero, because a zero
 * would assert that nobody left during a month nobody was counting.
 */

const SERIES = [
  { key: 'newStudios' as const, label: 'New studios', color: 'var(--clay)' },
  { key: 'activated' as const, label: 'Activated', color: 'var(--ok)' },
  { key: 'churned' as const, label: 'Churned', color: 'var(--warn)' },
];

/** "2026-09" -> "Sep '26" */
function shortMonth(key: string): string {
  const [y, m] = key.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return `${date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${y!.slice(2)}`;
}

export function GrowthPanel({ growth }: { growth: PlatformGrowth | null }) {
  const clipId = useId();
  const months = growth?.months ?? [];

  const width = 640;
  const height = 240;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 26;

  const values = months.flatMap((m) => [
    m.newStudios,
    m.activated,
    m.churned ?? 0,
  ]);
  const max = Math.max(1, ...values) * 1.12;

  const x = (i: number) =>
    padL + (i * (width - padL - padR)) / Math.max(1, months.length - 1);
  const y = (v: number) => padT + ((max - v) / max) * (height - padT - padB);

  const step = Math.max(1, Math.ceil(max / 5));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);

  return (
    <div className="card growth-panel">
      <div className="growth-head">
        <h2>Studio Growth</h2>
        <p className="sub">
          New, activated and churned studios per month. Activated means finished
          setup.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="sub growth-empty">No months to show yet.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="growth-chart"
            role="img"
            aria-label="New, activated and churned studios per month"
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
                  strokeDasharray={t === 0 ? undefined : '3 4'}
                />
                <text
                  x={padL - 7}
                  y={y(t) + 3.5}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {t}
                </text>
              </g>
            ))}

            <g clipPath={`url(#${clipId})`}>
              {SERIES.map((s) => {
                /*
                  Split into runs of consecutive measured months, so an
                  unmeasured churn month leaves a gap instead of the line
                  diving to zero and back — which would read as a real month
                  with no departures.
                */
                const runs: { i: number; v: number }[][] = [];
                let run: { i: number; v: number }[] = [];
                months.forEach((m, i) => {
                  const v = m[s.key];
                  if (v === null) {
                    if (run.length) runs.push(run);
                    run = [];
                  } else {
                    run.push({ i, v });
                  }
                });
                if (run.length) runs.push(run);

                return runs.map((points, ri) => (
                  <path
                    key={`${s.key}-${ri}`}
                    d={points
                      .map(
                        (p, k) =>
                          `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`,
                      )
                      .join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ));
              })}

              {SERIES.map((s) =>
                months.map((m, i) =>
                  m[s.key] === null ? null : (
                    <circle
                      key={`${s.key}-${m.month}`}
                      cx={x(i).toFixed(1)}
                      cy={y(m[s.key]!).toFixed(1)}
                      r="2.4"
                      fill="var(--card)"
                      stroke={s.color}
                      strokeWidth="1.6"
                    >
                      <title>{`${shortMonth(m.month)} · ${s.label}: ${m[s.key]}`}</title>
                    </circle>
                  ),
                ),
              )}
            </g>
          </svg>

          <div className="chart-axis-x" style={{ paddingLeft: padL }}>
            <span>{shortMonth(months[0]!.month)}</span>
            <span>{shortMonth(months[months.length - 1]!.month)}</span>
          </div>

          <ul className="growth-legend">
            {SERIES.map((s) => (
              <li key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>

          {/* Says where the churn line starts, so a short line reads as a
              young measurement rather than a quiet quarter. */}
          <p className="sub growth-note">
            {growth?.churnMeasuredFrom
              ? `Churn measured from ${shortMonth(growth.churnMeasuredFrom)}, when daily snapshots began. Earlier months were never counted.`
              : 'Churn is not charted yet — it is derived from the daily MRR snapshot, which has no history to compare against so far.'}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Bookings created per month, across every studio.
 *
 * Fully historical: bookings carry their own creation date, so this reaches
 * back as far as the table does with nothing recorded in advance. CANCELLED is
 * excluded to agree with the Bookings card at the top of the page.
 */
export function BookingVolumePanel({
  volume,
}: {
  volume: BookingVolume | null;
}) {
  const months = volume?.months ?? [];
  const max = Math.max(1, ...months.map((m) => m.bookings));

  const step = Math.max(1, Math.ceil(max / 5));
  const ticks: number[] = [];
  for (let v = 0; v <= max * 1.1; v += step) ticks.push(v);

  return (
    <div className="card volume-panel">
      <div className="growth-head volume-head">
        <div>
          <h2>Booking Volume</h2>
          <p className="sub">Bookings created per month across all studios</p>
        </div>
        <span className="volume-badge">
          {(volume?.thisMonth ?? 0).toLocaleString('en-US')} this month
        </span>
      </div>

      {months.length === 0 ? (
        <p className="sub growth-empty">No months to show yet.</p>
      ) : (
        <>
          <div className="volume-plot">
            <div className="volume-ticks">
              {[...ticks].reverse().map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="volume-bars">
              {months.map((m) => (
                <div className="volume-bar" key={m.month}>
                  <div
                    className="volume-bar-fill"
                    style={{ height: `${(m.bookings / (max * 1.1)) * 100}%` }}
                    title={`${shortMonth(m.month)}: ${m.bookings} bookings`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="chart-axis-x volume-axis">
            <span>{shortMonth(months[0]!.month)}</span>
            <span>{shortMonth(months[months.length - 1]!.month)}</span>
          </div>
        </>
      )}
    </div>
  );
}
