import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { Kpi, PageHead, StatGrid, StatusPill } from '../components/layout';
import { LoadingRegion, SkeletonCard } from '../components/states';
import { dateIn, timeIn } from '../lib/api';

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
    lastSyncedAt: string | null;
    lastError: string | null;
    /** Google's push channel lapses after about a week. */
    pushExpiresAt: string | null;
  }[];
  sms: {
    available: boolean;
    /** The hours in which a text MAY be sent — the quiet window is the gap. */
    sendingWindow: { fromHour: number; toHour: number };
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
  const timezone = org?.organization.timezone ?? 'UTC';

  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  /**
   * Sends the instructor to Google's consent screen.
   *
   * The whole OAuth flow has existed since W1.6 — per-instructor consent,
   * encrypted refresh tokens, the loop guard — with nothing in the product
   * calling it. The one thing worth saying on the way out is WHOSE calendar
   * is about to be connected: the browser carries whatever Google account is
   * already signed in, and connecting the owner's calendar to an instructor's
   * name is a mistake that only shows up as strange availability weeks later.
   */
  async function connectCalendar(staffId: string, staffName: string) {
    setCalendarBusy(staffId);
    try {
      const res = await api.post<{ url: string }>(
        `${base}/calendar/${staffId}/connect`,
      );
      window.location.href = res.url;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not start the calendar connection for ${staffName}.`,
      );
      setCalendarBusy(null);
    }
  }

  async function syncCalendar(staffId: string) {
    setCalendarBusy(staffId);
    setNotice(null);
    try {
      await api.post(`${base}/calendar/${staffId}/sync`);
      setError(null);
      setNotice('Calendar checked for changes.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync that calendar.');
    } finally {
      setCalendarBusy(null);
    }
  }

  async function disconnectCalendar(staffId: string, staffName: string) {
    /* Confirmed, because the consequence is invisible: nothing breaks, the
       instructor's outside commitments simply stop blocking their availability
       and the studio starts taking bookings over them. */
    const ok = window.confirm(
      `Disconnect ${staffName}'s calendar? Their outside commitments will stop ` +
        `blocking availability here, so bookings could be taken over them.`,
    );
    if (!ok) return;

    setCalendarBusy(staffId);
    setNotice(null);
    try {
      await api.del(`${base}/calendar/${staffId}`);
      setError(null);
      setNotice(`${staffName}'s calendar is no longer connected.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect it.');
    } finally {
      setCalendarBusy(null);
    }
  }

  /*
    Only the FIRST load gets to replace the page.

    This was `if (error) return`, which meant a failed sync on one instructor
    blanked the whole screen — Stripe's status, every other calendar, the SMS
    panel, all gone, replaced by one line about one calendar. An action that
    fails should say so where it happened and leave everything that is still
    true on screen.
  */
  if (error && !data) return <div className="err">{error}</div>;

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

      <StatGrid>
        <Kpi
          label="Payments"
          value={payments.chargesEnabled ? 'On' : payments.connected ? 'Setup' : 'Off'}
          icon="money"
          tone={payments.chargesEnabled ? 'green' : undefined}
          foot={
            payments.chargesEnabled
              ? 'taking cards'
              : payments.connected
                ? 'Stripe wants more details'
                : 'no card payments yet'
          }
        />
        <Kpi
          label="Calendars"
          value={`${connectedCalendars.length}/${calendars.length}`}
          icon="calendar"
          foot="instructors connected"
        />
        <Kpi
          label="Needs attention"
          value={String(needReauth.length)}
          icon="health"
          tone={needReauth.length > 0 ? 'red' : undefined}
          foot={needReauth.length > 0 ? 'reconnect to stop double bookings' : 'nothing broken'}
        />
        <Kpi
          label="Opted out of texts"
          value={String(sms.optedOutCustomers)}
          icon="customers"
          foot="replied STOP"
        />
      </StatGrid>

      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="err" role="alert">
          {error}{' '}
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

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
              <>
              <ul className="calendar-list">
                {calendars.map((cal) => (
                  <li key={cal.staffId}>
                    <span className="cal-name">{cal.staffName}</span>

                    <span className="cal-account sub">
                      {cal.accountEmail ?? 'Not connected'}
                      {/*
                        When it last actually pulled, not when the row last
                        changed. "Connected" and "still hearing about changes"
                        are different facts, and they only diverge when
                        something is wrong — which is when this page is read.
                      */}
                      {cal.connected && (
                        <span className="tiny muted cal-when">
                          {cal.lastSyncedAt
                            ? `last checked ${dateIn(cal.lastSyncedAt, timezone)} at ${timeIn(cal.lastSyncedAt, timezone)}`
                            : 'not checked yet'}
                        </span>
                      )}
                      {cal.lastError && (
                        <span className="tiny cal-error">{cal.lastError}</span>
                      )}
                    </span>

                    {cal.status === 'NEEDS_REAUTH' ? (
                      <StatusPill status="NO_SHOW">Reconnect needed</StatusPill>
                    ) : cal.connected ? (
                      <StatusPill status="CONFIRMED">Syncing</StatusPill>
                    ) : (
                      <StatusPill status="CANCELLED">Off</StatusPill>
                    )}

                    {/*
                      The buttons this page never had. Every one of these
                      endpoints has existed since W1.6 and nothing called them,
                      so a studio could read that a calendar needed reconnecting
                      and had nowhere to go.
                    */}
                    {isAdmin && (
                      <span className="cal-actions">
                        {cal.connected ? (
                          <>
                            {/* No "Sync now" on a connection whose grant has
                                expired: it can only fail, and a button that is
                                certain to fail is the same lie as a hover state
                                on something unclickable. Reconnect is the only
                                thing that helps, so it is the only thing
                                offered. */}
                            {cal.status === 'NEEDS_REAUTH' ? (
                              <button
                                className="link"
                                disabled={calendarBusy === cal.staffId}
                                onClick={() =>
                                  void connectCalendar(cal.staffId, cal.staffName)
                                }
                              >
                                Reconnect
                              </button>
                            ) : (
                              <button
                                className="link"
                                disabled={calendarBusy === cal.staffId}
                                onClick={() => void syncCalendar(cal.staffId)}
                              >
                                {calendarBusy === cal.staffId ? 'Checking…' : 'Sync now'}
                              </button>
                            )}
                            <button
                              className="link danger"
                              disabled={calendarBusy === cal.staffId}
                              onClick={() =>
                                void disconnectCalendar(cal.staffId, cal.staffName)
                              }
                            >
                              Disconnect
                            </button>
                          </>
                        ) : (
                          <button
                            className="link"
                            disabled={calendarBusy === cal.staffId}
                            onClick={() => void connectCalendar(cal.staffId, cal.staffName)}
                          >
                            Connect
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {/*
                Whose account is about to be connected is the one thing worth
                warning about: the browser carries whatever Google login is
                already signed in, and attaching the owner's calendar to an
                instructor's name surfaces weeks later as availability nobody
                can explain.
              */}
              {isAdmin && calendars.some((c) => !c.connected) && (
                <p className="sub tiny">
                  Connecting opens Google's own sign-in. Make sure the instructor
                  signs in as themselves — whoever is signed in to this browser is
                  the calendar that gets attached.
                </p>
              )}
              </>
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
                {/* The gap between the hours texting is allowed in — hence the
                    pair read backwards, and hence the field being called
                    `sendingWindow` rather than what it used to be. */}
                <dd>
                  {hour(sms.sendingWindow.toHour)} – {hour(sms.sendingWindow.fromHour)}
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
