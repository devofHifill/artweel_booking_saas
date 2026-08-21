import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  PageHead,
  Stat,
  StatGrid,
  StatusPill,
  Toolbar,
} from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonTable } from '../components/states';

/**
 * Payments.
 *
 * The module could take money, refund it and answer questions about one
 * booking. It could not answer "what came in last month", which is the question
 * a studio asks at the end of every one.
 *
 * No refund button, deliberately. The existing refund endpoint applies the
 * studio's CANCELLATION POLICY — for a late cancellation it may refund nothing
 * and grant a class credit instead. That is right where it lives, in the
 * cancellation flow, and wrong on a screen where "Refund" plainly reads as
 * "give this money back". A refund of an arbitrary amount is a different
 * feature: it needs its own amount field and its own provider call. Rows link
 * through to the customer, where cancelling lives.
 */

type PaymentRow = {
  id: string;
  createdAt: string;
  succeededAt: string | null;
  kind: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  netCents: number;
  currency: string;
  customer: { id: string; name: string } | null;
  booking: { id: string; serviceName: string; startsAt: string } | null;
};

type Totals = {
  count: number;
  receivedCents: number;
  refundedCents: number;
  failed: number;
  pending: number;
};

const STATUSES = [
  ['', 'Any status'],
  ['SUCCEEDED', 'Succeeded'],
  ['PARTIALLY_REFUNDED', 'Partly refunded'],
  ['REFUNDED', 'Refunded'],
  ['PENDING', 'Pending'],
  ['FAILED', 'Failed'],
  ['CANCELLED', 'Cancelled'],
] as const;

/** Thirty days back, in the studio's own reckoning of a day. */
function defaultFrom(): string {
  const d = new Date(Date.now() - 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function Payments() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const timezone = org?.organization.timezone ?? 'UTC';

  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (from) params.set('from', from);
    // The end of the chosen day, not its midnight — otherwise "to: today"
    // silently excludes everything taken today.
    if (to) params.set('to', `${to}T23:59:59.999Z`);
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await api.get<{ payments: PaymentRow[]; totals: Totals }>(
        `${base}/payments?${params}`,
      );
      setRows(res.payments);
      setTotals(res.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payments.');
    }
  }, [base, from, to, status, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <PageHead
        title="Payments"
        lede="Everything charged, refunded and attempted."
      />

      <Toolbar>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          placeholder="Search customer name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
      </Toolbar>

      {error && <div className="err">{error}</div>}

      {totals && (
        <StatGrid>
          <Stat
            label="Received"
            value={money(totals.receivedCents, currency)}
            hint="after refunds"
          />
          <Stat label="Refunded" value={money(totals.refundedCents, currency)} />
          <Stat label="Payments" value={String(totals.count)} hint="in this range" />
          <Stat
            label="Needs a look"
            value={String(totals.failed + totals.pending)}
            hint={`${totals.failed} failed · ${totals.pending} pending`}
          />
        </StatGrid>
      )}

      {!rows && !error && (
        <LoadingRegion label="Loading payments">
          <SkeletonTable rows={6} cols={5} />
        </LoadingRegion>
      )}

      {rows && rows.length === 0 && (
        <EmptyState hint="Try a wider date range.">
          No payments in this range.
        </EmptyState>
      )}

      {rows && rows.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Payments, with what was charged, refunded and received"
            head={
              <tr>
                <th>Taken</th>
                <th>Customer</th>
                <th>For</th>
                <th className="num">Charged</th>
                <th className="num">Refunded</th>
                <th className="num">Received</th>
                <th>Status</th>
              </tr>
            }
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="nowrap">{dateIn(row.createdAt, timezone)}</td>
                <td>
                  {row.customer ? (
                    <Link to={`/customers/${row.customer.id}`}>
                      {row.customer.name}
                    </Link>
                  ) : (
                    /* Pack purchases and course enrolments pay without a
                       booking, so there is nobody to link to from here. */
                    <span className="sub">—</span>
                  )}
                </td>
                <td>
                  {row.booking ? (
                    <>
                      {row.booking.serviceName}
                      <div className="sub tiny">
                        {dateIn(row.booking.startsAt, timezone)}
                      </div>
                    </>
                  ) : (
                    <span className="sub">{row.kind.toLowerCase()}</span>
                  )}
                </td>
                <td className="num">{money(row.amountCents, currency)}</td>
                <td className="num">
                  {row.refundedCents > 0 ? (
                    money(row.refundedCents, currency)
                  ) : (
                    <span className="sub">—</span>
                  )}
                </td>
                <td className="num strong">{money(row.netCents, currency)}</td>
                <td>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </>
  );
}
