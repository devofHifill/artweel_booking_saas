import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead, StatusPill } from '../components/layout';
import { LoadingRegion, SkeletonCard } from '../components/states';

/**
 * Integrations.
 *
 * Four things this studio depends on, and whether each is actually working.
 * None of it is newly stored: Stripe mirrors its own verdict onto the studio
 * through `account.updated`, each calendar connection carries a status, and
 * whether SMS can be sent at all is a fact about the deployment. Before this
 * page those truths lived on four different screens, or on none.
 *
 * The useful state here is not "connected" — it is **connected but not
 * working**. A Stripe account that exists and cannot take charges, a calendar
 * whose token expired last week: both look fine from anywhere else in the
 * product, and both silently break something a customer depends on.
 */

type Integrations = {
  payments: {
    provider: string;
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    onboardedAt: string | null;
  };
  calendars: {
    staffId: string;
    staffName: string;
    connected: boolean;
    status: string | null;
    accountEmail: string | null;
    provider: string | null;
  }[];
  sms: {
    available: boolean;
    quietHours: { startHour: number; endHour: number };
    optedOutCustomers: number;
  };
};

/** 8 → "8am", 21 → "9pm". */
function hour(h: number): string {
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export default function Integrations() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Integrations>(`${base}/integrations`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load integrations.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Sends the owner to Stripe's own onboarding and back again. */
  async function connectStripe() {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`${base}/payments/connect`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Stripe setup.');
      setBusy(false);
    }
  }

  if (error) return <div className="err">{error}</div>;

  if (!data) {
    return (
      <LoadingRegion label="Loading integrations">
        <SkeletonCard lines={3} />
      </LoadingRegion>
    );
  }

  const { payments, calendars, sms } = data;
  const connectedCalendars = calendars.filter((c) => c.connected);
  const needReauth = calendars.filter((c) => c.status === 'NEEDS_REAUTH');

  return (
    <>
      <PageHead
        title="Integrations"
        lede="What your studio is plugged into, and whether it is working."
      />

      <div className="integrations">
        {/* --- Payments -------------------------------------------------- */}
        <section className="card integration">
          <header className="integration-head">
            <div>
              <h2>Payments</h2>
              <p className="sub">Stripe — money goes straight to your account.</p>
            </div>
            <PaymentsBadge payments={payments} />
          </header>

          <div className="integration-body">
            {!payments.connected && (
              <p className="sub">
                Not connected. You can take bookings, but not money — everything
                is pay-in-person until this is set up.
              </p>
            )}

            {/*
              The state worth spelling out. An account can exist and still be
              unable to charge, usually because Stripe is waiting on identity
              documents — and nothing else in the product says so.
            */}
            {payments.connected && !payments.chargesEnabled && (
              <div className="alert warn">
                Your Stripe account is connected but cannot take payments yet.
                Stripe is usually waiting on details from you — finish their
                checks and this clears itself.
              </div>
            )}

            {payments.connected && payments.chargesEnabled && (
              <dl className="integration-facts">
                <div>
                  <dt>Taking payments</dt>
                  <dd>Yes</dd>
                </div>
                <div>
                  <dt>Payouts to your bank</dt>
                  <dd>{payments.payoutsEnabled ? 'Yes' : 'Not yet'}</dd>
                </div>
              </dl>
            )}

            {isAdmin && !payments.chargesEnabled && (
              <button className="primary" disabled={busy} onClick={() => void connectStripe()}>
                {payments.connected ? 'Finish Stripe setup' : 'Connect Stripe'}
              </button>
            )}
          </div>
        </section>

        {/* --- Calendars ------------------------------------------------- */}
        <section className="card integration">
          <header className="integration-head">
            <div>
              <h2>Calendars</h2>
              <p className="sub">
                Google Calendar, per instructor. Anything in their calendar blocks
                their availability here.
              </p>
            </div>
            {needReauth.length > 0 ? (
              <StatusPill status="NO_SHOW">
                {needReauth.length} need reconnecting
              </StatusPill>
            ) : (
              <StatusPill status={connectedCalendars.length > 0 ? 'CONFIRMED' : 'CANCELLED'}>
                {connectedCalendars.length} of {calendars.length} connected
              </StatusPill>
            )}
          </header>

          <div className="integration-body">
            {calendars.length === 0 ? (
              <p className="sub">
                No instructors yet. <Link to="/staff">Add someone</Link> and their
                calendar can be connected here.
              </p>
            ) : (
              <ul className="calendar-list">
                {calendars.map((cal) => (
                  <li key={cal.staffId}>
                    <span className="cal-name">{cal.staffName}</span>
                    <span className="cal-account sub">
                      {cal.accountEmail ?? 'Not connected'}
                    </span>
                    {cal.status === 'NEEDS_REAUTH' ? (
                      <StatusPill status="NO_SHOW">Reconnect needed</StatusPill>
                    ) : cal.connected ? (
                      <StatusPill status="CONFIRMED">Syncing</StatusPill>
                    ) : (
                      <StatusPill status="CANCELLED">Off</StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/*
              An expired token is the quiet failure mode: availability keeps
              being offered from stale data, so the studio double-books and finds
              out from a customer.
            */}
            {needReauth.length > 0 && (
              <div className="alert danger">
                A calendar connection has expired, so that instructor's outside
                commitments are no longer blocking their availability here.
                Reconnect it before it causes a double booking.
              </div>
            )}
          </div>
        </section>

        {/* --- Text messages --------------------------------------------- */}
        <section className="card integration">
          <header className="integration-head">
            <div>
              <h2>Text messages</h2>
              <p className="sub">Reminders and confirmations by SMS.</p>
            </div>
            <StatusPill status={sms.available ? 'CONFIRMED' : 'CANCELLED'}>
              {sms.available ? 'On' : 'Not set up'}
            </StatusPill>
          </header>

          <div className="integration-body">
            {!sms.available && (
              <p className="sub">
                SMS is not configured on this deployment, so text reminders are
                not being sent. Email still goes out as normal.
              </p>
            )}

            <dl className="integration-facts">
              <div>
                <dt>Quiet hours</dt>
                <dd>
                  {hour(sms.quietHours.endHour)} – {hour(sms.quietHours.startHour)}
                </dd>
              </div>
              <div>
                <dt>Opted out</dt>
                <dd>
                  {sms.optedOutCustomers}{' '}
                  {sms.optedOutCustomers === 1 ? 'customer' : 'customers'}
                </dd>
              </div>
            </dl>

            <p className="sub tiny">
              Reminders are held until morning inside quiet hours. Confirmations
              are not — somebody who just booked is expecting one. Customers who
              replied STOP are never texted again, whatever they tick later.
            </p>

            <Link to="/notifications">See what has been sent</Link>
          </div>
        </section>
      </div>
    </>
  );
}

function PaymentsBadge({ payments }: { payments: Integrations['payments'] }) {
  if (!payments.connected) return <StatusPill status="CANCELLED">Not connected</StatusPill>;
  if (!payments.chargesEnabled) return <StatusPill status="PENDING">Needs attention</StatusPill>;
  return <StatusPill status="CONFIRMED">Working</StatusPill>;
}
