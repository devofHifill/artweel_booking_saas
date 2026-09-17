import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn, money } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  initials,
  Kpi,
  Modal,
  PageHead,
  SegRange,
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
 * No refund button, deliberately, and D7 did not reopen it. The existing refund
 * endpoint applies the studio's CANCELLATION POLICY — for a late cancellation it
 * may refund nothing and grant a class credit instead. That is right where it
 * lives, in the cancellation flow, and wrong on a screen where "Refund" plainly
 * reads as "give this money back". A refund of an arbitrary amount is a
 * different feature: it needs its own amount field and its own provider call.
 * Rows link through to the customer, where cancelling lives.
 */

type Subject = {
  kind: 'CLASS' | 'COURSE' | 'PACK' | 'HOLD' | 'OTHER';
  label: string;
  startsAt: string | null;
  bookingId: string | null;
};

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
  subject: Subject;
};

type Totals = {
  count: number;
  receivedCents: number;
  refundedCents: number;
  failed: number;
  pending: number;
  breakdown: { kind: string; cents: number }[];
};

type Detail = {
  id: string;
  createdAt: string;
  succeededAt: string | null;
  kind: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  netCents: number;
  currency: string;
  provider: string;
  reference: string | null;
  failureReason: string | null;
  customer: { id: string; name: string } | null;
  subject: Subject;
  refunds: {
    id: string;
    amountCents: number;
    creditCents: number;
    reason: string | null;
    status: string;
    createdAt: string;
  }[];
  booking: {
    id: string;
    status: string;
    totalCents: number;
    paidCents: number;
    outstandingCents: number;
  } | null;
};

/**
 * The status tabs.
 *
 * One per status rather than grouped, because the counts come back from a
 * `groupBy` on the column — a tab reading "Refunded 4" that quietly meant
 * "refunded or partly refunded" would not match any number the server can
 * produce, and the two are a different conversation with a customer anyway.
 */
const TABS = [
  { id: '', label: 'All' },
  { id: 'SUCCEEDED', label: 'Succeeded' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'PARTIALLY_REFUNDED', label: 'Partly refunded' },
  { id: 'REFUNDED', label: 'Refunded' },
  { id: 'CANCELLED', label: 'Cancelled' },
] as const;

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
] as const;

type Range = (typeof RANGES)[number]['value'];

/** What each subject is called in the breakdown, in plain words. */
const SUBJECT_LABEL: Record<Subject['kind'], string> = {
  CLASS: 'Classes',
  COURSE: 'Courses',
  PACK: 'Class packs',
  HOLD: 'Checkouts in progress',
  OTHER: 'Unattached',
};

/**
 * The small line under the subject in the table.
 *
 * Null where there is nothing to add. A class puts its DATE there, and a
 * checkout in progress already says what it is in the line above — repeating
 * the category under the name gives a row that reads "Ten class pack / Class
 * packs", which is the interface talking to itself.
 */
const ROW_CAPTION: Record<Subject['kind'], string | null> = {
  CLASS: null,
  COURSE: 'Course',
  PACK: 'Class pack',
  HOLD: null,
  OTHER: null,
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default function Payments() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const timezone = org?.organization.timezone ?? 'UTC';

  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [outstandingCents, setOutstanding] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<Range>('30');
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const [open, setOpen] = useState<string | null>(null);

  /*
    The segments set the dates; `custom` stops overwriting them.

    Two controls writing one pair of values is the shape that produces a screen
    where the buttons and the date fields disagree about what is displayed. Here
    the segments own the dates until somebody chooses Custom, and then they stop
    touching them.
  */
  function chooseRange(next: Range) {
    setRange(next);
    if (next === 'all') {
      setFrom('');
      setTo('');
    } else if (next !== 'custom') {
      setFrom(isoDaysAgo(Number(next)));
      setTo('');
    }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (from) params.set('from', from);
    // The end of the chosen day, not its midnight — otherwise "to: today"
    // silently excludes everything taken today.
    if (to) params.set('to', `${to}T23:59:59.999Z`);
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await api.get<{
        payments: PaymentRow[];
        totals: Totals;
        counts: Record<string, number>;
        outstandingCents: number;
        nextCursor: string | null;
      }>(`${base}/payments?${params}`);

      setRows(res.payments);
      setTotals(res.totals);
      setCounts(res.counts);
      setOutstanding(res.outstandingCents);
      setHasMore(res.nextCursor !== null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payments.');
    }
  }, [base, from, to, status, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const breakdownTotal = useMemo(
    () => (totals?.breakdown ?? []).reduce((sum, row) => sum + row.cents, 0),
    [totals],
  );

  return (
    <>
      <PageHead
        title="Payments"
        lede="Everything charged, refunded and attempted."
        actions={
          <>
            <SegRange
              options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onChange={chooseRange}
              label="Date range"
            />
            <button
              onClick={() => rows && exportCsv(rows, timezone, range)}
              disabled={!rows || rows.length === 0}
            >
              Export
            </button>
          </>
        }
      />

      {range === 'custom' && (
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
        </Toolbar>
      )}

      {error && <div className="err">{error}</div>}

      {totals && (
        <StatGrid>
          <Kpi
            label="Received"
            value={money(totals.receivedCents, currency)}
            icon="money"
            tone="green"
            foot="after refunds"
          />
          <Kpi
            label="Refunded"
            value={money(totals.refundedCents, currency)}
            icon="refund"
            tone={totals.refundedCents > 0 ? 'red' : undefined}
            foot="in this range"
          />
          {/*
            Owed does NOT move with the date range, and says so.

            Every other tile here describes the window above it; this one
            describes the studio, because an unpaid class from March is still
            unpaid while you are looking at last week. Labelling it "in this
            range" like its neighbours would be the easy consistency and the
            wrong one.
          */}
          <Kpi
            label="Owed"
            value={money(outstandingCents, currency)}
            icon="today"
            tone={outstandingCents > 0 ? 'amber' : undefined}
            foot="across unpaid bookings, any date"
          />
          <Kpi
            label="Needs a look"
            value={String(totals.failed + totals.pending)}
            icon="health"
            foot={`${totals.failed} failed · ${totals.pending} pending`}
          />
        </StatGrid>
      )}

      <div className="pay-split">
        <div className="card" style={{ padding: 0 }}>
          {/* Tabs and filters inside the card, as one control surface over the
              rows they act on — the arrangement Bookings settled on in D2. */}
          <div className="tabs-wrap">
            <div className="tabs" role="tablist" aria-label="Payment status">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={status === tab.id}
                  className={`tab ${status === tab.id ? 'on' : ''}`.trim()}
                  onClick={() => setStatus(tab.id)}
                >
                  {tab.label}
                  {/* A blank is not a zero: `counts` only carries statuses that
                      have rows, so a missing key must render 0 rather than
                      nothing. `total` is the load signal because it is present
                      whenever the server replied. */}
                  {counts.total !== undefined && (
                    <span className="pill">
                      {counts[tab.id === '' ? 'total' : tab.id] ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <Toolbar>
            <input
              placeholder="Search customer name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 260 }}
            />
            {(search || status || range !== '30') && (
              <button
                className="sm"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                  chooseRange('30');
                }}
              >
                Clear
              </button>
            )}
          </Toolbar>

          {!rows && !error && (
            <div style={{ padding: 'var(--space-4)' }}>
              <LoadingRegion label="Loading payments">
                <SkeletonTable rows={6} cols={6} />
              </LoadingRegion>
            </div>
          )}

          {rows && rows.length === 0 && (
            <div style={{ padding: 'var(--space-5)' }}>
              <EmptyState hint="Try a wider date range or clear the status tab.">
                No payments match that.
              </EmptyState>
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
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
                    <th style={{ width: 90 }} />
                  </tr>
                }
              >
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{dateIn(row.createdAt, timezone)}</td>
                    <td>
                      {row.customer ? (
                        <span className="row-cell">
                          <span className="avatar sm" aria-hidden="true">
                            {initials(row.customer.name)}
                          </span>
                          <Link to={`/customers/${row.customer.id}`}>
                            {row.customer.name}
                          </Link>
                        </span>
                      ) : (
                        /* A payment against a hold has no customer record yet —
                           the checkout has not completed. */
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td>
                      {row.subject.label}
                      {(row.subject.startsAt ||
                        ROW_CAPTION[row.subject.kind]) && (
                        <div className="sub tiny">
                          {row.subject.startsAt
                            ? dateIn(row.subject.startsAt, timezone)
                            : ROW_CAPTION[row.subject.kind]}
                        </div>
                      )}
                    </td>
                    <td className="num">{money(row.amountCents, currency)}</td>
                    <td className="num">
                      {row.refundedCents > 0 ? (
                        <span className="money-out">
                          −{money(row.refundedCents, currency)}
                        </span>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="num strong">{money(row.netCents, currency)}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td>
                      <button className="sm" onClick={() => setOpen(row.id)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </DataTable>

              {/*
                A count, not a pager. The list is cursor-paginated so a studio
                scrolling a busy month does not see rows repeat, and a cursor
                cannot know which page it is on — so this states what is on
                screen against what matched, which is the honest half.
              */}
              <div className="table-foot">
                {hasMore
                  ? `Showing the ${rows.length} most recent of ${totals?.count ?? rows.length} payments. Narrow the range to see the rest.`
                  : `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'}`}
              </div>
            </>
          )}
        </div>

        <aside className="card">
          <div className="panel-head">
            <h2>Where it came from</h2>
          </div>
          <div className="panel-body">
            {/*
              By subject, not by payment method.

              The prototype breaks this down by Credit Card / PayPal / Cash /
              Bank Transfer. Every payment here is a Stripe card charge, so that
              chart would be a single bar at 100% forever. What does vary — and
              what an owner actually wants to know — is whether the money came
              from classes, courses or class packs.
            */}
            {!totals ? (
              <p className="sub">Loading…</p>
            ) : totals.breakdown.length === 0 ? (
              <p className="sub">Nothing received in this range.</p>
            ) : (
              totals.breakdown.map((row) => (
                <div key={row.kind} style={{ marginBottom: 'var(--space-3)' }}>
                  <div className="rank-name">
                    <span>{SUBJECT_LABEL[row.kind as Subject['kind']] ?? row.kind}</span>
                    <b>{money(row.cents, currency)}</b>
                  </div>
                  <div className="progress" style={{ marginTop: 4 }}>
                    <i
                      style={{
                        width: `${breakdownTotal > 0 ? Math.round((row.cents / breakdownTotal) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}

            {/*
              No payout schedule card. The prototype has one and every figure in
              it is invented — next payout is 31% of takings, fees are 2.9% of
              them — under its own disclaimer saying so. Real payout data means
              asking Stripe, and Stripe's own dashboard is where a studio
              reconciles a payout anyway.
            */}
            <p className="sub tiny">
              Received money only, so the bars add up to the figure above.
              Failed and pending charges are counted in “Needs a look”.
            </p>
          </div>
        </aside>
      </div>

      {open && (
        <PaymentDetail
          base={base}
          paymentId={open}
          currency={currency}
          timezone={timezone}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * One transaction, in full.
 *
 * Fetched when it opens rather than carried in the row: the reference, the
 * decline reason and the refund ledger are three joins and a second query, and
 * loading them for a hundred rows to show one is how a list gets slow for
 * everybody to serve the person who clicked.
 */
function PaymentDetail({
  base,
  paymentId,
  currency,
  timezone,
  onClose,
}: {
  base: string;
  paymentId: string;
  currency: string;
  timezone: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<Detail>(`${base}/payments/${paymentId}`)
      .then((res) => live && setDetail(res))
      .catch((err) =>
        live
          ? setError(err instanceof Error ? err.message : 'Could not load it.')
          : null,
      );
    return () => {
      live = false;
    };
  }, [base, paymentId]);

  return (
    <Modal
      title={detail ? money(detail.amountCents, currency) : 'Payment'}
      subtitle={detail ? detail.subject.label : undefined}
      onClose={onClose}
      /* Close only. A "View booking" button belongs here and there is nowhere
         for it to go: bookings have no page of their own, only a row in a
         filtered list. The customer link inside the detail reaches everything
         that booking has, which is the honest version of the same journey. */
      footer={<button onClick={onClose}>Close</button>}
    >
      {error && <div className="err">{error}</div>}
      {!detail && !error && <p className="sub">Loading…</p>}

      {detail && (
        <>
          <dl className="dl">
            <dt>Status</dt>
            <dd>
              <StatusPill status={detail.status} />
            </dd>

            <dt>Taken</dt>
            <dd>{dateIn(detail.createdAt, timezone)}</dd>

            {detail.succeededAt && (
              <>
                {/* "Settled", not "Succeeded" — that word is two rows above as
                    the STATUS, and the same label twice with different kinds of
                    value under it reads as a rendering bug. */}
                <dt>Settled</dt>
                <dd>{dateIn(detail.succeededAt, timezone)}</dd>
              </>
            )}

            <dt>Customer</dt>
            <dd>
              {detail.customer ? (
                <Link to={`/customers/${detail.customer.id}`} onClick={onClose}>
                  {detail.customer.name}
                </Link>
              ) : (
                '—'
              )}
            </dd>

            <dt>For</dt>
            <dd>
              {detail.subject.label}
              {detail.subject.startsAt &&
                ` · ${dateIn(detail.subject.startsAt, timezone)}`}
            </dd>

            <dt>Received</dt>
            <dd className="strong">{money(detail.netCents, currency)}</dd>

            {/*
              The provider reference, which is the whole reason a studio opens a
              transaction. It is the id Stripe's own dashboard search takes, so
              it is selectable text rather than a truncated decoration.
            */}
            <dt>Reference</dt>
            <dd className="mono">
              {detail.reference ?? (
                /* Not "none yet". A succeeded payment with no intent id is not
                   waiting for one — it was never a card charge, which is what
                   a booking marked paid at the counter looks like. Saying "yet"
                   about money that has already landed is the interface being
                   confidently wrong. */
                <span className="sub">
                  Not recorded — only charges taken through Stripe carry one.
                </span>
              )}
            </dd>

            {detail.failureReason && (
              <>
                <dt>Why it failed</dt>
                <dd className="money-out">{detail.failureReason}</dd>
              </>
            )}
          </dl>

          {detail.booking && (
            <div className="card" style={{ marginTop: 'var(--space-4)' }}>
              <div className="rank-name">
                <span className="sub">Booking total</span>
                <b>{money(detail.booking.totalCents, currency)}</b>
              </div>
              <div className="rank-name">
                <span className="sub">Paid</span>
                <b>{money(detail.booking.paidCents, currency)}</b>
              </div>
              <div className="rank-name">
                <span className="sub">Still owed</span>
                <b className={detail.booking.outstandingCents > 0 ? 'money-out' : ''}>
                  {money(detail.booking.outstandingCents, currency)}
                </b>
              </div>
              {/* The BOOKING's money, across all its payments — not this
                  charge's. One booking can be paid in two goes, and the
                  question at the counter is always about the booking. */}
            </div>
          )}

          {detail.refunds.length > 0 && (
            <>
              <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
                Refunds
              </h3>
              <div className="mini-list">
                {detail.refunds.map((refund) => (
                  <div className="mini-row" key={refund.id}>
                    <span className="mini-main">
                      <b>{money(refund.amountCents, currency)}</b>
                      <span className="tiny muted">
                        {refund.reason ?? 'No reason recorded'}
                        {/* Credit issued instead of cash is the studio's
                            cancellation policy doing its job, and it is the one
                            thing an owner is surprised by later. */}
                        {refund.creditCents > 0 &&
                          ` · ${money(refund.creditCents, currency)} as studio credit`}
                      </span>
                    </span>
                    <span className="mini-end tiny muted">
                      {dateIn(refund.createdAt, timezone)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * Downloads what is on screen.
 *
 * A reconciliation CSV is the one export request that comes from OUTSIDE the
 * studio — an accountant asks for it — which is why it is here and was declined
 * on Bookings, where the same button would only have re-exported a list the
 * owner was already looking at.
 *
 * It exports the loaded rows, not the whole filtered set. Built in the browser
 * from data already fetched, so it needs no endpoint; the footer under the
 * table states when there are more, which is the same honesty the count line
 * carries.
 */
function exportCsv(rows: PaymentRow[], timezone: string, range: string) {
  const out: (string | number)[][] = [
    ['Taken', 'Customer', 'For', 'Kind', 'Charged', 'Refunded', 'Received', 'Currency', 'Status'],
  ];

  for (const row of rows) {
    out.push([
      dateIn(row.createdAt, timezone),
      row.customer?.name ?? '',
      row.subject.label,
      row.subject.kind,
      (row.amountCents / 100).toFixed(2),
      (row.refundedCents / 100).toFixed(2),
      (row.netCents / 100).toFixed(2),
      row.currency,
      row.status,
    ]);
  }

  // Quoting, the BOM and the download all live in lib/csv now — this was one
  // of the two copies that made a third one worth refusing to write.
  downloadCsv(`artweel-payments-${range}.csv`, out);
}
