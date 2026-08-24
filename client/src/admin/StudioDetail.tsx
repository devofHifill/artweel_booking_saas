import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { StatusTag } from './Studios';
import {
  dateTime,
  money,
  relativeDays,
  shortDate,
  type PlanId,
  type StudioDetailResponse,
} from './types';
import { LoadingRegion, SkeletonStats, SkeletonList } from '../components/states';

type ActionId =
  | 'trial'
  | 'plan'
  | 'comp'
  | 'suspend'
  | 'unsuspend'
  | 'support';

/**
 * One studio, and everything an operator can do to it.
 *
 * Every action requires a typed reason before it will submit — not an "Are you
 * sure?" that can be dismissed with one click, because the reason is the field
 * that makes the audit log worth keeping. "Who" and "what" are usually
 * recoverable from other evidence; "why" never is.
 */
export default function StudioDetail() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [data, setData] = useState<StudioDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ActionId | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      setData(await api.get<StudioDetailResponse>(
        `/api/platform/organizations/${organizationId}`,
      ));
    } catch {
      setError('Could not load that studio.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return (
      <LoadingRegion label="Loading this studio">
        <SkeletonStats />
        <SkeletonList count={2} lines={4} />
      </LoadingRegion>
    );

  const { studio, warnings, members, onboarding } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{studio.name}</h1>
          <span className="sub">
            {studio.slug} · {studio.timezone}
          </span>
        </div>
        <Link to="/admin/studios" className="sub">
          All studios
        </Link>
      </div>

      {/*
        Legal-but-consequential states, surfaced first. Every one of these is
        something an operator deliberately created, whose consequences arrive
        later and elsewhere — on a studio's card statement, or as a booking page
        that stayed dark after someone thought they had turned it back on.
      */}
      {warnings.map((warning) => (
        <div
          key={warning.code}
          className={`alert ${warning.code === 'NO_CONNECTED_PAYMENTS' ? 'warn' : 'danger'}`}
        >
          {warning.message}
        </div>
      ))}

      <section className="stats">
        <div className="card stat">
          <div className="label">Bookings</div>
          <div className="value">{studio.counts.bookings}</div>
        </div>
        <div className="card stat">
          <div className="label">Customers</div>
          <div className="value">{studio.counts.customers}</div>
        </div>
        <div className="card stat">
          <div className="label">Instructors</div>
          <div className="value">{studio.counts.staff}</div>
        </div>
        <div className="card stat">
          <div className="label">Last booking</div>
          <div className="value small">
            {studio.counts.lastBookingAt
              ? relativeDays(studio.counts.lastBookingAt)
              : 'never'}
          </div>
        </div>
      </section>

      <section className="cards-2">
        <div className="card">
          <h2>Subscription</h2>
          <dl className="detail-list">
            <Row label="Status">
              <StatusTag status={studio.subscriptionStatus} />
            </Row>
            <Row label="Plan">
              {studio.planDefinition.name} —{' '}
              {money(studio.planDefinition.priceCentsMonthly)}/mo
              {studio.compedAt && <span className="tag">comped</span>}
            </Row>
            <Row label="Trial ends">
              {studio.trialEndsAt
                ? `${shortDate(studio.trialEndsAt)} (${relativeDays(studio.trialEndsAt)})`
                : '—'}
            </Row>
            <Row label="Grace ends">{shortDate(studio.gracePeriodEndsAt)}</Row>
            <Row label="Current period ends">
              {shortDate(studio.currentPeriodEnd)}
            </Row>
            <Row label="Stripe subscription">
              {studio.billingSubscriptionId ?? <span className="muted">none</span>}
            </Row>
            <Row label="Signed up">
              {shortDate(studio.createdAt)}
              {studio.signupSource && ` via ${studio.signupSource}`}
            </Row>
          </dl>
        </div>

        <div className="card">
          <h2>Setup</h2>
          <ul className="list">
            {onboarding.steps.map((step) => (
              <li key={step.id} className="row-head">
                <span>
                  {step.title}
                  {step.optional && <span className="sub"> (optional)</span>}
                </span>
                <strong className={step.done ? 'ok' : 'muted'}>
                  {step.done ? 'done' : 'not yet'}
                </strong>
              </li>
            ))}
          </ul>
          <p className="sub" style={{ marginTop: 10 }}>
            Payments:{' '}
            {studio.stripeChargesEnabled
              ? 'charges enabled'
              : 'not connected — cannot take online payment'}
            {studio.stripePayoutsEnabled ? ', payouts enabled' : ''}
          </p>
          {onboarding.complete && (
            <p className="sub">
              Booking page:{' '}
              <a href={onboarding.bookingUrl} target="_blank" rel="noreferrer">
                {onboarding.bookingUrl}
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Team</h2>
        <ul className="list">
          {members.map((member) => (
            <li key={member.id} className="row-head">
              <span>
                {member.user.name}
                <div className="sub">
                  {member.user.email}
                  {!member.user.emailVerifiedAt && ' · unverified'}
                </div>
              </span>
              <strong>{member.role.toLowerCase().replace('_', ' ')}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Actions</h2>
        <p className="sub">
          Every action below is recorded in the audit log with the reason you
          give.
        </p>

        <div className="toolbar">
          <button onClick={() => setOpen(open === 'trial' ? null : 'trial')}>
            Extend trial
          </button>
          <button onClick={() => setOpen(open === 'plan' ? null : 'plan')}>
            Change plan
          </button>
          <button onClick={() => setOpen(open === 'comp' ? null : 'comp')}>
            {studio.compedAt ? 'Remove comp' : 'Comp this studio'}
          </button>
          <button onClick={() => setOpen(open === 'support' ? null : 'support')}>
            Look inside
          </button>
          {studio.suspendedByPlatformAt ? (
            <button
              className="primary"
              onClick={() => setOpen(open === 'unsuspend' ? null : 'unsuspend')}
            >
              Lift suspension
            </button>
          ) : (
            <button
              className="danger"
              onClick={() => setOpen(open === 'suspend' ? null : 'suspend')}
            >
              Suspend
            </button>
          )}
        </div>

        {open === 'trial' && (
          <ActionForm
            title="Extend the trial"
            note="Trials can only be extended, never shortened. To switch a studio off, suspend it."
            submitLabel="Extend trial"
            extraFields={(set) => (
              <label>
                New end date
                <input
                  type="date"
                  required
                  onChange={(e) => set({ extendTo: e.target.value })}
                />
              </label>
            )}
            onSubmit={(body) =>
              api.post(`/api/platform/organizations/${studio.id}/trial`, body)
            }
            onDone={() => {
              setOpen(null);
              void load();
            }}
          />
        )}

        {open === 'plan' && (
          <ActionForm
            title="Change the plan"
            note="Changes the plan only. It does not comp the account and does not touch Stripe."
            submitLabel="Change plan"
            initial={{ plan: studio.plan, comp: false }}
            extraFields={(set, values) => (
              <label>
                Plan
                <select
                  value={(values.plan as string) ?? studio.plan}
                  onChange={(e) => set({ plan: e.target.value as PlanId })}
                >
                  <option value="SOLO">Solo — $39</option>
                  <option value="STUDIO">Studio — $89</option>
                  <option value="PRO">Pro — $189</option>
                </select>
              </label>
            )}
            onSubmit={(body) =>
              api.post(`/api/platform/organizations/${studio.id}/plan`, body)
            }
            onDone={() => {
              setOpen(null);
              void load();
            }}
          />
        )}

        {open === 'comp' && (
          <ActionForm
            title={studio.compedAt ? 'Remove the comp' : 'Comp this studio'}
            /*
              Stated at the point of decision, not buried in a doc. Comping does
              not cancel the Stripe subscription, so an operator who is not told
              this here will believe the studio has stopped being charged.
            */
            note={
              studio.compedAt
                ? 'Stops marking the plan as free. Does not change Stripe and does not suspend anyone.'
                : 'This does NOT cancel their Stripe subscription. If they have one, their card keeps being charged until you cancel it in the Stripe dashboard.'
            }
            submitLabel={studio.compedAt ? 'Remove comp' : 'Comp studio'}
            initial={{ plan: studio.plan, comp: !studio.compedAt }}
            extraFields={(set, values) => (
              <label>
                Plan while comped
                <select
                  value={(values.plan as string) ?? studio.plan}
                  onChange={(e) => set({ plan: e.target.value as PlanId })}
                >
                  <option value="SOLO">Solo</option>
                  <option value="STUDIO">Studio</option>
                  <option value="PRO">Pro</option>
                </select>
              </label>
            )}
            onSubmit={(body) =>
              api.post(`/api/platform/organizations/${studio.id}/plan`, body)
            }
            onDone={() => {
              setOpen(null);
              void load();
            }}
          />
        )}

        {open === 'suspend' && (
          <ActionForm
            title="Suspend this studio"
            note="Their booking page stops taking new bookings. Nothing is deleted, existing bookings stand, and they keep read access. A successful payment will not lift this — only you can."
            submitLabel="Suspend studio"
            danger
            onSubmit={(body) =>
              api.post(`/api/platform/organizations/${studio.id}/suspend`, body)
            }
            onDone={() => {
              setOpen(null);
              void load();
            }}
          />
        )}

        {open === 'unsuspend' && (
          <ActionForm
            title="Lift the suspension"
            note="The studio returns to whatever billing says it should be — trialing if the trial is still running, active if they are paying or comped. If their trial already lapsed, they stay suspended for that reason."
            submitLabel="Lift suspension"
            onSubmit={(body) =>
              api.post(`/api/platform/organizations/${studio.id}/unsuspend`, body)
            }
            onDone={() => {
              setOpen(null);
              void load();
            }}
          />
        )}
        {open === 'support' && (
          <ActionForm
            title="Open a support session"
            note="Opens their dashboard as you, for 30 minutes, scoped to this studio only. The studio sees a banner naming you and this reason for as long as it lasts. Read-only unless you tick the box — and even with writes on, you cannot change who owns the studio."
            submitLabel="Open session"
            extraFields={(set) => (
              <label className="check">
                <input
                  type="checkbox"
                  onChange={(e) => set({ readOnly: !e.target.checked })}
                />
                <span>
                  Allow changes. Leave this off unless you are fixing something
                  they have asked you to fix.
                </span>
              </label>
            )}
            onSubmit={(body) =>
              api
                .post<{ accessToken: string }>(
                  `/api/platform/organizations/${studio.id}/support-sessions`,
                  { readOnly: true, ...body },
                )
                .then((res) => {
                  /*
                    Handed over in the FRAGMENT of the tab being opened, and
                    deliberately never written into this tab's storage.

                    Writing it to sessionStorage here was the first attempt and
                    it breaks the operator's own console: `tokens.access`
                    prefers a support token, so every /api/platform/* call this
                    surface makes would start presenting a token that cannot
                    reach it. The admin UI dies the moment you open a session.

                    The dashboard reads the fragment before React mounts and
                    strips it from the address bar — see `adoptSupportTokenFromUrl`,
                    which carries the full reasoning. A fragment never reaches
                    the server or a log.
                  */
                  window.open(
                    `/#support=${encodeURIComponent(res.accessToken)}`,
                    '_blank',
                    'noopener',
                  );
                })
            }
            onDone={() => setOpen(null)}
          />
        )}
      </section>

      <Integrations organizationId={studio.id} />

      <section className="card">
        <h2>History</h2>
        <p className="sub">
          <Link to={`/admin/audit?organizationId=${studio.id}`}>
            Everything ever done to this studio
          </Link>
        </p>
        {studio.suspendedByPlatformAt && (
          <p className="sub">
            Suspended {dateTime(studio.suspendedByPlatformAt)}
            {studio.suspendedReason && ` — ${studio.suspendedReason}`}
          </p>
        )}
      </section>
    </>
  );
}

// --- Integrations (S10) -----------------------------------------------------

type IntegrationStatus = {
  payments: {
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  };
  calendars: {
    staffId: string;
    staffName: string;
    connected: boolean;
    status: string | null;
    accountEmail: string | null;
    lastChangedAt: string | null;
  }[];
  sms: { available: boolean; optedOutCustomers: number };
};

/**
 * What this studio is plugged into, and the one thing support can do about it.
 *
 * Read-only apart from the disconnect, deliberately. Everything here is a fact
 * mirrored from somewhere else — Stripe's own verdict, a calendar connection's
 * status — and an operator who could edit those would be editing a cache of
 * another system's opinion.
 *
 * Loaded separately from the studio detail above rather than folded into it: a
 * calendar status is the thing most likely to have changed since the page was
 * opened, and it is the reason somebody is looking.
 */
function Integrations({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(
        await api.get<IntegrationStatus>(
          `/api/platform/organizations/${organizationId}/integrations`,
        ),
      );
    } catch {
      setError('Could not load integrations.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const wedged = status?.calendars.filter(
    (c) => c.connected && c.status !== 'ACTIVE',
  );

  return (
    <section className="card">
      <h2>Integrations</h2>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      {!status && !error && (
        <LoadingRegion label="Loading integrations">
          <SkeletonList count={1} lines={3} />
        </LoadingRegion>
      )}

      {status && (
        <>
          <dl className="detail-list">
            <Row label="Payments">
              {status.payments.connected ? (
                <>
                  Stripe connected
                  {!status.payments.chargesEnabled && (
                    <span className="tag off"> charges disabled</span>
                  )}
                  {!status.payments.payoutsEnabled && (
                    <span className="tag off"> payouts disabled</span>
                  )}
                </>
              ) : (
                <span className="muted">not connected</span>
              )}
            </Row>
            <Row label="Messaging">
              {status.sms.available ? 'SMS available' : 'SMS not configured'}
              {status.sms.optedOutCustomers > 0 && (
                <span className="tiny muted">
                  {' '}
                  · {status.sms.optedOutCustomers} opted out
                </span>
              )}
            </Row>
          </dl>

          <h3>Calendars</h3>
          {status.calendars.length === 0 ? (
            <p className="sub">No active instructors.</p>
          ) : (
            <table className="admin-table">
              <tbody>
                {status.calendars.map((calendar) => (
                  <tr key={calendar.staffId}>
                    <td>
                      <strong>{calendar.staffName}</strong>
                      {calendar.accountEmail && (
                        <div className="tiny muted">{calendar.accountEmail}</div>
                      )}
                    </td>
                    <td>
                      {!calendar.connected ? (
                        <span className="tiny muted">not connected</span>
                      ) : calendar.status === 'ACTIVE' ? (
                        <span className="tag">syncing</span>
                      ) : (
                        <span className="tag off">
                          {calendar.status?.toLowerCase().replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td>
                      {calendar.connected && (
                        <button
                          onClick={() => setDisconnecting(calendar.staffId)}
                        >
                          Disconnect
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {wedged && wedged.length > 0 && (
            <p className="sub">
              A wedged connection usually clears by disconnecting it here and
              asking the instructor to reconnect from their own Integrations
              screen. Nothing else of theirs is affected.
            </p>
          )}

          {disconnecting && (
            <ActionForm
              title="Disconnect this calendar"
              note="Their calendar stops syncing and the times it had mirrored in are cleared, so they are bookable again. They reconnect it themselves from their own Integrations screen — you cannot do that for them."
              submitLabel="Disconnect"
              danger
              onSubmit={(body) =>
                api.post(
                  `/api/platform/organizations/${organizationId}/integrations/calendar/${disconnecting}/disconnect`,
                  body,
                )
              }
              onDone={() => {
                setDisconnecting(null);
                void load();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

const MIN_REASON = 8;

/**
 * The reason field, and whatever else an action needs.
 *
 * The submit button stays disabled until the reason is long enough, matching the
 * server's rule rather than discovering it as a 422. An operator who can satisfy
 * the field with one character will, and then the log records that somebody typed
 * a character.
 */
function ActionForm({
  title,
  note,
  submitLabel,
  danger,
  initial = {},
  extraFields,
  onSubmit,
  onDone,
}: {
  title: string;
  note: string;
  submitLabel: string;
  danger?: boolean;
  initial?: Record<string, unknown>;
  extraFields?: (
    set: (patch: Record<string, unknown>) => void,
    values: Record<string, unknown>,
  ) => React.ReactNode;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Record<string, unknown>) =>
    setValues((current) => ({ ...current, ...patch }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await onSubmit({ ...values, reason: reason.trim() });
      onDone();
    } catch (err) {
      /*
        The server's refusal is shown verbatim. It knows things this screen does
        not — that a trial cannot be shortened, that a studio is already
        suspended — and paraphrasing it here would mean two places to keep
        correct.
      */
      setError(err instanceof ApiError ? err.message : 'That did not work.');
      setBusy(false);
    }
  }

  return (
    <form className="action-form" onSubmit={submit}>
      <h3>{title}</h3>
      <p className="sub">{note}</p>

      {error && <div className="err">{error}</div>}

      <div className="fields">
        {extraFields?.(set, values)}

        <label>
          Reason (recorded in the audit log)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. owner asked on ticket #42"
            minLength={MIN_REASON}
            required
          />
        </label>
      </div>

      <div className="toolbar">
        <button
          type="submit"
          className={danger ? 'danger' : 'primary'}
          disabled={busy || reason.trim().length < MIN_REASON}
        >
          {busy ? 'Working…' : submitLabel}
        </button>
        {reason.trim().length > 0 && reason.trim().length < MIN_REASON && (
          <span className="sub">
            A few more characters — the reason has to mean something later.
          </span>
        )}
      </div>
    </form>
  );
}
