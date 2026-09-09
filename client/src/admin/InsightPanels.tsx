import { Link } from 'react-router-dom';
import { money, type Insights } from './types';
import { Icon, type IconName } from '../components/Icon';

/**
 * The lower half of the platform dashboard.
 *
 * Every figure here is computed from rows that exist. Where the reference
 * design wanted something the system does not record, the panel either says so
 * on screen (geography is derived from timezone; the activity feed does not
 * cover studio-side actions) or reports the gap in place of a number (LTV and
 * net revenue retention).
 */

const SEGMENT_COLORS: Record<string, string> = {
  STUDIO: 'var(--clay)',
  SOLO: '#3b6fb8',
  PRO: '#8a7b62',
  TRIAL: 'var(--ok)',
  INACTIVE: 'var(--muted)',
};

const colorFor = (key: string, i: number) =>
  SEGMENT_COLORS[key] ??
  ['var(--clay)', '#3b6fb8', '#8a7b62', 'var(--ok)', 'var(--warn)'][i % 5]!;

/** Studios by plan, drawn as a ring, with what each plan actually pays. */
export function PlanDistributionPanel({
  plans,
}: {
  plans: Insights['plans'] | null;
}) {
  if (!plans) return null;

  const segments = plans.segments;
  const total = segments.reduce((n, s) => n + s.studios, 0);

  /* Ring geometry via stroke-dasharray on a circle: no arc maths, and it
     degrades to a clean full ring when one segment is everything. */
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="card insight-panel">
      <div className="insight-head">
        <h2>Plan Distribution</h2>
        <p className="sub">
          {plans.total} studio{plans.total === 1 ? '' : 's'}
        </p>
      </div>

      {total === 0 ? (
        <p className="sub insight-empty">No studios yet.</p>
      ) : (
        <>
          <svg viewBox="0 0 160 160" className="donut" role="img" aria-label="Studios by plan">
            <g transform="rotate(-90 80 80)">
              {segments.map((s, i) => {
                const share = s.studios / total;
                const dash = share * circumference;
                const el = (
                  <circle
                    key={s.key}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={colorFor(s.key, i)}
                    strokeWidth="20"
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${s.label}: ${s.studios}`}</title>
                  </circle>
                );
                offset += dash;
                return el;
              })}
            </g>
          </svg>

          <ul className="donut-legend">
            {segments.map((s, i) => (
              <li key={s.key}>
                <i style={{ background: colorFor(s.key, i) }} />
                <span className="donut-label">{s.label}</span>
                <span className="donut-value">
                  <strong>{s.studios}</strong>
                  <span className={s.mrrCents === 0 ? 'muted' : undefined}>
                    {money(s.mrrCents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Studios by country, inferred from each studio's timezone. */
export function GeographyPanel({
  geography,
}: {
  geography: Insights['geography'] | null;
}) {
  if (!geography) return null;

  const rows = geography.rows;
  const max = Math.max(1, ...rows.map((r) => r.studios));

  return (
    <div className="card insight-panel">
      <div className="insight-head">
        <h2>Geographic Distribution</h2>
        <p className="sub">Studios by country · 30 days GMV</p>
      </div>

      {rows.length === 0 ? (
        <p className="sub insight-empty">No studios yet.</p>
      ) : (
        <ul className="geo-list">
          {rows.map((r) => (
            <li key={r.country}>
              <span className="geo-country">{r.country}</span>
              <span className="geo-bar">
                <span
                  className="geo-bar-fill"
                  style={{ width: `${(r.studios / max) * 100}%` }}
                />
              </span>
              <span className="geo-count">
                <strong>{r.studios}</strong>
                <span className="muted">{money(r.gmvCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Two notes, both load-bearing. The first is the money distinction the
        whole product rests on; the second stops an inferred country being read
        as one a studio declared.
      */}
      <p className="insight-note">
        GMV is processed directly on each studio&rsquo;s connected Stripe
        account. Artweel does not hold or route customer funds.
      </p>
      <p className="insight-note subtle">
        Country is derived from each studio&rsquo;s timezone — studios never
        state one. Unmapped zones are grouped as Other.
      </p>
    </div>
  );
}

const ATTENTION_ICONS: Record<string, IconName> = {
  'staff-limit': 'staff',
  stripe: 'money',
  webhooks: 'plug',
  'past-due': 'plan',
  'calendar-reauth': 'calendar',
  cancellations: 'refund',
};

/** What needs a human, each row opening the list behind it. */
export function NeedsAttentionPanel({
  attention,
}: {
  attention: Insights['attention'] | null;
}) {
  if (!attention) return null;
  const items = attention.items;

  return (
    <div className="card insight-panel">
      <div className="insight-head attention-head">
        <div>
          <h2>Needs Attention</h2>
          <p className="sub">
            {items.length} item{items.length === 1 ? '' : 's'}
          </p>
        </div>
        {items.length > 0 && (
          <span className="attention-badge">Action required</span>
        )}
      </div>

      {items.length === 0 ? (
        /* A real state, and the one this panel should usually be in. */
        <p className="sub insight-empty">
          Nothing needs attention. Every check came back clear.
        </p>
      ) : (
        <ul className="attention-list">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.href}>
                <span className="attention-icon">
                  <Icon name={ATTENTION_ICONS[item.key] ?? 'bell'} size={16} />
                </span>
                <span className="attention-text">
                  <strong>{item.title}</strong>
                  <span className="sub">{item.detail}</span>
                </span>
                <Icon name="chevron" size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What actually happened, from the trails that record it. */
export function ActivityPanel({
  activity,
}: {
  activity: Insights['activity'] | null;
}) {
  if (!activity) return null;

  return (
    <div className="card insight-panel">
      <div className="insight-head attention-head">
        <div>
          <h2>Recent Platform Activity</h2>
          <p className="sub">Events across all studios</p>
        </div>
        <Link to="/admin/audit" className="ov-btn">
          Open audit log
        </Link>
      </div>

      {activity.entries.length === 0 ? (
        <p className="sub insight-empty">Nothing recorded yet.</p>
      ) : (
        <ul className="activity-list">
          {activity.entries.map((e) => (
            <li key={e.id}>
              <span className="activity-text">
                <strong>{e.title}</strong>
                <span className="sub">
                  {e.category} · {e.actor} · {timeAgo(e.at)}
                </span>
              </span>
              <span className={`activity-status ${e.status}`}>
                {e.status === 'success'
                  ? 'Success'
                  : e.status === 'failed'
                    ? 'Failed'
                    : 'Review'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Says what the feed does not cover, so its thinness is not mistaken
          for a quiet week. */}
      <p className="insight-note subtle">{activity.note}</p>
    </div>
  );
}

/** How the business earns — including the two figures it cannot yet state. */
export function RevenueModelPanel({
  revenue,
}: {
  revenue: Insights['revenueModel'] | null;
}) {
  if (!revenue) return null;

  return (
    <div className="card insight-panel">
      <div className="insight-head">
        <h2>Revenue Model</h2>
        <p className="sub">How Artweel earns</p>
      </div>

      <div className="revenue-callout">
        <strong>{revenue.platformCommissionPct}% platform commission</strong>
        <span className="sub">
          Stripe Connect direct charges settle on the studio&rsquo;s own
          account.
        </span>
      </div>

      <dl className="revenue-rows">
        <Row label="Subscription MRR" value={money(revenue.mrrCents)} />
        <Row
          label="Take rate on GMV"
          value={`${revenue.takeRateOnGmvPct.toFixed(1)}%`}
        />
        <Row
          label="ARPA"
          value={revenue.arpaCents === null ? null : money(revenue.arpaCents)}
          unavailable="No paying studios yet"
        />
        <Row
          label="Estimated LTV"
          value={revenue.ltvCents === null ? null : money(revenue.ltvCents)}
          unavailable={revenue.ltvUnavailableReason}
        />
        <Row
          label="Net revenue retention"
          value={revenue.nrrPct === null ? null : `${revenue.nrrPct}%`}
          unavailable={revenue.nrrUnavailableReason}
        />
      </dl>
    </div>
  );
}

/**
 * One figure, or the reason there isn't one.
 *
 * An em dash with the reason beside it, rather than the row being dropped: a
 * missing row looks like an oversight, while "not measurable yet, because —"
 * is information.
 */
function Row({
  label,
  value,
  unavailable,
}: {
  label: string;
  value: string | null;
  unavailable?: string;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span className="revenue-missing" title={unavailable}>
            — <span className="sub">{unavailable}</span>
          </span>
        ) : (
          value
        )}
      </dd>
    </>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
