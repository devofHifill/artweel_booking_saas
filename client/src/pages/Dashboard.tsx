import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, dateIn, money, timeIn } from '../lib/api';
import { useAuth, useActiveOrg, useOrgBase } from '../lib/auth';
import { Icon } from '../components/Icon';
import { Kpi, PageHead, PaymentPill, StatusPill } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonList, SkeletonStats } from '../components/states';

/**
 * The landing page.
 *
 * Replaces the old Today screen entirely. Today answered one question — what is
 * happening in the next few hours — which is the right question at 8am and the
 * wrong one every other time somebody opens the product. This answers "how is
 * the studio doing", with the running order as one panel of nine.
 *
 * Today's work is not lost: its session grouping became the schedule panel
 * below, and its three alert banners became the attention card. The panel is
 * strictly better informed than the page was, because the server now reads
 * sessions and can report capacity — grouping bookings never could.
 *
 * Everything arrives in one request. Nine blocks fetching independently is nine
 * spinners resolving out of order on the screen a studio opens first.
 */

type Figures = {
  bookings: number;
  seatsBooked: number;
  seatsLeft: number;
  revenueCents: number;
};

type ScheduleRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  color: string;
  staffName: string | null;
  locationName: string | null;
  booked: number;
  capacity: number;
  revenueCents: number;
  kind: 'class' | 'appointment';
};

type RecentBooking = {
  id: string;
  startsAt: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  seats: number;
  totalCents: number;
  status: string;
  paymentStatus: 'PAID' | 'PART_PAID' | 'UNPAID';
};

type DashboardData = {
  studio: { name: string; currency: string; timezone: string };
  figures: {
    today: Figures;
    yesterday: Figures;
    upcomingSessions: number;
    outstandingCents: number;
  };
  schedule: ScheduleRow[];
  recent: RecentBooking[];
  revenue: { date: string; cents: number }[];
  popular: {
    serviceTypeId: string;
    name: string;
    color: string;
    bookings: number;
    seats: number;
    revenueCents: number;
  }[];
  sources: { source: string; bookings: number }[];
  attention: {
    id: string;
    count: number;
    label: string;
    labelOne: string;
    href: string;
  }[];
  instructors: { name: string; classes: number; seats: number }[];
  sourcesCaveat: string | null;
};

/**
 * Greeting, on the studio's clock.
 *
 * `new Date().getHours()` reads the VIEWER's timezone, which is wrong for the
 * same reason every figure on this page is computed in the studio's: an owner
 * checking their New York studio from a hotel in Singapore should be told good
 * morning when it is morning at the studio, not when it is morning around them.
 */
function greeting(timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    }).format(new Date()),
  );

  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const { user } = useAuth();

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<DashboardData>(`${base}/dashboard`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [base]);

  if (error) return <div className="err">{error}</div>;

  if (!data) {
    return (
      <LoadingRegion label="Loading your dashboard">
        <SkeletonStats count={5} />
        <SkeletonList count={3} lines={2} />
      </LoadingRegion>
    );
  }

  const { figures, studio } = data;
  const currency = studio.currency;
  // First name only: "Good morning, Alex Rivera" reads like a form letter.
  const firstName = user?.name?.split(' ')[0];

  return (
    <>
      <PageHead
        title={
          firstName
            ? `${greeting(studio.timezone)}, ${firstName}`
            : greeting(studio.timezone)
        }
        lede={`Here's what's happening at ${studio.name} today.`}
        actions={
          <>
            <Link className="button-link" to="/register">
              <Icon name="register" size={16} />
              Daily manifest
            </Link>
            <Link className="button-link primary" to="/bookings">
              <Icon name="bookings" size={16} />
              New booking
            </Link>
          </>
        }
      />

      <div className="kpis">
        <Kpi
          label="Today's bookings"
          value={String(figures.today.bookings)}
          icon="bookings"
          foot={<Trend now={figures.today.bookings} before={figures.yesterday.bookings} />}
        />
        <Kpi
          label="Today's revenue"
          value={money(figures.today.revenueCents, currency)}
          tone="green"
          icon="plan"
          foot={
            <Trend now={figures.today.revenueCents} before={figures.yesterday.revenueCents} />
          }
        />
        <Kpi
          label="Classes this week"
          value={String(figures.upcomingSessions)}
          tone="violet"
          icon="calendar"
          foot={<span className="muted">next 7 days</span>}
        />
        <Kpi
          label="Seats left today"
          value={String(figures.today.seatsLeft)}
          tone="amber"
          icon="customers"
          foot={<span className="muted">across today's classes</span>}
        />
        <Kpi
          label="Money owed"
          value={money(figures.outstandingCents, currency)}
          tone="red"
          icon="plan"
          foot={<span className="muted">upcoming bookings</span>}
        />
      </div>

      <div className="dash-split">
        <Panel
          title="Today's schedule"
          sub={new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: studio.timezone,
          }).format(new Date())}
          action={<Link to="/calendar">Open calendar</Link>}
        >
          {data.schedule.length === 0 ? (
            <EmptyState icon="◷" hint="Add a class from the calendar to start taking bookings.">
              Nothing scheduled today.
            </EmptyState>
          ) : (
            <div className="sched-list">
              {data.schedule.map((row) => (
                <ScheduleItem
                  key={row.id}
                  row={row}
                  currency={currency}
                  timezone={studio.timezone}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Revenue this week"
          action={
            <span className="muted">
              {money(
                data.revenue.reduce((sum, d) => sum + d.cents, 0),
                currency,
              )}{' '}
              total
            </span>
          }
        >
          <WeekChart days={data.revenue} currency={currency} />
        </Panel>
      </div>

      <div className="dash-split">
        <Panel title="Recent bookings" action={<Link to="/bookings">View all</Link>}>
          {data.recent.length === 0 ? (
            <EmptyState>No bookings yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Class</th>
                    <th>When</th>
                    <th>Guests</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((booking) => (
                    <tr key={booking.id}>
                      <td>
                        <Link to={`/customers/${booking.customerId}`}>
                          {booking.customerName}
                        </Link>
                      </td>
                      <td>{booking.serviceName}</td>
                      <td className="nowrap">
                        {dateIn(booking.startsAt, studio.timezone)}
                      </td>
                      <td>{booking.seats}</td>
                      <td>{money(booking.totalCents, currency)}</td>
                      <td>
                        <PaymentPill state={booking.paymentStatus} />
                      </td>
                      <td>
                        <StatusPill status={booking.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* "Activities", not "classes" — the sidebar item these rank is called
            Activities, per the 2026-08-20 decision that TourFlow's label wins
            there. A panel naming the same thing differently reads as two
            features. */}
        <Panel title="Popular activities" action={<span className="muted">last 30 days</span>}>
          {data.popular.length === 0 ? (
            /* Ranked on classes that have RUN, so a studio with a full diary and
               nothing taught yet belongs here — and should be told that, rather
               than "nothing booked", which would be false. */
            <EmptyState hint="Classes count once they have run.">
              No classes in the last 30 days.
            </EmptyState>
          ) : (
            <Ranked rows={data.popular} currency={currency} />
          )}
        </Panel>
      </div>

      <div className="dash-thirds">
        <Panel title="Needs attention">
          <Attention items={data.attention} outstanding={figures.outstandingCents} currency={currency} />
        </Panel>

        <Panel title="Teaching today">
          {data.instructors.length === 0 ? (
            <p className="sub">Nobody assigned today.</p>
          ) : (
            <div className="mini-list">
              {data.instructors.map((person) => (
                <div className="mini-row" key={person.name}>
                  <span className="avatar">{initials(person.name)}</span>
                  <span className="mini-main">
                    <b>{person.name}</b>
                    <span className="tiny muted">
                      {person.classes} {person.classes === 1 ? 'class' : 'classes'}
                    </span>
                  </span>
                  <span className="mini-end">
                    <b>{person.seats}</b>
                    <span className="tiny muted">people</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Where bookings come from"
          action={<span className="muted">last 30 days</span>}
        >
          <Sources rows={data.sources} caveat={data.sourcesCaveat} />
        </Panel>
      </div>

      {org && (
        <p className="sub dash-foot">
          Your booking page:{' '}
          <a href={`/public/${org.organization.slug}`} target="_blank" rel="noopener noreferrer">
            /public/{org.organization.slug}
          </a>
        </p>
      )}
    </>
  );
}

// --- pieces ---------------------------------------------------------------

function Panel({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {action && <div className="panel-action">{action}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/**
 * Change against yesterday.
 *
 * Yesterday's zero is reported as "no comparison" rather than as a percentage.
 * Every studio's first day, and every Monday after a closed Sunday, would
 * otherwise show an infinite rise — a number that is technically derived from
 * the data and tells the owner nothing.
 */
function Trend({ now, before }: { now: number; before: number }) {
  if (before === 0) {
    return <span className="muted">{now > 0 ? 'none yesterday' : 'nothing yet'}</span>;
  }

  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="muted">level with yesterday</span>;

  return (
    <>
      <span className={`trend ${pct > 0 ? 'up' : 'down'}`}>
        {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
      </span>
      <span className="muted">vs yesterday</span>
    </>
  );
}

function ScheduleItem({
  row,
  currency,
  timezone,
}: {
  row: ScheduleRow;
  currency: string;
  timezone: string;
}) {
  const pct = row.capacity > 0 ? Math.round((row.booked / row.capacity) * 100) : 0;
  // Full is good news, not a warning — so the scale runs quiet → busy → full.
  const tone = pct >= 100 ? 'full' : pct >= 60 ? 'busy' : 'quiet';

  /* The studio's clock. A class at 11am in New York must not read as 8:54pm
     because the person looking at it is in another timezone. */
  const time = timeIn(row.startsAt, timezone);

  /* Split so the meridiem can sit under the hour — see `.sched-time .mer`.
     Locales that do not use one (24-hour clocks) simply yield no second part
     and the row renders a single line, which is correct rather than a gap. */
  const [clock, meridiem] = time.split(' ');

  return (
    <div className="sched-row">
      <div className="sched-time">
        {clock}
        {meridiem && <span className="mer">{meridiem}</span>}
      </div>
      <div className="sched-bar" style={{ background: row.color }} aria-hidden="true" />
      <div className="sched-main">
        <div className="sched-name">
          {row.serviceName}
          {row.kind === 'appointment' && <span className="tag">1:1</span>}
        </div>
        <div className="sched-meta">
          {row.staffName ?? 'No instructor'}
          {row.locationName && ` · ${row.locationName}`}
        </div>
      </div>
      <div className="sched-cap">
        <div className="sched-cap-text">
          <span>
            {row.booked} / {row.capacity}
          </span>
          <span className="muted">{pct}%</span>
        </div>
        <div className={`progress ${tone}`}>
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
      <div className="sched-rev">{money(row.revenueCents, currency)}</div>
    </div>
  );
}

/**
 * Seven bars, drawn in CSS.
 *
 * No charting library: this is nine rectangles and a label, and the smallest
 * credible library is around 90KB to draw them.
 */
function WeekChart({
  days,
  currency,
}: {
  days: { date: string; cents: number }[];
  currency: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.cents));
  const total = days.reduce((sum, d) => sum + d.cents, 0);
  const peak = [...days].sort((a, b) => b.cents - a.cents)[0];

  return (
    <>
      <div className="chart-bars">
        {days.map((day, index) => {
          const height = Math.max(3, Math.round((day.cents / max) * 100));
          const label = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'short',
          });

          return (
            <div className="chart-col" key={day.date}>
              {/*
                The value is the bar's accessible name. A screen reader gets
                "Tue, $240" instead of a wall of unlabelled divs, and it doubles
                as the hover title.
              */}
              <div
                className={`chart-bar ${index === days.length - 1 ? 'today' : ''}`.trim()}
                style={{ height: `${height}%` }}
                title={`${label}: ${money(day.cents, currency)}`}
                role="img"
                aria-label={`${label}: ${money(day.cents, currency)}`}
              />
              <span className="chart-label">{label}</span>
            </div>
          );
        })}
      </div>

      <div className="chart-foot">
        <span className="muted">Best day</span>
        <b>
          {peak && peak.cents > 0
            ? `${new Date(`${peak.date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
              })} · ${money(peak.cents, currency)}`
            : '—'}
        </b>
      </div>
      <div className="chart-foot">
        <span className="muted">Daily average</span>
        <b>{money(Math.round(total / (days.length || 1)), currency)}</b>
      </div>
    </>
  );
}

function Ranked({
  rows,
  currency,
}: {
  rows: DashboardData['popular'];
  currency: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.bookings));

  return (
    <div className="ranked">
      {rows.map((row, index) => (
        <div className="rank-row" key={row.serviceTypeId}>
          <span className="rank-n">{index + 1}</span>
          <div className="rank-main">
            <div className="rank-name">
              <span>{row.name}</span>
              <span className="muted tiny">{Math.round((row.bookings / max) * 100)}%</span>
            </div>
            <div className="progress">
              <i style={{ width: `${Math.round((row.bookings / max) * 100)}%` }} />
            </div>
            <div className="tiny muted">
              {row.bookings} {row.bookings === 1 ? 'booking' : 'bookings'} · {row.seats}{' '}
              {row.seats === 1 ? 'person' : 'people'} · {money(row.revenueCents, currency)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  web: 'Booking page',
  embed: 'Embed widget',
  admin: 'Added by staff',
  reschedule: 'Rescheduled',
  'admin-reschedule': 'Rescheduled by staff',
  waitlist: 'Waitlist',
};

function Sources({
  rows,
  caveat,
}: {
  rows: { source: string; bookings: number }[];
  caveat: string | null;
}) {
  const total = rows.reduce((sum, r) => sum + r.bookings, 0);

  if (total === 0) return <p className="sub">No bookings in the last 30 days.</p>;

  /*
    A conic-gradient donut. Same reasoning as the bar chart — this is one
    element and a legend, and the palette is derived from the studio's own
    accent rather than from a fixed set, so a re-themed studio does not end up
    with a chart in somebody else's colours.
  */
  let cursor = 0;
  const stops = rows.map((row, index) => {
    const share = (row.bookings / total) * 100;
    const from = cursor;
    cursor += share;
    return `var(--slice-${Math.min(index, 4)}) ${from}% ${cursor}%`;
  });

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(',')})` }}>
        <div className="donut-hole">
          <b>{total}</b>
          <span className="tiny muted">bookings</span>
        </div>
      </div>

      <div className="legend">
        {rows.map((row, index) => (
          <div className="legend-row" key={row.source}>
            <span
              className="legend-dot"
              style={{ background: `var(--slice-${Math.min(index, 4)})` }}
              aria-hidden="true"
            />
            {SOURCE_LABELS[row.source] ?? row.source}
            <span className="legend-value">{Math.round((row.bookings / total) * 100)}%</span>
          </div>
        ))}
      </div>

      {/*
        Rendered only when the server still has something to say. B8 gave the
        widget its own source and the caveat is now null; the block stays here
        because a future channel that cannot be attributed cleanly (a partner
        integration, say) is exactly the shape of thing this line explains.
      */}
      {caveat && <p className="tiny muted donut-note">{caveat}</p>}
    </div>
  );
}

function Attention({
  items,
  outstanding,
  currency,
}: {
  items: DashboardData['attention'];
  outstanding: number;
  currency: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="mini-list">
      {items.map((item) => {
        const quiet = item.count === 0;
        // The money row states the amount; a count of "1" would mean nothing.
        const text =
          item.id === 'owed'
            ? quiet
              ? 'Nothing owed on upcoming bookings'
              : `${money(outstanding, currency)} ${item.label}`
            : `${item.count} ${item.count === 1 ? item.labelOne : item.label}`;

        return (
          <button
            type="button"
            className={`mini-row action ${quiet ? 'quiet' : ''}`.trim()}
            key={item.id}
            onClick={() => navigate(item.href)}
          >
            <span className={`attention-dot ${quiet ? 'ok' : 'warn'}`} aria-hidden="true" />
            <span className="mini-main">{text}</span>
            <Icon name="chevron" size={16} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Payment state, which is derived rather than stored.
 *
 * Mapped onto the existing status-pill vocabulary instead of inventing three
 * more classes: paid reads like a confirmation, part-paid like something
 * pending, unpaid like a no-show. Same colours the rest of the product already
 * uses for those meanings.
 */

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
