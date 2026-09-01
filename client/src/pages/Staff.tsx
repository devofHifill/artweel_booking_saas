import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { DataTable, Kpi, PageHead, StatusPill, Toolbar } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonTable } from '../components/states';

/**
 * Staff & Guides.
 *
 * The server module for this shipped complete — create, update, deactivate,
 * qualify for services — and there was never a page. Every instructor in every
 * studio had to be inserted by hand or by the seed. This is that page; no new
 * endpoints were needed.
 *
 * The important behaviour is what happens when somebody tries to delete an
 * instructor who has taught: the API refuses with 409 STAFF_IN_USE, because
 * deleting them would orphan booking history. That is correct, and it is also
 * the exact moment a raw error message would send an owner to support. The
 * refusal is turned into the offer the API text already suggests.
 */

type StaffRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  color: string;
  isPublic: boolean;
  isActive: boolean;
  maxBookingsPerDay: number;
  staffServices: { serviceType: { id: string; name: string } }[];
};

type ServiceOption = { id: string; name: string };

/** The four figures above the list. See `getRotaSummary` on the server. */
type Rota = {
  team: number;
  teachingToday: number;
  classesThisWeek: number;
  unassignedThisWeek: number;
};

const BLANK = {
  name: '',
  email: '',
  phone: '',
  color: '#a6522c',
  isPublic: true,
  maxBookingsPerDay: 0,
};

/**
 * Working hours.
 *
 * `/schedules/:staffId/rules` has existed since W1 — list, create, delete, with
 * `requireAdmin` on the writes — and nothing in the client ever called it. The
 * onboarding wizard creates ONE rule, Tuesday to Saturday 10:00–18:00, for the
 * FIRST instructor, and `POST /staff` takes no hours at all.
 *
 * So everyone hired afterwards had no working window, and availability is built
 * by filtering `rule_type === 'WORKING'` per person: no rule, no windows, no
 * bookable slots, ever. A studio could add an instructor, qualify them to teach,
 * put them on the rota, and never understand why nobody could book them.
 *
 * That is why the panel leads with the warning rather than the form.
 */
type Rule = {
  id: string;
  ruleType: 'WORKING' | 'BREAK';
  rrule: string;
  startMinute: number;
  endMinute: number;
  timezone: string;
};

/**
 * A single dated exception to the weekly pattern.
 *
 * `startMinute`/`endMinute` are null for a DAY_OFF and required for the other
 * two — the server enforces both halves of that, so the form follows the same
 * shape rather than sending a window it will be told off for.
 */
type Override = {
  id: string;
  overrideType: 'DAY_OFF' | 'CUSTOM_HOURS' | 'EXTRA_HOURS';
  localDate: string;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
};

const OVERRIDE_LABELS: Record<Override['overrideType'], string> = {
  DAY_OFF: 'Day off',
  CUSTOM_HOURS: 'Different hours',
  EXTRA_HOURS: 'Extra hours',
};

const DAYS = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
] as const;

/** Minutes past local midnight, which is how the column stores it. */
function toTime(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toMinutes(value: string) {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** `FREQ=WEEKLY;BYDAY=TU,TH` → ['TU','TH']. */
function daysOf(rrule: string): string[] {
  const match = /BYDAY=([A-Z,]+)/.exec(rrule);
  return match ? match[1]!.split(',') : [];
}

function describe(rule: Rule) {
  const codes = daysOf(rule.rrule);
  const names = DAYS.filter((d) => codes.includes(d.code)).map((d) => d.label);
  const when = names.length ? names.join(', ') : 'Every day';
  return `${when} · ${toTime(rule.startMinute)}–${toTime(rule.endMinute)}`;
}

export default function Staff() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [rota, setRota] = useState<Rota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  /** Whose hours are open, if anyone's. Its own panel, not part of the edit form. */
  const [hoursFor, setHoursFor] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ staff: StaffRow[] }>(
        `${base}/staff?includeInactive=${includeInactive}`,
      );
      setStaff(res.staff);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your team.');
    }

    /*
      The rota figures, fetched separately and allowed to fail on their own.
      They decorate the page; the list below is the page. An error here must
      not replace a working team list with a banner.
    */
    try {
      setRota(await api.get<Rota>(`${base}/staff/summary`));
    } catch {
      /* Tiles stay hidden. */
    }
  }, [base, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ services: ServiceOption[] }>(`${base}/services`)
      .then((res) => setServices(res.services))
      .catch(() => {
        // The list still works; only the "teaches" picker is unavailable.
      });
  }, [base]);

  function startCreate() {
    setEditing('new');
    setForm({ ...BLANK });
  }

  function startEdit(row: StaffRow) {
    setEditing(row.id);
    setForm({
      name: row.name,
      email: row.email,
      phone: row.phone ?? '',
      color: row.color,
      isPublic: row.isPublic,
      maxBookingsPerDay: row.maxBookingsPerDay,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      // Empty means "not recorded", which is null — not an empty string that
      // renders as a blank phone number on the public page.
      phone: form.phone.trim() || null,
      color: form.color,
      isPublic: form.isPublic,
      maxBookingsPerDay: Number(form.maxBookingsPerDay) || 0,
    };

    try {
      if (editing === 'new') await api.post(`${base}/staff`, body);
      else await api.patch(`${base}/staff/${editing}`, body);

      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function setActive(row: StaffRow, isActive: boolean) {
    setBusy(true);
    try {
      await api.patch(`${base}/staff/${row.id}`, { isActive });
      setNotice(
        isActive
          ? `${row.name} is teaching again.`
          : `${row.name} is deactivated and will not appear in availability.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Delete, and the refusal that matters.
   *
   * An instructor with booking history cannot be removed — the API answers 409
   * STAFF_IN_USE and says to deactivate instead. Showing that sentence as a red
   * error would leave the owner reading an explanation with nothing to click.
   * Catching the specific code turns it into the action the message describes.
   */
  async function remove(row: StaffRow) {
    if (!confirm(`Remove ${row.name}?`)) return;

    setBusy(true);
    setError(null);

    try {
      await api.del(`${base}/staff/${row.id}`);
      setNotice(`${row.name} was removed.`);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STAFF_IN_USE') {
        const deactivate = confirm(
          `${row.name} has taught classes, so their record has to be kept.\n\n` +
            `Deactivate them instead? They stop appearing in availability and on ` +
            `your booking page, and their history stays intact.`,
        );
        if (deactivate) await setActive(row, false);
      } else {
        setError(err instanceof Error ? err.message : 'Could not remove.');
      }
    } finally {
      setBusy(false);
    }
  }

  /** Which classes this person is qualified to teach. */
  async function toggleService(row: StaffRow, serviceId: string) {
    const current = row.staffServices.map((s) => s.serviceType.id);
    const next = current.includes(serviceId)
      ? current.filter((id) => id !== serviceId)
      : [...current, serviceId];

    setBusy(true);
    try {
      await api.put(`${base}/staff/${row.id}/services`, { serviceTypeIds: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update classes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Staff &amp; Guides"
        lede="Who teaches, what they teach, and who your customers can see."
        actions={
          isAdmin && (
            <button onClick={() => (editing ? setEditing(null) : startCreate())}>
              {editing ? 'Close' : 'Add someone'}
            </button>
          )
        }
      />

      {/*
        Is the week covered? These four say so before anybody reads a row.
        "Unassigned" is the one worth acting on — a class with nobody assigned
        is a class nobody has been told to teach, which is the same signal the
        dashboard's attention list carries.
      */}
      {rota && (
        <div className="kpis">
          <Kpi label="Team members" value={String(rota.team)} icon="staff" />
          <Kpi
            label="Teaching today"
            value={String(rota.teachingToday)}
            tone="green"
            icon="today"
          />
          <Kpi
            label="Classes this week"
            value={String(rota.classesThisWeek)}
            tone="violet"
            icon="calendar"
          />
          <Kpi
            label="Unassigned this week"
            value={String(rota.unassignedThisWeek)}
            tone={rota.unassignedThisWeek > 0 ? 'amber' : undefined}
            icon="health"
          />
        </div>
      )}

      <Toolbar>
        <label className="check">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show deactivated
        </label>
      </Toolbar>

      {error && <div className="err">{error}</div>}
      {notice && (
        <div className="alert warn" role="status">
          {notice}
        </div>
      )}

      {hoursFor && (
        <WorkingHours
          base={base}
          staff={hoursFor}
          canEdit={isAdmin}
          onClose={() => setHoursFor(null)}
        />
      )}

      {editing && isAdmin && (
        <form className="card schedule" onSubmit={(e) => void save(e)}>
          <h2>{editing === 'new' ? 'Add someone' : 'Edit'}</h2>

          <div className="fields">
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={120}
              />
            </label>

            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>

            <label>
              Phone
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional"
              />
            </label>

            <label>
              Calendar colour
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </label>

            <label>
              Max bookings a day
              <input
                type="number"
                min={0}
                max={100}
                value={form.maxBookingsPerDay}
                onChange={(e) =>
                  setForm({ ...form, maxBookingsPerDay: Number(e.target.value) })
                }
              />
              <span className="sub">0 means no limit.</span>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
              />
              Show on the booking page
            </label>
          </div>

          <div className="toolbar">
            <button className="primary" disabled={busy}>
              {editing === 'new' ? 'Add' : 'Save'}
            </button>
            <button type="button" className="link" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!staff && !error && (
        <LoadingRegion label="Loading your team">
          <SkeletonTable rows={4} cols={5} />
        </LoadingRegion>
      )}

      {staff && staff.length === 0 && (
        <EmptyState
          icon="◍"
          hint={isAdmin ? 'Add someone to start scheduling classes.' : undefined}
        >
          Nobody on the team yet.
        </EmptyState>
      )}

      {staff && staff.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Instructors, with what they teach and whether customers can see them"
            head={
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Teaches</th>
                <th>On booking page</th>
                <th>Status</th>
                {isAdmin && <th style={{ width: 200 }} />}
              </tr>
            }
          >
            {staff.map((row) => (
              <tr key={row.id} className={row.isActive ? '' : 'row-inactive'}>
                <td>
                  <span className="staff-name">
                    <span
                      className="staff-dot"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                    {row.name}
                  </span>
                </td>
                <td>
                  {row.email}
                  {row.phone && <div className="sub tiny">{row.phone}</div>}
                </td>
                <td>
                  <Teaches
                    row={row}
                    services={services}
                    canEdit={isAdmin && row.isActive}
                    busy={busy}
                    onToggle={(serviceId) => void toggleService(row, serviceId)}
                  />
                </td>
                <td>
                  {row.isPublic ? (
                    <StatusPill status="CONFIRMED">Visible</StatusPill>
                  ) : (
                    <StatusPill status="CANCELLED">Hidden</StatusPill>
                  )}
                </td>
                <td>
                  {row.isActive ? (
                    <StatusPill status="ACTIVE">Active</StatusPill>
                  ) : (
                    <StatusPill status="EXPIRED">Deactivated</StatusPill>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          setHoursFor({ id: row.id, name: row.name })
                        }
                      >
                        Hours
                      </button>
                      {row.isActive ? (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => void setActive(row, false)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => void setActive(row, true)}
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        className="link danger"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </>
  );
}

function WorkingHours({
  base,
  staff,
  canEdit,
  onClose,
}: {
  base: string;
  staff: { id: string; name: string };
  canEdit: boolean;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [days, setDays] = useState<string[]>(['TU', 'WE', 'TH', 'FR', 'SA']);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('18:00');

  const [overrides, setOverrides] = useState<Override[]>([]);
  const [oType, setOType] = useState<Override['overrideType']>('DAY_OFF');
  const [oDate, setODate] = useState('');
  const [oStart, setOStart] = useState('10:00');
  const [oEnd, setOEnd] = useState('14:00');
  const [oReason, setOReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ruleRes, overrideRes] = await Promise.all([
        api.get<{ rules: Rule[] }>(`${base}/schedules/${staff.id}/rules`),
        // From today: a day off last March is history, not something anyone is
        // about to change, and the list is for deciding what happens next.
        api.get<{ overrides: Override[] }>(
          `${base}/schedules/${staff.id}/overrides?from=${new Date()
            .toISOString()
            .slice(0, 10)}`,
        ),
      ]);
      setRules(ruleRes.rules);
      setOverrides(overrideRes.overrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load hours.');
    }
  }, [base, staff.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const working = (rules ?? []).filter((r) => r.ruleType === 'WORKING');

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/schedules/${staff.id}/rules`, {
        ruleType: 'WORKING',
        // BYDAY omitted entirely would mean "every day", which is a different
        // rule from "no days chosen" — so the button is disabled instead.
        rrule: `FREQ=WEEKLY;BYDAY=${days.join(',')}`,
        startMinute: toMinutes(start),
        endMinute: toMinutes(end),
        // No timezone: the server falls back to the instructor's own, which is
        // what keeps a studio spanning two zones correct.
        effectiveFrom: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(ruleId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.del(`${base}/schedules/${staff.id}/rules/${ruleId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  async function addOverride() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/schedules/${staff.id}/overrides`, {
        overrideType: oType,
        localDate: oDate,
        // A day off must carry NO window; the other two must carry one. The
        // server rejects either mistake, so the shape is decided here.
        startMinute: oType === 'DAY_OFF' ? null : toMinutes(oStart),
        endMinute: oType === 'DAY_OFF' ? null : toMinutes(oEnd),
        reason: oReason.trim() || null,
      });
      setODate('');
      setOReason('');
      await load();
    } catch (err) {
      /*
        Worth showing verbatim. Marking a day off over live bookings is refused
        and the message says how many are in the way — which is the number the
        person needs in order to decide what to do next.
      */
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(overrideId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.del(`${base}/schedules/${staff.id}/overrides/${overrideId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card schedule">
      <h2>When {staff.name} works</h2>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      {rules && working.length === 0 && (
        <div className="alert warn" role="status">
          <strong>{staff.name} cannot be booked.</strong> Availability is built
          from working hours, and there are none — so no slot ever appears for
          them, however many classes they are qualified to teach. Add a pattern
          below.
        </div>
      )}

      {!rules && (
        <LoadingRegion label="Loading hours">
          <SkeletonTable rows={2} />
        </LoadingRegion>
      )}

      {working.length > 0 && (
        <ul className="mini-list">
          {working.map((rule) => (
            <li key={rule.id} className="mini-row">
              <span className="mini-main">
                <b>{describe(rule)}</b>
                <span className="tiny muted">{rule.timezone}</span>
              </span>
              {canEdit && (
                <button
                  className="link danger"
                  disabled={busy}
                  onClick={() => void remove(rule.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <hr />
          <div className="fields">
            {/*
              role="group" rather than a fieldset: nothing else in this client
              uses fieldset/legend, and unstyled they arrive with a browser
              border and an inset caption that match none of the surrounding
              forms. The grouping still reaches a screen reader.
            */}
            <div className="setting-stack" role="group" aria-label="Working days">
              <span className="tiny muted">Days</span>
              {/* `.days` already exists for a wrapping row of day controls.
                  `.row`, used elsewhere in this codebase, has no rule at all. */}
              <div className="days">
                {DAYS.map((d) => (
                  <label key={d.code} className="check">
                    <input
                      type="checkbox"
                      checked={days.includes(d.code)}
                      onChange={(e) =>
                        setDays((prev) =>
                          e.target.checked
                            ? [...prev, d.code]
                            : prev.filter((c) => c !== d.code),
                        )
                      }
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>

            <label>
              From
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>

            <label>
              Until
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          <p className="tiny muted">
            Patterns add together, so a split week is two of them — Tuesday to
            Thursday mornings, Saturday afternoons.
          </p>

          <div className="page-actions">
            <button
              className="primary"
              disabled={
                busy || days.length === 0 || toMinutes(end) <= toMinutes(start)
              }
              onClick={() => void add()}
            >
              {busy ? 'Saving…' : 'Add these hours'}
            </button>
          </div>
        </>
      )}

      <hr />

      <h3>Days off and exceptions</h3>
      <p className="tiny muted">
        One date at a time, on top of the weekly pattern. A day off over a live
        booking is refused rather than silently stranding the customer.
      </p>

      {overrides.length > 0 ? (
        <ul className="mini-list">
          {overrides.map((o) => (
            <li key={o.id} className="mini-row">
              <span className="mini-main">
                <b>
                  {o.localDate} · {OVERRIDE_LABELS[o.overrideType]}
                  {o.startMinute != null && o.endMinute != null && (
                    <>
                      {' '}
                      · {toTime(o.startMinute)}–{toTime(o.endMinute)}
                    </>
                  )}
                </b>
                {o.reason && <span className="tiny muted">{o.reason}</span>}
              </span>
              {canEdit && (
                <button
                  className="link danger"
                  disabled={busy}
                  onClick={() => void removeOverride(o.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny muted">Nothing coming up.</p>
      )}

      {canEdit && (
        <>
          <div className="fields">
            <label>
              What
              <select
                value={oType}
                onChange={(e) =>
                  setOType(e.target.value as Override['overrideType'])
                }
              >
                <option value="DAY_OFF">Day off</option>
                <option value="CUSTOM_HOURS">Different hours</option>
                <option value="EXTRA_HOURS">Extra hours</option>
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={oDate}
                onChange={(e) => setODate(e.target.value)}
              />
            </label>

            {oType !== 'DAY_OFF' && (
              <>
                <label>
                  From
                  <input
                    type="time"
                    value={oStart}
                    onChange={(e) => setOStart(e.target.value)}
                  />
                </label>
                <label>
                  Until
                  <input
                    type="time"
                    value={oEnd}
                    onChange={(e) => setOEnd(e.target.value)}
                  />
                </label>
              </>
            )}

            <label>
              Reason
              <input
                value={oReason}
                maxLength={500}
                placeholder="Optional — kiln repair, holiday"
                onChange={(e) => setOReason(e.target.value)}
              />
            </label>
          </div>

          <div className="page-actions">
            <button
              className="primary"
              disabled={
                busy ||
                !oDate ||
                (oType !== 'DAY_OFF' && toMinutes(oEnd) <= toMinutes(oStart))
              }
              onClick={() => void addOverride()}
            >
              {busy ? 'Saving…' : 'Add exception'}
            </button>
          </div>
        </>
      )}

      <hr />

      <div className="page-actions">
        <button onClick={onClose} disabled={busy}>
          Done
        </button>
      </div>
    </section>
  );
}

/**
 * What this person is qualified to teach.
 *
 * Rendered as toggle chips rather than a multi-select, because the answer is
 * usually two or three out of a handful and a select box hides the current state
 * behind a click. Each toggle is a save — there is no draft to lose.
 */
function Teaches({
  row,
  services,
  canEdit,
  busy,
  onToggle,
}: {
  row: StaffRow;
  services: ServiceOption[];
  canEdit: boolean;
  busy: boolean;
  onToggle: (serviceId: string) => void;
}) {
  const assigned = new Set(row.staffServices.map((s) => s.serviceType.id));

  if (!canEdit) {
    if (assigned.size === 0) return <NotBookable />;
    return (
      <span className="chips">
        {row.staffServices.map((s) => (
          <span className="chip on" key={s.serviceType.id}>
            {s.serviceType.name}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="chips">
      {services.map((service) => (
        <button
          type="button"
          key={service.id}
          className={`chip ${assigned.has(service.id) ? 'on' : ''}`.trim()}
          aria-pressed={assigned.has(service.id)}
          disabled={busy}
          onClick={() => onToggle(service.id)}
        >
          {service.name}
        </button>
      ))}
      {assigned.size === 0 && <NotBookable />}
    </span>
  );
}

/**
 * An instructor with no classes assigned is bookable for nothing.
 *
 * This is not a guess about the UI — both the availability engine
 * (`availability.service.ts:208`) and the public instructor list filter on
 * `staffServices: { some: … }`, so an empty qualification set matches no service
 * at all. Somebody added to the team and never qualified simply never appears,
 * with no error anywhere to explain it.
 *
 * An empty cell would read as "nothing recorded yet". This says what it actually
 * means, because it is the difference between a tidy record and an instructor
 * nobody can book.
 */
function NotBookable() {
  return (
    <span className="not-bookable" title="Pick at least one class to make this person bookable">
      Not bookable yet
    </span>
  );
}
