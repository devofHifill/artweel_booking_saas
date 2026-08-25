import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { DataTable, Kpi, PageHead, StatusPill, Toolbar } from '../components/layout';
import { EmptyState } from '../components/states';

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  smsConsentAt: string | null;
  smsOptedOutAt: string | null;
  spentCents: number;
  lastVisit: string | null;
  _count: { bookings: number };
};

const SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'spent', label: 'Highest spend' },
  { value: 'bookings', label: 'Most bookings' },
  { value: 'recent', label: 'Most recent visit' },
] as const;

export default function Customers() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const timezone = org?.organization.timezone ?? 'UTC';

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string>('name');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100', sort });
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await api.get<{ customers: CustomerRow[] }>(
        `${base}/customers?${params}`,
      );
      setCustomers(res.customers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, search, sort]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  /**
   * The four figures, derived from the rows on screen.
   *
   * Computed here rather than fetched, deliberately: they describe THIS LIST,
   * so when a search narrows it the tiles narrow with it. A separate endpoint
   * would report the whole studio and sit contradicting the table beneath it.
   *
   * The consequence is that they describe at most the 100 rows loaded, which
   * is honest as long as the label says "shown" rather than implying a total.
   */
  const totals = useMemo(() => {
    const spent = customers.reduce((sum, c) => sum + c.spentCents, 0);
    const repeat = customers.filter((c) => c._count.bookings > 1).length;
    return {
      count: customers.length,
      repeat,
      repeatPct: customers.length
        ? Math.round((repeat / customers.length) * 100)
        : 0,
      spent,
      average: customers.length ? Math.round(spent / customers.length) : 0,
    };
  }, [customers]);

  return (
    <>
      <PageHead
        title="Customers"
        lede="Everyone who has ever booked with you."
      />

      <div className="kpis">
        <Kpi label="Customers shown" value={String(totals.count)} icon="customers" />
        <Kpi
          label="Repeat guests"
          value={`${totals.repeat} · ${totals.repeatPct}%`}
          tone="violet"
          icon="bookings"
        />
        <Kpi
          label="Lifetime revenue"
          value={money(totals.spent, currency)}
          tone="green"
          icon="plan"
        />
        <Kpi
          label="Average spend"
          value={money(totals.average, currency)}
          tone="amber"
          icon="health"
        />
      </div>

      <Toolbar>
        <input
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <select
          value={sort}
          aria-label="Sort by"
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Toolbar>

      {error && <div className="err">{error}</div>}

      {customers.length === 0 ? (
        /* Was a hand-built copy of the empty state, which had drifted from the
           shared one: no hint slot, and the card wrapper the others do not use. */
        <EmptyState hint={search.trim() ? 'Try a different search.' : undefined}>
          {search.trim() ? 'No customers match that search.' : 'No customers yet.'}
        </EmptyState>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Customers, with contact details and text-message consent"
            head={
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th className="num">Bookings</th>
                <th className="num">Spent</th>
                <th>Last visit</th>
                <th>Texts</th>
              </tr>
            }
          >
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
                </td>
                <td>
                  {customer.email}
                  {customer.phone && (
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {customer.phone}
                    </div>
                  )}
                </td>
                <td className="num">{customer._count.bookings}</td>
                <td className="num">{money(customer.spentCents, currency)}</td>
                <td className="tiny muted">
                  {/* Never visited is not zero — an em dash says "none yet",
                      where a date would have to invent one. */}
                  {customer.lastVisit
                    ? dateIn(customer.lastVisit, timezone)
                    : '—'}
                </td>
                <td>
                  {/* Opt-out is shown distinctly from "never consented":
                      they are very different answers to "why no text?" */}
                  {customer.smsOptedOutAt ? (
                    <StatusPill status="NO_SHOW">Opted out</StatusPill>
                  ) : customer.smsConsentAt ? (
                    <StatusPill status="CONFIRMED">Yes</StatusPill>
                  ) : (
                    <StatusPill status="CANCELLED">No consent</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </>
  );
}
