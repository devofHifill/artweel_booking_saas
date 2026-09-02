import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  initials,
  Kpi,
  PageHead,
  SegRange,
  StatGrid,
  StatusPill,
  Tabs,
} from '../components/layout';
import { BarSeries, TrendChart, type TrendPoint } from '../components/charts';
import { EmptyState, LoadingRegion, SkeletonStats } from '../components/states';

/**
 * Reports.
 *
 * Six readings of one window. The range is fetched once and the tabs switch
 * client-side — changing tab is not a new question, only a different view of
 * the answer already on screen, and refetching six times would make the screen
 * feel slower than the data warrants.
 *
 * Every number comes from the same analytics module the dashboard reads, which
 * is why "revenue this week" cannot say one thing here and another there.
 */

type Report = {
  range: { days: number; currency: string; timezone: string };
  revenue: { date: string; cents: number }[];
  perDay: { date: string; bookings: number; seats: number }[];
  totals: { receivedCents: number; averageBookingCents: number };
  bookings: {
    total: number;
    seats: number;
    byStatus: { status: string; count: number }[];
    cancellationRate: number;
  };
  popular: {
    serviceTypeId: string;
    name: string;
    bookings: number;
    seats: number;
    revenueCents: number;
    capacity: number | null;
    occupancy: number | null;
  }[];
  sources: { source: string; bookings: number }[];
  lead: { medianDays: number | null; averageDays: number | null; sample: number };
  weekdays: { weekday: number; bookings: number; seats: number; revenueCents: number }[];
  customers: {
    newCustomers: number;
    returning: number;
    top: {
      id: string;
      name: string;
      bookings: number;
      spentCents: number;
      lastBookingAt: string | null;
    }[];
  };
  customerBase: {
    total: number;
    repeat: number;
    repeatRate: number;
    averageSpendCents: number;
  };
  staff: {
    staffId: string;
    name: string;
    classes: number;
    seats: number;
    revenueCents: number;
  }[];
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'activities', label: 'Activities' },
  { id: 'customers', label: 'Customers' },
  { id: 'staff', label: 'Staff' },
];

const RANGES = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

const SOURCE_LABELS: Record<string, string> = {
  web: 'Booking page',
  embed: 'Embedded widget',
  admin: 'Added by staff',
  reschedule: 'Rescheduled',
  'admin-reschedule': 'Rescheduled by staff',
};

/** Luxon's weekday numbering, which is what the server groups by. */
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function Reports() {
  const base = useOrgBase();
  const org = useActiveOrg();

  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api.get<Report>(`${base}/reports?days=${days}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports.');
    }
  }, [base, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';
  if (!isAdmin) {
    return (
      <>
        <PageHead title="Reports" />
        <EmptyState hint="Ask an owner or admin if you need these figures.">
          Reports are limited to owners and admins.
        </EmptyState>
      </>
    );
  }

  const currency = data?.range.currency ?? org?.organization.currency ?? 'USD';

  return (
    <>
      <PageHead
        title="Reports"
        lede="Where the money and the bookings actually come from."
        actions={
          <>
            <SegRange
              label="Date range"
              options={RANGES}
              value={days}
              onChange={setDays}
            />
            {data && (
              <button onClick={() => exportCsv(tab, data, currency)}>Export</button>
            )}
          </>
        }
      />

      <Tabs items={TABS} active={tab} onChange={setTab} label="Report sections" />

      {error && <div className="err">{error}</div>}

      {!data && !error && (
        <LoadingRegion label="Loading reports">
          <SkeletonStats count={4} />
        </LoadingRegion>
      )}

      {data && (
        <>
          {tab === 'overview' && <Overview data={data} currency={currency} />}
          {tab === 'revenue' && <Revenue data={data} currency={currency} />}
          {tab === 'bookings' && <Bookings data={data} currency={currency} />}
          {tab === 'activities' && <Activities data={data} currency={currency} />}
          {tab === 'customers' && <CustomersTab data={data} currency={currency} />}
          {tab === 'staff' && <StaffTab data={data} currency={currency} />}
        </>
      )}
    </>
  );
}

// --- The revenue series -----------------------------------------------------

/**
 * The daily figures, bucketed into weeks once there are too many to read.
 *
 * The prototype solves the same problem by drawing a SECOND chart of weekly
 * totals beside the daily one, and a third of the last six months that ignores
 * the range control entirely. This is the same information without a chart that
 * disagrees with the buttons above it: one series, at whatever resolution the
 * window can actually show.
 *
 * Buckets are built from the END backwards, so the last one is always the
 * current part-week rather than a stray remainder at the front.
 */
function toTrend(
  revenue: { date: string; cents: number }[],
  currency: string,
): { points: TrendPoint[]; weekly: boolean } {
  const weekly = revenue.length > 31;

  if (!weekly) {
    return {
      weekly,
      points: revenue.map((day) => ({
        key: day.date,
        value: day.cents,
        caption: `${longDay(day.date)}: ${money(day.cents, currency)}`,
        short: shortDay(day.date),
      })),
    };
  }

  const buckets: TrendPoint[] = [];
  for (let end = revenue.length; end > 0; end -= 7) {
    const week = revenue.slice(Math.max(0, end - 7), end);
    const cents = week.reduce((sum, day) => sum + day.cents, 0);
    const first = week[0]!;
    const last = week[week.length - 1]!;

    buckets.unshift({
      key: first.date,
      value: cents,
      caption: `${shortDay(first.date)} – ${shortDay(last.date)}: ${money(cents, currency)}`,
      short: shortDay(first.date),
    });
  }

  return { points: buckets, weekly };
}

// --- Tabs -------------------------------------------------------------------

function Overview({ data, currency }: { data: Report; currency: string }) {
  const trend = useMemo(
    () => toTrend(data.revenue, currency),
    [data.revenue, currency],
  );
  const busiest = useMemo(
    () => [...data.weekdays].sort((a, b) => b.revenueCents - a.revenueCents),
    [data.weekdays],
  );

  return (
    <>
      <StatGrid>
        <Kpi label="Received" value={money(data.totals.receivedCents, currency)} foot="after refunds" />
        <Kpi label="Bookings" value={String(data.bookings.total)} foot={`${data.bookings.seats} people`} />
        <Kpi
          label="Average booking"
          value={money(data.totals.averageBookingCents, currency)}
          foot="excluding cancellations"
        />
        <Kpi
          label="Cancellation rate"
          value={`${data.bookings.cancellationRate}%`}
          foot="of bookings in this period"
        />
      </StatGrid>

      <div className="dash-split">
        <section className="card panel">
          <header className="panel-head">
            <h2>Revenue</h2>
            <span className="head-figure">
              {money(data.totals.receivedCents, currency)} total
              {trend.weekly && ' · by week'}
            </span>
          </header>
          <div className="panel-body">
            <TrendChart
              points={trend.points}
              label={`Revenue over the last ${data.range.days} days`}
            />
          </div>
        </section>

        {/*
          Status mix, which the prototype puts here and we had only as a table
          two tabs away. On the overview it answers a different question from
          the table: not "how many were cancelled" but "what does a typical
          period look like", which is a shape rather than a number.
        */}
        <section className="card panel">
          <header className="panel-head">
            <h2>Booking mix</h2>
          </header>
          <div className="panel-body">
            <StatusMix data={data} />
          </div>
        </section>
      </div>

      <div className="dash-split" style={{ marginTop: 'var(--space-4)' }}>
        <section className="card panel">
          <header className="panel-head">
            <h2>Top classes</h2>
            <span className="head-figure">by money received</span>
          </header>
          <div className="panel-body">
            {data.popular.length === 0 ? (
              <p className="sub">No classes ran in this period.</p>
            ) : (
              <ul className="bar-list">
                {data.popular.slice(0, 5).map((row) => {
                  const best = Math.max(1, ...data.popular.map((r) => r.revenueCents));
                  return (
                    <li key={row.serviceTypeId}>
                      <span className="bar-label">
                        {row.name}
                        <span className="muted">{money(row.revenueCents, currency)}</span>
                      </span>
                      <div className="progress">
                        <i style={{ width: `${Math.round((row.revenueCents / best) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/*
          Busiest days, which is the one figure on this screen an owner can act
          on the same afternoon: it decides which evening gets another class.
        */}
        <section className="card panel">
          <header className="panel-head">
            <h2>Busiest days</h2>
          </header>
          <div className="panel-body">
            <DataTable
              caption="Which weekday earns the most"
              head={
                <tr>
                  <th>Day</th>
                  <th className="num">Bookings</th>
                  <th className="num">Received</th>
                </tr>
              }
            >
              {busiest.slice(0, 4).map((row) => (
                <tr key={row.weekday}>
                  <td>{WEEKDAYS[row.weekday]}</td>
                  <td className="num">{row.bookings}</td>
                  <td className="num strong">{money(row.revenueCents, currency)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </section>
      </div>
    </>
  );
}

function StatusMix({ data }: { data: Report }) {
  if (data.bookings.total === 0) {
    return <p className="sub">Nothing booked in this period.</p>;
  }

  return (
    <ul className="bar-list">
      {data.bookings.byStatus.map((row) => {
        const pct = Math.round((row.count / data.bookings.total) * 100);
        return (
          <li key={row.status}>
            <span className="bar-label">
              <StatusPill status={row.status} />
              <span className="muted">
                {row.count} · {pct}%
              </span>
            </span>
            <div className="progress">
              <i style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Revenue({ data, currency }: { data: Report; currency: string }) {
  const best = [...data.revenue].sort((a, b) => b.cents - a.cents)[0];
  const trend = useMemo(
    () => toTrend(data.revenue, currency),
    [data.revenue, currency],
  );

  return (
    <>
      <StatGrid>
        <Kpi label="Received" value={money(data.totals.receivedCents, currency)} foot="after refunds" />
        <Kpi
          label="Daily average"
          value={money(
            Math.round(data.totals.receivedCents / (data.revenue.length || 1)),
            currency,
          )}
          foot={`over ${data.revenue.length} ${data.revenue.length === 1 ? 'day' : 'days'}`}
        />
        <Kpi
          label="Best day"
          value={best && best.cents > 0 ? money(best.cents, currency) : '—'}
          foot={best && best.cents > 0 ? longDay(best.date) : 'nothing taken yet'}
        />
        <Kpi
          label="Average booking"
          value={money(data.totals.averageBookingCents, currency)}
          foot="excluding cancellations"
        />
      </StatGrid>

      <section className="card panel">
        <header className="panel-head">
          <h2>{trend.weekly ? 'Week by week' : 'Day by day'}</h2>
          <span className="head-figure">
            {money(data.totals.receivedCents, currency)} total
          </span>
        </header>
        <div className="panel-body">
          <TrendChart
            points={trend.points}
            label={`Revenue over the last ${data.range.days} days`}
          />
        </div>
      </section>

      <section className="card panel" style={{ marginTop: 'var(--space-4)' }}>
        <header className="panel-head">
          <h2>By weekday</h2>
          <span className="head-figure">across the whole period</span>
        </header>
        <div className="panel-body">
          <DataTable
            caption="Revenue and bookings by day of the week"
            head={
              <tr>
                <th>Day</th>
                <th className="num">Bookings</th>
                <th className="num">People</th>
                <th className="num">Received</th>
              </tr>
            }
          >
            {data.weekdays.map((row) => (
              <tr key={row.weekday}>
                <td>{WEEKDAYS[row.weekday]}</td>
                <td className="num">{row.bookings}</td>
                <td className="num">{row.seats}</td>
                <td className="num strong">{money(row.revenueCents, currency)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>
    </>
  );
}

function Bookings({ data, currency }: { data: Report; currency: string }) {
  if (data.bookings.total === 0) {
    return <EmptyState>No bookings in this period.</EmptyState>;
  }

  /* The last fortnight at most. A bar per day over ninety days answers a
     question the trend chart above already answers better. */
  const recent = data.perDay.slice(-14);

  return (
    <>
      <StatGrid>
        <Kpi label="Bookings" value={String(data.bookings.total)} />
        <Kpi label="People" value={String(data.bookings.seats)} />
        <Kpi label="Cancelled" value={`${data.bookings.cancellationRate}%`} foot="of the period" />
        <Kpi
          label="Booked ahead"
          value={data.lead.medianDays === null ? '—' : `${data.lead.medianDays} days`}
          /*
            The median leads and the average follows it, rather than the other
            way round. One person booking a six-week course in January for April
            drags a mean past anything a studio would recognise; the median is
            the booking in the middle, which is the one they can plan around.
          */
          foot={
            data.lead.averageDays === null
              ? 'nothing booked yet'
              : `typical · ${data.lead.averageDays} days on average`
          }
        />
      </StatGrid>

      <div className="dash-split">
        <section className="card panel">
          <header className="panel-head">
            <h2>Bookings per day</h2>
            <span className="head-figure">last {recent.length} days</span>
          </header>
          <div className="panel-body">
            <BarSeries
              bars={recent.map((day, index) => ({
                key: day.date,
                value: day.bookings,
                label: shortWeekday(day.date),
                caption: `${longDay(day.date)}: ${day.bookings} ${day.bookings === 1 ? 'booking' : 'bookings'}`,
                highlight: index === recent.length - 1,
              }))}
            />
          </div>
        </section>

        <section className="card panel">
          <header className="panel-head">
            <h2>Where they came from</h2>
          </header>
          <div className="panel-body">
            {data.sources.length === 0 ? (
              <p className="sub">Nothing booked in this period.</p>
            ) : (
              <ul className="bar-list">
                {data.sources.map((s) => {
                  const total = data.sources.reduce((sum, x) => sum + x.bookings, 0);
                  const pct = Math.round((s.bookings / total) * 100);
                  return (
                    <li key={s.source}>
                      <span className="bar-label">
                        {SOURCE_LABELS[s.source] ?? s.source}
                        <span className="muted">{pct}%</span>
                      </span>
                      <div className="progress">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
        <DataTable
          caption="Bookings by status"
          head={
            <tr>
              <th>Status</th>
              <th className="num">Bookings</th>
              <th className="num">Share</th>
            </tr>
          }
        >
          {data.bookings.byStatus.map((row) => (
            <tr key={row.status}>
              <td>
                <StatusPill status={row.status} />
              </td>
              <td className="num">{row.count}</td>
              <td className="num">
                {Math.round((row.count / data.bookings.total) * 100)}%
              </td>
            </tr>
          ))}
        </DataTable>
      </div>

      <p className="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
        Money is counted on the day it arrived; a booking counts on the day its
        class runs. The two charts above answer different questions on purpose.
      </p>
    </>
  );
}

function Activities({ data, currency }: { data: Report; currency: string }) {
  if (data.popular.length === 0) {
    return (
      <EmptyState hint="Classes count once they have run.">
        No classes ran in this period.
      </EmptyState>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <DataTable
        caption="Classes ranked by how much they sold"
        head={
          <tr>
            <th>Class</th>
            <th className="num">Bookings</th>
            <th className="num">People</th>
            <th className="num">Received</th>
            <th>How full</th>
          </tr>
        }
      >
        {data.popular.map((row) => (
          <tr key={row.serviceTypeId}>
            <td>{row.name}</td>
            <td className="num">{row.bookings}</td>
            <td className="num">{row.seats}</td>
            <td className="num strong">{money(row.revenueCents, currency)}</td>
            <td className="cell-meter">
              {row.occupancy === null ? (
                /* A private lesson has no session and therefore no seats that
                   went unsold. "0%" would accuse it of failing to fill them. */
                <span className="sub">—</span>
              ) : (
                <>
                  <div className={`progress ${fullness(row.occupancy)}`}>
                    <i style={{ width: `${Math.min(100, row.occupancy)}%` }} />
                  </div>
                  <span className="tiny muted">
                    {row.occupancy}% of {row.capacity} seats
                  </span>
                </>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

/**
 * Quiet, busy, full.
 *
 * The prototype colours this green/amber/red at the same thresholds. This
 * product's progress tones already reject that scale with a reason worth
 * keeping: a full class is good news, and red on a sold-out Saturday reads as
 * a warning about success.
 */
function fullness(pct: number): 'quiet' | 'busy' | 'full' {
  if (pct >= 85) return 'full';
  if (pct >= 45) return 'busy';
  return 'quiet';
}

function CustomersTab({ data, currency }: { data: Report; currency: string }) {
  return (
    <>
      <StatGrid>
        <Kpi label="Customers" value={String(data.customerBase.total)} foot="on the books, all time" />
        <Kpi
          label="New"
          value={String(data.customers.newCustomers)}
          foot="joined in this period"
        />
        <Kpi
          label="Come back"
          value={`${data.customerBase.repeatRate}%`}
          foot={`${data.customerBase.repeat} have booked more than once`}
        />
        <Kpi
          label="Average customer"
          value={money(data.customerBase.averageSpendCents, currency)}
          foot="received, over everyone on the books"
        />
      </StatGrid>

      {data.customers.top.length === 0 ? (
        <EmptyState>Nobody booked in this period.</EmptyState>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Customers who spent the most in this period"
            head={
              <tr>
                <th>Customer</th>
                <th className="num">Bookings</th>
                <th className="num">Spent</th>
                <th>Last class</th>
              </tr>
            }
          >
            {data.customers.top.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="row-cell">
                    <span className="avatar sm" aria-hidden="true">
                      {initials(row.name)}
                    </span>
                    <Link to={`/customers/${row.id}`}>{row.name}</Link>
                  </span>
                </td>
                <td className="num">{row.bookings}</td>
                <td className="num strong">{money(row.spentCents, currency)}</td>
                <td className="nowrap">
                  {row.lastBookingAt ? (
                    longDay(row.lastBookingAt.slice(0, 10))
                  ) : (
                    <span className="sub">—</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {/* Three of these four describe the whole business rather than the range
          above, and a tile that quietly meant something else than its
          neighbours is how a screen stops being trustworthy. */}
      <p className="tiny muted" style={{ marginTop: 'var(--space-2)' }}>
        Customer counts and the average cover your whole history. Only “New” and
        the table below follow the date range.
      </p>
    </>
  );
}

function StaffTab({ data, currency }: { data: Report; currency: string }) {
  if (data.staff.length === 0) {
    return (
      <EmptyState hint="Assign an instructor to a class and it appears here.">
        No classes with an instructor in this period.
      </EmptyState>
    );
  }

  const best = Math.max(1, ...data.staff.map((row) => row.revenueCents));

  return (
    <div className="card" style={{ padding: 0 }}>
      <DataTable
        caption="What each instructor taught in this period"
        head={
          <tr>
            <th>Instructor</th>
            <th className="num">Classes</th>
            <th className="num">People</th>
            <th>Received</th>
          </tr>
        }
      >
        {data.staff.map((row) => (
          <tr key={row.staffId}>
            <td>
              <span className="row-cell">
                <span className="avatar sm" aria-hidden="true">
                  {initials(row.name)}
                </span>
                {row.name}
              </span>
            </td>
            <td className="num">{row.classes}</td>
            <td className="num">{row.seats}</td>
            <td className="cell-meter">
              <b>{money(row.revenueCents, currency)}</b>
              {/*
                A share of the top row, not of the studio's takings. It ranks
                colleagues against each other, which is what the column is for;
                a share of total would mostly measure how many instructors the
                studio has.
              */}
              <div className="progress">
                <i style={{ width: `${Math.round((row.revenueCents / best) * 100)}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

// --- Shared -----------------------------------------------------------------

function longDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function shortWeekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
  });
}

/**
 * Downloads the tab you are looking at.
 *
 * Exporting the visible tab rather than everything: a single file containing six
 * unrelated tables is not a spreadsheet anybody can use. Built in the browser
 * from data already loaded, so it needs no endpoint and no second round trip.
 */
function exportCsv(tab: string, data: Report, currency: string) {
  const rows: (string | number)[][] = [];

  if (tab === 'revenue' || tab === 'overview') {
    rows.push(['Date', 'Received']);
    for (const day of data.revenue) rows.push([day.date, (day.cents / 100).toFixed(2)]);
  } else if (tab === 'bookings') {
    rows.push(['Date', 'Bookings', 'People']);
    for (const day of data.perDay) rows.push([day.date, day.bookings, day.seats]);
  } else if (tab === 'activities') {
    rows.push(['Class', 'Bookings', 'People', 'Received', 'Seats offered', 'How full %']);
    for (const row of data.popular) {
      rows.push([
        row.name,
        row.bookings,
        row.seats,
        (row.revenueCents / 100).toFixed(2),
        row.capacity ?? '',
        row.occupancy ?? '',
      ]);
    }
  } else if (tab === 'customers') {
    rows.push(['Customer', 'Bookings', 'Spent', 'Last class']);
    for (const row of data.customers.top) {
      rows.push([
        row.name,
        row.bookings,
        (row.spentCents / 100).toFixed(2),
        row.lastBookingAt?.slice(0, 10) ?? '',
      ]);
    }
  } else if (tab === 'staff') {
    rows.push(['Instructor', 'Classes', 'People', 'Received']);
    for (const row of data.staff) {
      rows.push([row.name, row.classes, row.seats, (row.revenueCents / 100).toFixed(2)]);
    }
  }

  downloadCsv(`artweel-${tab}-${data.range.days}d.csv`, rows);

  void currency;
}
