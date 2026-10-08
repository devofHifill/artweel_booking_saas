import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, money } from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { LoadingRegion, SkeletonList } from '../components/states';
import { PageHead, Stat, StatGrid } from '../components/layout';

type Plan = {
  id: string;
  name: string;
  priceCentsMonthly: number;
  maxStaff: number | null;
  maxLocations: number | null;
  mobileBookings: boolean;
  smsReminders: boolean;
  courseSeries: boolean;
  blurb: string;
};

type BillingState = {
  plan: string;
  planName: string;
  status: string;
  trialDaysLeft: number | null;
  canWrite: boolean;
  notice: { level: 'info' | 'warn' | 'danger'; message: string } | null;
  usage: { staff: number; locations: number };
  limits: { maxStaff: number | null; maxLocations: number | null };
};

export default function Billing() {
  const base = useOrgBase();
  const [state, setState] = useState<BillingState | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Stripe sends a studio back with `subscribed=1` after checkout. The plan
     itself flips when the subscription webhook lands, which can trail the
     redirect by a few seconds, so say so rather than show the old plan bare. */
  const [params, setParams] = useSearchParams();
  const [justSubscribed] = useState(() => params.get('subscribed') === '1');
  useEffect(() => {
    if (params.has('subscribed')) {
      setParams(
        (p) => {
          p.delete('subscribed');
          return p;
        },
        { replace: true },
      );
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ billing: BillingState; plans: Plan[] }>(
        `${base}/billing`,
      );
      setState(res.billing);
      setPlans(res.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load billing.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe(plan: string) {
    setBusy(true);
    try {
      const res = await api.post<{ url: string; simulated: boolean }>(
        `${base}/billing/subscribe`,
        { plan },
      );

      if (res.simulated) {
        // No Stripe keys configured locally — the server activated directly
        // so the flow can still be walked end to end.
        await load();
      } else {
        window.location.href = res.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  /** Stripe's own portal: card, invoices, cancellation. */
  async function manageBilling() {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`${base}/billing/portal`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing.');
      setBusy(false);
    }
  }

  if (!state) return (
      <LoadingRegion label="Loading your plan">
        <SkeletonList count={3} lines={3} />
      </LoadingRegion>
    );

  return (
    <>
      <PageHead
        title="Plan and billing"
        lede={
          <>
            You are on {state.planName}
            {state.trialDaysLeft !== null &&
              state.status === 'TRIALING' &&
              ` · ${state.trialDaysLeft} days left on your trial`}
          </>
        }
      />

      {error && <div className="err">{error}</div>}
      {justSubscribed && state.status !== 'ACTIVE' && (
        <div className="alert" role="status">
          Thanks — Stripe has your payment. Your plan switches over as soon as
          Stripe confirms it, usually within a minute.
        </div>
      )}
      {state.notice && (
        <div className={`alert ${state.notice.level === 'danger' ? 'danger' : 'warn'}`}>
          {state.notice.message}
        </div>
      )}

      <StatGrid>
        <Stat
          label="Instructors"
          value={
            <>
              {state.usage.staff}
              <span className="sub" style={{ fontSize: '.9rem', fontWeight: 400 }}>
                {' '}
                / {state.limits.maxStaff ?? '∞'}
              </span>
            </>
          }
        />
        <Stat
          label="Locations"
          value={
            <>
              {state.usage.locations}
              <span className="sub" style={{ fontSize: '.9rem', fontWeight: 400 }}>
                {' '}
                / {state.limits.maxLocations ?? '∞'}
              </span>
            </>
          }
        />
      </StatGrid>

      {/* The portal endpoint existed with nothing calling it, so a paying
          studio had no way to change its card or cancel. Trialing studios
          have no Stripe customer yet, so there is nothing to manage. */}
      {state.status !== 'TRIALING' && (
        <div className="toolbar">
          <button type="button" disabled={busy} onClick={() => void manageBilling()}>
            Manage billing — card, invoices, cancellation
          </button>
        </div>
      )}

      <h2>Plans</h2>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {plans.map((plan) => {
          const current = plan.id === state.plan && state.status !== 'TRIALING';

          return (
            <div
              key={plan.id}
              className="card"
              style={{
                borderColor: current ? 'var(--clay)' : undefined,
                borderWidth: current ? 2 : 1,
              }}
            >
              <h2 style={{ marginBottom: 2 }}>{plan.name}</h2>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                {money(plan.priceCentsMonthly)}
                <span className="sub" style={{ fontSize: '.85rem', fontWeight: 400 }}>
                  {' '}
                  / month
                </span>
              </div>
              <p className="sub" style={{ minHeight: 48 }}>{plan.blurb}</p>

              <ul className="sub" style={{ paddingLeft: 18, fontSize: '.84rem' }}>
                <li>{plan.maxStaff ?? 'Unlimited'} instructors</li>
                <li>{plan.maxLocations ?? 'Unlimited'} locations</li>
                {plan.mobileBookings && <li>Mobile and travelling bookings</li>}
                {plan.smsReminders && <li>Text reminders</li>}
                {plan.courseSeries && <li>Multi-week courses</li>}
              </ul>

              <button
                className={current ? undefined : 'primary'}
                disabled={busy || current}
                onClick={() => subscribe(plan.id)}
                style={{ width: '100%' }}
              >
                {current ? 'Current plan' : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* No per-booking fee and no cut of their revenue — the clearest thing
          we say against the incumbents, so it belongs on this page. */}
      <p className="sub" style={{ marginTop: 18 }}>
        No booking fees and no commission. What your customers pay goes
        straight to you.
      </p>
    </>
  );
}
