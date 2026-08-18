import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { LoadingRegion, SkeletonList } from '../components/states';

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

  if (!state) return (
      <LoadingRegion label="Loading your plan">
        <SkeletonList count={3} lines={3} />
      </LoadingRegion>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan and billing</h1>
          <p className="sub">
            You are on {state.planName}
            {state.trialDaysLeft !== null &&
              state.status === 'TRIALING' &&
              ` · ${state.trialDaysLeft} days left on your trial`}
          </p>
        </div>
      </div>

      {error && <div className="err">{error}</div>}
      {state.notice && (
        <div className={`alert ${state.notice.level === 'danger' ? 'danger' : 'warn'}`}>
          {state.notice.message}
        </div>
      )}

      <div className="stats">
        <div className="card stat">
          <div className="label">Instructors</div>
          <div className="value">
            {state.usage.staff}
            <span className="sub" style={{ fontSize: '.9rem', fontWeight: 400 }}>
              {' '}
              / {state.limits.maxStaff ?? '∞'}
            </span>
          </div>
        </div>
        <div className="card stat">
          <div className="label">Locations</div>
          <div className="value">
            {state.usage.locations}
            <span className="sub" style={{ fontSize: '.9rem', fontWeight: 400 }}>
              {' '}
              / {state.limits.maxLocations ?? '∞'}
            </span>
          </div>
        </div>
      </div>

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
