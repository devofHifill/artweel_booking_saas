import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, money } from './types';
import { LoadingRegion, SkeletonTable } from '../components/states';

type PlanRow = {
  id: string;
  name: string;
  priceCentsMonthly: number;
  blurb: string;
  maxStaff: number | null;
  maxLocations: number | null;
  studios: number;
  payingStudios: number;
  mrrCents: number;
  features: {
    key: string;
    label: string;
    included: boolean;
    enforced: boolean;
  }[];
};

type PlansOverview = {
  plans: PlanRow[];
  unenforced: { key: string; label: string }[];
  nearLimit: {
    id: string;
    name: string;
    planName: string;
    staff: number;
    limit: number | null;
  }[];
  history: {
    id: string;
    plan: string | null;
    actor: string;
    reason: string | null;
    changes: unknown;
    at: string;
  }[];
  enforcement: { boundary: string; behaviour: string; real: boolean }[];
  editable: boolean;
  featuresEditable: boolean;
};

/** A card's editable fields, as typed. Empty string means unlimited. */
type Draft = { price: string; staff: string; locations: string };

const draftOf = (p: PlanRow): Draft => ({
  price: String(p.priceCentsMonthly / 100),
  staff: p.maxStaff === null ? '' : String(p.maxStaff),
  locations: p.maxLocations === null ? '' : String(p.maxLocations),
});

/**
 * Plans and Limits — the one editable platform screen.
 *
 * WHAT EDITING A PRICE DOES, and what it does not: it moves the list price for
 * NEW subscriptions. Every existing subscriber keeps the price recorded on
 * their row when they subscribed, which is also what Stripe holds against their
 * subscription. The two stay in step, and the MRR on this page goes on
 * reporting money actually being billed rather than list price times a
 * headcount.
 *
 * Feature flags are shown but not editable: a toggle for a flag nothing reads
 * would be a control that does nothing. Three of the five are already in that
 * state, which the banner says out loud.
 */
export function PlatformPlans() {
  const [data, setData] = useState<PlansOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PlansOverview>('/api/platform/plans-overview')
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setDrafts(Object.fromEntries(res.plans.map((p) => [p.id, draftOf(p)])));
      })
      .catch(() => !cancelled && setError('Could not load plans.'));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  /*
    Which cards actually differ from what is stored. Only changed plans are
    saved: three audit rows saying "no change" would bury the one that mattered.
  */
  const dirty = (data?.plans ?? []).filter((p) => {
    const d = drafts[p.id];
    if (!d) return false;
    const base = draftOf(p);
    return (
      d.price !== base.price ||
      d.staff !== base.staff ||
      d.locations !== base.locations
    );
  });

  async function save() {
    if (dirty.length === 0 || reason.trim().length < 3) return;
    setSaving(true);
    setError(null);

    try {
      for (const plan of dirty) {
        const d = drafts[plan.id]!;
        await api.patch(`/api/platform/plans/${plan.id}`, {
          priceCentsMonthly: Math.round(Number(d.price) * 100),
          maxStaff: d.staff === '' ? null : Number(d.staff),
          maxLocations: d.locations === '' ? null : Number(d.locations),
          reason: reason.trim(),
        });
      }
      setSaved(
        `Saved ${dirty.length} plan${dirty.length === 1 ? '' : 's'}. Existing subscribers keep the price they agreed to.`,
      );
      setReason('');
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <div className="err">{error}</div>;
  if (!data)
    return (
      <LoadingRegion label="Loading plans">
        <SkeletonTable rows={4} />
      </LoadingRegion>
    );

  return (
    <>
      <div className="page-head">
        <h1>Plans &amp; Limits</h1>
        <span className="sub">
          Pricing and allowances. A price change affects new subscriptions only.
        </span>
      </div>

      {data.unenforced.length > 0 && (
        <div className="alert warn">
          <strong>
            {data.unenforced.length} advertised feature
            {data.unenforced.length === 1 ? '' : 's'} not enforced anywhere:
          </strong>{' '}
          {data.unenforced.map((f) => f.label).join(', ')}. A studio on any plan
          can use them.
        </div>
      )}

      {error && <div className="err">{error}</div>}
      {saved && <div className="alert">{saved}</div>}

      <div className="plan-grid">
        {data.plans.map((plan) => {
          const d = drafts[plan.id] ?? draftOf(plan);
          const set = (patch: Partial<Draft>) =>
            setDrafts((prev) => ({ ...prev, [plan.id]: { ...d, ...patch } }));

          return (
            <div className="card plan-card" key={plan.id}>
              <h2>{plan.name}</h2>

              <div className="plan-price-edit">
                <span>$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={d.price}
                  onChange={(e) => set({ price: e.target.value })}
                  aria-label={`${plan.name} price per month`}
                />
                <span className="sub">/month</span>
              </div>

              <p className="sub">{plan.blurb}</p>

              <dl className="plan-limits">
                <dt>Instructors</dt>
                <dd>
                  <input
                    type="number"
                    min={1}
                    value={d.staff}
                    placeholder="Unlimited"
                    onChange={(e) => set({ staff: e.target.value })}
                    aria-label={`${plan.name} instructor limit`}
                  />
                </dd>
                <dt>Locations</dt>
                <dd>
                  <input
                    type="number"
                    min={1}
                    value={d.locations}
                    placeholder="Unlimited"
                    onChange={(e) => set({ locations: e.target.value })}
                    aria-label={`${plan.name} location limit`}
                  />
                </dd>
                <dt>Studios on plan</dt>
                <dd>{plan.studios}</dd>
                <dt>Paying</dt>
                <dd>{plan.payingStudios}</dd>
                <dt>MRR</dt>
                <dd>{money(plan.mrrCents)}</dd>
              </dl>

              <ul className="plan-features">
                {plan.features.map((f) => (
                  <li key={f.key} className={f.included ? '' : 'off'}>
                    <span className="plan-mark">{f.included ? '✓' : '—'}</span>
                    <span>{f.label}</span>
                    {f.included && !f.enforced && (
                      <span
                        className="tag tag-warn"
                        title="Nothing checks this"
                      >
                        not enforced
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="sub plan-features-note">
                A blank limit means unlimited. Features are set in code.
              </p>
            </div>
          );
        })}
      </div>

      {/*
        The save bar appears only once something differs, and asks for a reason
        like every other consequential platform action — the current price
        cannot answer "who set it to this, and why".
      */}
      {dirty.length > 0 && (
        <div className="card plan-save">
          <div>
            <strong>
              {dirty.length} plan{dirty.length === 1 ? '' : 's'} changed:
            </strong>{' '}
            {dirty.map((p) => p.name).join(', ')}
            <p className="sub">
              New subscriptions only. Existing subscribers keep the price they
              agreed to, which is what Stripe still bills them.
            </p>
          </div>
          <input
            type="text"
            value={reason}
            placeholder="Reason (goes in the audit log)"
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason for the change"
          />
          <button
            className="ov-btn primary"
            onClick={save}
            disabled={saving || reason.trim().length < 3}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      <section className="ov-panels">
        <div className="card insight-panel">
          <div className="insight-head">
            <h2>Limit Enforcement</h2>
            <p className="sub">What happens at the boundary</p>
          </div>
          <dl className="revenue-rows">
            {data.enforcement.map((row) => (
              <Fragment key={row.boundary}>
                <dt>{row.boundary}</dt>
                <dd className="enforcement-behaviour">{row.behaviour}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="insight-note subtle">
            A downgrade is allowed even when the studio is over the new plan
            limits — it keeps what it has and simply cannot add more.
            Deactivating somebody&rsquo;s colleagues because a plan changed
            would be worse than the over-count.
          </p>
        </div>

        <div className="card insight-panel">
          <div className="insight-head">
            <h2>Studios Near a Limit</h2>
            <p className="sub">
              {data.nearLimit.length} at or one short of the instructor limit
            </p>
          </div>

          {data.nearLimit.length === 0 ? (
            <p className="sub insight-empty">
              No studio is close to its instructor limit.
            </p>
          ) : (
            <ul className="health-list">
              {data.nearLimit.map((s) => (
                <li key={s.id}>
                  <span className="health-label">{s.name}</span>
                  <span className="health-detail">
                    <span>
                      {s.staff}/{s.limit} instructors · {s.planName}
                    </span>
                    {/*
                      Links to the studio rather than changing the plan here: a
                      plan change needs a reason and a comp decision, and both
                      live on the studio screen that already does it properly.
                    */}
                    <Link to={`/admin/studios/${s.id}`}>Upgrade →</Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="card insight-panel">
        <div className="insight-head">
          <h2>Change history</h2>
          <p className="sub">Every plan edit, read back from the audit log</p>
        </div>

        {data.history.length === 0 ? (
          <p className="sub insight-empty">No plan has been changed yet.</p>
        ) : (
          <ul className="activity-list">
            {data.history.map((h) => (
              <li key={h.id}>
                <span className="activity-text">
                  <strong>
                    {h.plan} — {describeChange(h.changes)}
                  </strong>
                  <span className="sub">
                    {h.actor} · {dateTime(h.at)}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** "price $39 → $49, instructors 1 → 2", from the audit row's before/after. */
function describeChange(changes: unknown): string {
  const c = changes as {
    before?: Record<string, number | null>;
    after?: Record<string, number | null>;
  } | null;
  if (!c?.before || !c?.after) return 'changed';

  const label: Record<string, string> = {
    priceCentsMonthly: 'price',
    maxStaff: 'instructors',
    maxLocations: 'locations',
  };

  const parts: string[] = [];
  for (const key of Object.keys(label)) {
    const before = c.before[key];
    const after = c.after[key];
    if (before === after) continue;

    const fmt = (v: number | null | undefined) =>
      v === null || v === undefined
        ? 'unlimited'
        : key === 'priceCentsMonthly'
          ? money(v)
          : String(v);

    parts.push(`${label[key]} ${fmt(before)} → ${fmt(after)}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no effective change';
}
