import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateIn, expiryIn, money, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { LoadingRegion, SkeletonStats, SkeletonList } from '../components/states';

type Credit = {
  id: string;
  status: 'AVAILABLE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  source: 'ABSENCE' | 'PACK' | 'GRANT';
  expiresAt: string | null;
  reason: string | null;
  enrollment: { id: string; courseSeries: { id: string; name: string } } | null;
};

type Purchase = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'REFUNDED';
  creditCount: number;
  pricePaidCents: number;
  issuedAt: string | null;
  expiresAt: string | null;
  classPack: { id: string; name: string } | null;
};

type Balance = {
  available: number;
  bySource: Record<string, number>;
  nextExpiry: string | null;
};

type Pack = {
  id: string;
  name: string;
  creditCount: number;
  priceCents: number;
  isActive: boolean;
};

type UpcomingSession = {
  id: string;
  startsAt: string;
  capacity: number;
  seatsTaken: number;
  serviceType: { name: string };
};

/** Where a credit came from, in words a studio would use. */
const SOURCE: Record<string, string> = {
  ABSENCE: 'missed class',
  PACK: 'pack',
  GRANT: 'given',
};

type CreditGroup = {
  key: string;
  credits: Credit[];
  source: string;
  detail: string | null;
  expiresAt: string | null;
};

/**
 * Credits are individually redeemable rows, which is right in the database and
 * wrong on a screen: a ten-class pack produces ten identical lines saying "one
 * class". They collapse by where they came from and when they lapse, which is
 * the only distinction a studio acts on.
 */
function groupCredits(credits: Credit[]): CreditGroup[] {
  const groups = new Map<string, CreditGroup>();

  for (const credit of credits) {
    // The reason often repeats the source ("pack" / "Class pack"), so it is
    // only shown when it adds something.
    const detail =
      credit.enrollment?.courseSeries.name ??
      (credit.reason && credit.reason.toLowerCase() !== 'class pack'
        ? credit.reason
        : null);
    const day = credit.expiresAt?.slice(0, 10) ?? '';
    const key = `${credit.source}|${detail ?? ''}|${day}`;

    const existing = groups.get(key);
    if (existing) existing.credits.push(credit);
    else
      groups.set(key, {
        key,
        credits: [credit],
        source: credit.source,
        detail,
        expiresAt: credit.expiresAt,
      });
  }

  return [...groups.values()];
}

type CustomerDetailResponse = {
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    notes: string | null;
    smsConsentAt: string | null;
    smsOptedOutAt: string | null;
    createdAt: string;
    bookings: {
      id: string;
      startsAt: string;
      status: string;
      seats: number;
      totalCents: number;
      serviceType: { name: string; color: string };
      staff: { name: string } | null;
    }[];
    stats: {
      total: number;
      attended: number;
      noShows: number;
      lifetimeCents: number;
    };
  };
};

export default function CustomerDetail() {
  const { customerId } = useParams();
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';

  const [data, setData] = useState<CustomerDetailResponse['customer'] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const [credits, setCredits] = useState<Credit[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [entError, setEntError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selling, setSelling] = useState('');
  const [redeeming, setRedeeming] = useState<Credit | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingSession[]>([]);

  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  useEffect(() => {
    api
      .get<CustomerDetailResponse>(`${base}/customers/${customerId}`)
      .then((res) => setData(res.customer))
      .catch((err) => setError(err.message));
  }, [base, customerId]);

  /**
   * Credits and packs are one question — "what has this person already paid
   * for?" — so they load together and render as one panel, whatever table
   * they came from.
   */
  const loadEntitlements = useCallback(async () => {
    try {
      const [c, p, b, catalogue] = await Promise.all([
        api.get<{ credits: Credit[] }>(`${base}/credits?customerId=${customerId}`),
        api.get<{ purchases: Purchase[] }>(
          `${base}/packs/purchases/all?customerId=${customerId}`,
        ),
        api.get<Balance>(`${base}/packs/balance/${customerId}`),
        api.get<{ packs: Pack[] }>(`${base}/packs`),
      ]);
      setCredits(c.credits);
      setPurchases(p.purchases);
      setBalance(b);
      setPacks(catalogue.packs.filter((x) => x.isActive));
      setEntError(null);
    } catch (err) {
      setEntError(
        err instanceof Error ? err.message : 'Could not load credits.',
      );
    }
  }, [base, customerId]);

  useEffect(() => {
    void loadEntitlements();
  }, [loadEntitlements]);

  async function sellPack() {
    if (!selling) return;
    const pack = packs.find((p) => p.id === selling);
    if (
      !confirm(
        `Sell "${pack?.name}" to ${data?.name}?\n\n` +
          `${pack?.creditCount} credit(s) are issued straight away. This records ` +
          'a sale you have already taken payment for — no card is charged here.',
      )
    )
      return;

    setBusy(true);
    try {
      await api.post(`${base}/packs/${selling}/sell`, { customerId });
      setSelling('');
      await loadEntitlements();
    } catch (err) {
      setEntError(err instanceof Error ? err.message : 'Could not sell it.');
    } finally {
      setBusy(false);
    }
  }

  async function grantCredit() {
    const reason = prompt('Why are you giving this credit? (optional)');
    if (reason === null) return;

    setBusy(true);
    try {
      await api.post(`${base}/credits`, {
        customerId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await loadEntitlements();
    } catch (err) {
      setEntError(err instanceof Error ? err.message : 'Could not grant it.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Spending a credit is the point of having one.
   *
   * The panel could show a make-up class owed and offer no way to book it,
   * which is where this started: the studio could see the debt and not settle
   * it. Sessions are loaded on demand rather than with the page, since most
   * visits to a customer are not about redeeming anything.
   */
  async function openRedeem(credit: Credit) {
    setRedeeming(credit);
    setEntError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      const res = await api.get<{ sessions: UpcomingSession[] }>(
        `${base}/sessions?from=${today}&to=${to}`,
      );
      setUpcoming(res.sessions.filter((s) => s.seatsTaken < s.capacity));
    } catch (err) {
      setEntError(err instanceof Error ? err.message : 'Could not load classes.');
    }
  }

  async function redeem(sessionId: string) {
    if (!redeeming) return;

    setBusy(true);
    try {
      await api.post(`${base}/credits/${redeeming.id}/redeem`, { sessionId });
      setRedeeming(null);
      setUpcoming([]);
      await loadEntitlements();
      // The booking is real, so the history above is now out of date too.
      const res = await api.get<CustomerDetailResponse>(
        `${base}/customers/${customerId}`,
      );
      setData(res.customer);
    } catch (err) {
      // Says which rule refused it — a full class, one that has started, or a
      // credit the studio keeps inside its own cohort.
      setEntError(err instanceof Error ? err.message : 'Could not book it.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelCredit(credit: Credit) {
    if (!confirm('Withdraw this credit? The customer loses the free class.'))
      return;

    setBusy(true);
    try {
      await api.del(`${base}/credits/${credit.id}`);
      await loadEntitlements();
    } catch (err) {
      setEntError(err instanceof Error ? err.message : 'Could not withdraw it.');
    } finally {
      setBusy(false);
    }
  }

  async function refundPurchase(purchase: Purchase) {
    if (
      !confirm(
        `Refund "${purchase.classPack?.name ?? 'this pack'}"?\n\n` +
          'Any credits from it that are still unused are withdrawn. Credits ' +
          'already spent on classes stay spent. The money itself is yours to ' +
          'return.',
      )
    )
      return;

    setBusy(true);
    try {
      await api.post(`${base}/packs/purchases/${purchase.id}/refund`, {});
      await loadEntitlements();
    } catch (err) {
      setEntError(err instanceof Error ? err.message : 'Could not refund it.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="err">{error}</div>;
  if (!data) return (
      <LoadingRegion label="Loading this customer">
        <SkeletonStats />
        <SkeletonList count={3} lines={3} />
      </LoadingRegion>
    );

  const liveCredits = credits.filter((c) => c.status === 'AVAILABLE');
  const spentCredits = credits.filter((c) => c.status !== 'AVAILABLE');

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/customers" className="sub">
            ← Customers
          </Link>
          <h1 style={{ marginTop: 6 }}>{data.name}</h1>
          <p className="sub">
            {data.email}
            {data.phone && ` · ${data.phone}`}
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="label">Bookings</div>
          <div className="value">{data.stats.total}</div>
        </div>
        <div className="card stat">
          <div className="label">Attended</div>
          <div className="value">{data.stats.attended}</div>
        </div>
        <div className="card stat">
          <div className="label">No shows</div>
          <div className="value">{data.stats.noShows}</div>
        </div>
        <div className="card stat">
          <div className="label">Lifetime</div>
          <div className="value">{money(data.stats.lifetimeCents, currency)}</div>
        </div>
      </div>

      {data.smsOptedOutAt && (
        <div className="alert warn">
          This customer replied STOP and will not receive text messages. Only
          they can opt back in, by replying START.
        </div>
      )}

      {/* --- What they have already paid for ------------------------------ */}

      <div className="card">
        <div className="row-head" style={{ cursor: 'default' }}>
          <h2>Credits and packs</h2>
          <div className="counts">
            {balance?.available ?? 0} class
            {balance?.available === 1 ? '' : 'es'} in hand
            {balance?.nextExpiry
              ? ` · first lapses ${expiryIn(balance.nextExpiry, timezone)}`
              : ''}
          </div>
        </div>

        {entError && <div className="err">{entError}</div>}

        {isAdmin && (
          <div className="toolbar" style={{ margin: '8px 0' }}>
            {packs.length > 0 && (
              <>
                <select
                  value={selling}
                  onChange={(e) => setSelling(e.target.value)}
                  aria-label="Pack to sell"
                >
                  <option value="">Sell a pack…</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.creditCount} for{' '}
                      {money(p.priceCents, currency)}
                    </option>
                  ))}
                </select>
                <button onClick={() => void sellPack()} disabled={busy || !selling}>
                  Sell
                </button>
              </>
            )}
            <button className="link" onClick={() => void grantCredit()} disabled={busy}>
              Give a credit
            </button>
          </div>
        )}

        {liveCredits.length === 0 && purchases.length === 0 && (
          <p className="sub">Nothing bought or owed.</p>
        )}

        {liveCredits.length > 0 && (
          <ul className="queue">
            {groupCredits(liveCredits).map((group) => (
              <li key={group.key}>
                <span className="who">
                  {group.credits.length} class
                  {group.credits.length === 1 ? '' : 'es'}
                  <span className="sub">
                    {SOURCE[group.source] ?? group.source.toLowerCase()}
                    {group.detail ? ` · ${group.detail}` : ''}
                  </span>
                </span>
                <span className="counts">
                  {group.expiresAt
                    ? `lapses ${expiryIn(group.expiresAt, timezone)}`
                    : 'no expiry'}
                </span>
                {/*
                  Withdrawing is offered one credit at a time. A block of ten
                  came from a pack, and the honest way to undo that is to
                  refund the purchase below — which withdraws what is unused
                  and leaves what has been spent alone.
                */}
                <button
                  className="link"
                  onClick={() => void openRedeem(group.credits[0]!)}
                  disabled={busy}
                >
                  Book a class
                </button>
                {isAdmin && group.credits.length === 1 && (
                  <button
                    className="link danger"
                    onClick={() => void cancelCredit(group.credits[0]!)}
                    disabled={busy}
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {redeeming && (
          <div className="pack">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div className="sub">
                Which class? The credit pays for one seat.
              </div>
              <button
                className="link"
                onClick={() => {
                  setRedeeming(null);
                  setUpcoming([]);
                }}
              >
                Cancel
              </button>
            </div>

            {upcoming.length === 0 && (
              <p className="sub">
                Nothing with a free seat in the next 60 days.
              </p>
            )}

            {upcoming.length > 0 && (
              <ul className="queue">
                {upcoming.map((session) => (
                  <li key={session.id}>
                    <span className="who">
                      {session.serviceType.name}
                      <span className="sub">
                        {dateIn(session.startsAt, timezone)} ·{' '}
                        {timeIn(session.startsAt, timezone)}
                      </span>
                    </span>
                    <span className="counts">
                      {session.capacity - session.seatsTaken} free
                    </span>
                    <button
                      className="link"
                      onClick={() => void redeem(session.id)}
                      disabled={busy}
                    >
                      Book
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {purchases.length > 0 && (
          <>
            <p className="sub" style={{ marginTop: 12 }}>
              Packs bought
            </p>
            <ul className="queue">
              {purchases.map((purchase) => (
                <li key={purchase.id}>
                  <span className="who">
                    {purchase.classPack?.name ?? 'Pack'}
                    <span className="sub">
                      {purchase.creditCount} classes ·{' '}
                      {money(purchase.pricePaidCents, currency)}
                      {purchase.expiresAt
                        ? ` · until ${expiryIn(purchase.expiresAt, timezone)}`
                        : ''}
                    </span>
                  </span>
                  <span className={`tag ${purchase.status}`}>
                    {purchase.status.toLowerCase()}
                  </span>
                  {isAdmin && purchase.status === 'ACTIVE' && (
                    <button
                      className="link danger"
                      onClick={() => void refundPurchase(purchase)}
                      disabled={busy}
                    >
                      Refund
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {spentCredits.length > 0 && (
          <p className="sub" style={{ marginTop: 10 }}>
            {spentCredits.filter((c) => c.status === 'REDEEMED').length} used ·{' '}
            {spentCredits.filter((c) => c.status === 'EXPIRED').length} lapsed ·{' '}
            {spentCredits.filter((c) => c.status === 'CANCELLED').length}{' '}
            withdrawn
          </p>
        )}
      </div>

      <h2>History</h2>

      {data.bookings.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-mark" aria-hidden="true">◍</span>
          <p className="empty-title">No bookings yet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Class</th>
                <th>With</th>
                <th>Status</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    {dateIn(booking.startsAt, timezone)}
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {timeIn(booking.startsAt, timezone)}
                    </div>
                  </td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: booking.serviceType.color }}
                    />
                    {booking.serviceType.name}
                  </td>
                  <td>{booking.staff?.name ?? '—'}</td>
                  <td>
                    <span className={`tag ${booking.status}`}>
                      {booking.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{money(booking.totalCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
