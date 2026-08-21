import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  PageHead,
  SegRange,
  Stat,
  StatGrid,
  StatusPill,
  Tabs,
} from '../components/layout';
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
  }[];
  sources: { source: string; bookings: number }[];
  customers: {
    newCustomers: number;
    returning: number;
    top: { id: string; name: string; bookings: number; spentCents: number }[];
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
  admin: 'Added by staff',
  reschedule: 'Rescheduled',
  'admin-reschedule': 'Rescheduled by staff',
};

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
          {tab === 'bookings' && <Bookings data={data} />}
          {tab === 'activities' && <Activities data={data} currency={currency} />}
          {tab === 'customers' && <CustomersTab data={data} currency={currency} />}
          {tab === 'staff' && <StaffTab data={data} currency={currency} />}
        </>
      )}
    </>
  );
}

// --- Tabs -------------------------------------------------------------------

function Overview({ data, currency }: { data: Report; currency: string }) {
  return (
    <>
      <StatGrid>
        <Stat label="Received" value={money(data.totals.receivedCents, currency)} hint="after refunds" />
        <Stat label="Bookings" value={String(data.bookings.total)} hint={`${data.bookings.seats} people`} />
        <Stat
          label="Average booking"
          value={money(data.totals.averageBookingCents, currency)}
          hint="excluding cancellations"
        />
        <Stat
          label="Cancellation rate"
          value={`${data.bookings.cancellationRate}%`}
          hint="of bookings in this period"
        />
      </StatGrid>

      <div className="dash-split">
        <section className="card panel">
          <header className="panel-head">
            <h2>Revenue</h2>
          </header>
          <div className="panel-body">
            <RevenueChart days={data.revenue} currency={currency} />
          </div>
        </section>

        <section className="card panel">
          <header className="panel-head">
            <h2>New customers</h2>
          </header>
          <div className="panel-body">
            <StatGrid className="stats">
              <Stat label="New" value={String(data.customers.newCustomers)} />
              <Stat label="Returning" value={String(data.customers.returning)} />
            </StatGrid>
          </div>
        </section>
      </div>
    </>
  );
}

function Revenue({ data, currency }: { data: Report; currency: string }) {
  const best = [...data.revenue].sort((a, b) => b.cents - a.cents)[0];

  return (
    <>
      <StatGrid>
        <Stat label="Received" value={money(data.totals.receivedCents, currency)} />
        <Stat
          label="Daily average"
          value={money(
            Math.round(data.totals.receivedCents / (data.revenue.length || 1)),
            currency,
          )}
        />
        <Stat
          label="Best day"
          value={best && best.cents > 0 ? money(best.cents, currency) : '—'}
          hint={best && best.cents > 0 ? dayLabel(best.date) : undefined}
        />
      </StatGrid>

      <section className="card panel">
        <header className="panel-head">
          <h2>Day by day</h2>
        </header>
        <div className="panel-body">
          <RevenueChart days={data.revenue} currency={currency} />
        </div>
      </section>
    </>
  );
}

function Bookings({ data }: { data: Report }) {
  if (data.bookings.total === 0) {
    return <EmptyState>No bookings in this period.</EmptyState>;
  }

  return (
    <>
      <StatGrid>
        <Stat label="Bookings" value={String(data.bookings.total)} />
        <Stat label="People" value={String(data.bookings.seats)} />
        <Stat label="Cancelled" value={`${data.bookings.cancellationRate}%`} />
      </StatGrid>

      <div className="card" style={{ padding: 0 }}>
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

      <section className="card panel" style={{ marginTop: 'var(--space-4)' }}>
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
          {/* Same limitation the dashboard states — the widget cannot be told
              apart from the booking page until it gets its own source. */}
          <p className="tiny muted">
            “Booking page” covers both your page and the embedded widget.
          </p>
        </div>
      </section>
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
          </tr>
        }
      >
        {data.popular.map((row) => (
          <tr key={row.serviceTypeId}>
            <td>{row.name}</td>
            <td className="num">{row.bookings}</td>
            <td className="num">{row.seats}</td>
            <td className="num strong">{money(row.revenueCents, currency)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function CustomersTab({ data, currency }: { data: Report; currency: string }) {
  return (
    <>
      <StatGrid>
        <Stat label="New customers" value={String(data.customers.newCustomers)} hint="joined in this period" />
        <Stat label="Returning" value={String(data.customers.returning)} hint="booked again" />
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
              </tr>
            }
          >
            {data.customers.top.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/customers/${row.id}`}>{row.name}</Link>
                </td>
                <td className="num">{row.bookings}</td>
                <td className="num strong">{money(row.spentCents, currency)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
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

  return (
    <div className="card" style={{ padding: 0 }}>
      <DataTable
        caption="What each instructor taught in this period"
        head={
          <tr>
            <th>Instructor</th>
            <th className="num">Classes</th>
            <th className="num">People</th>
            <th className="num">Received</th>
          </tr>
        }
      >
        {data.staff.map((row) => (
          <tr key={row.staffId}>
            <td>{row.name}</td>
            <td className="num">{row.classes}</td>
            <td className="num">{row.seats}</td>
            <td className="num strong">{money(row.revenueCents, currency)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

// --- Shared -----------------------------------------------------------------

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The same CSS bar chart the dashboard uses, widened for a longer window.
 *
 * At 90 days the labels are dropped rather than crushed — a row of unreadable
 * three-letter days is noise, and the hover title still names each bar.
 */
function RevenueChart({
  days,
  currency,
}: {
  days: { date: string; cents: number }[];
  currency: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.cents));
  const dense = days.length > 31;

  if (days.length === 1) {
    const only = days[0]!;
    return (
      <p className="single-day">
        <b>{money(only.cents, currency)}</b> <span className="muted">taken today</span>
      </p>
    );
  }

  return (
    <div className={`chart-bars ${dense ? 'dense' : ''}`.trim()}>
      {days.map((day, index) => {
        const height = Math.max(3, Math.round((day.cents / max) * 100));
        const label = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
        });

        return (
          <div className="chart-col" key={day.date}>
            <div
              className={`chart-bar ${index === days.length - 1 ? 'today' : ''}`.trim()}
              style={{ height: `${height}%` }}
              title={`${dayLabel(day.date)}: ${money(day.cents, currency)}`}
              role="img"
              aria-label={`${dayLabel(day.date)}: ${money(day.cents, currency)}`}
            />
            {!dense && <span className="chart-label">{label}</span>}
          </div>
        );
      })}
    </div>
  );
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
    rows.push(['Status', 'Bookings']);
    for (const row of data.bookings.byStatus) rows.push([row.status, row.count]);
  } else if (tab === 'activities') {
    rows.push(['Class', 'Bookings', 'People', 'Received']);
    for (const row of data.popular) {
      rows.push([row.name, row.bookings, row.seats, (row.revenueCents / 100).toFixed(2)]);
    }
  } else if (tab === 'customers') {
    rows.push(['Customer', 'Bookings', 'Spent']);
    for (const row of data.customers.top) {
      rows.push([row.name, row.bookings, (row.spentCents / 100).toFixed(2)]);
    }
  } else if (tab === 'staff') {
    rows.push(['Instructor', 'Classes', 'People', 'Received']);
    for (const row of data.staff) {
      rows.push([row.name, row.classes, row.seats, (row.revenueCents / 100).toFixed(2)]);
    }
  }

  /*
    Quoted and escaped. A class called `Wheel Throwing, Level 2` would otherwise
    split into two columns, and a studio name containing a quote would break the
    row after it — both silent, and both only discovered in somebody's
    spreadsheet.
  */
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');

  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `artweel-${tab}-${data.range.days}d.csv`;
  link.click();
  URL.revokeObjectURL(url);

  void currency;
}
