import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  Kpi,
  Modal,
  PageHead,
  SegRange,
  StatusPill,
} from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonTable } from '../components/states';
import { WorkingHours } from '../components/working-hours';
import { Icon } from '../components/Icon';
import { StaffSchedule } from '../components/StaffSchedule';

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

type StaffAvailability =
  | 'AVAILABLE'
  | 'AWAY_TODAY'
  | 'NO_HOURS'
  | 'INACTIVE';

type StaffRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Job title, shown under the name. Free text, often empty. */
  role: string | null;
  color: string;
  isPublic: boolean;
  isActive: boolean;
  maxBookingsPerDay: number;
  /** Derived on the server from real working hours. Never stored. */
  availability: StaffAvailability;
  awayReason: string | null;
  stats: { upcoming: number; classesTaught: number; seatsTaught: number };
  staffServices: { serviceType: { id: string; name: string } }[];
};

/**
 * The badge, and what each state means.
 *
 * NO_HOURS is deliberately alarming. It is not a neutral third state — it
 * means this person cannot be booked at all, by anybody, and the studio has
 * no other way to find that out.
 */
const AVAILABILITY: Record<
  StaffAvailability,
  { label: string; tone: string }
> = {
  AVAILABLE: { label: 'Available', tone: 'CONFIRMED' },
  AWAY_TODAY: { label: 'Away today', tone: 'PENDING' },
  NO_HOURS: { label: 'No hours set', tone: 'NO_SHOW' },
  INACTIVE: { label: 'Deactivated', tone: 'EXPIRED' },
};

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'AWAY_TODAY', label: 'Away today' },
  { value: 'NO_HOURS', label: 'No hours set' },
  { value: 'INACTIVE', label: 'Deactivated' },
] as const;

/** Two letters for the avatar. First and last word — see Customers. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (
    parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')
  ).toUpperCase();
}

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
  role: '',
  color: '#a6522c',
  isPublic: true,
  maxBookingsPerDay: 0,
};

export default function Staff() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  /*
    Everyone is fetched and the filtering happens here, because the statuses
    the filter offers are DERIVED on the server and there is nothing to query
    on. A studio's team is tens of people, not thousands.
  */
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  /** Whose schedule is open, if anyone's. */
  const [scheduleFor, setScheduleFor] = useState<StaffRow | null>(null);
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
      /* Always including deactivated: the filter above the list offers
         "Deactivated" as a choice, and a filter that cannot show you what it
         names is worse than not offering it. */
      const res = await api.get<{ staff: StaffRow[] }>(
        `${base}/staff?includeInactive=true`,
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
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Null while loading, so the empty state does not flash before the first
     response arrives. */
  const visible =
    staff === null
      ? null
      : statusFilter
        ? staff.filter((row) => row.availability === statusFilter)
        : staff;

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
      role: row.role ?? '',
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
      role: form.role.trim() || null,
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
          <>
            <select
              value={statusFilter}
              aria-label="Filter by status"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <SegRange
              label="How to show the team"
              options={[
                { value: 'cards', label: 'Cards' },
                { value: 'table', label: 'Table' },
              ]}
              value={view}
              onChange={setView}
            />
            {isAdmin && (
              <button
                className="primary"
                onClick={() => (editing ? setEditing(null) : startCreate())}
              >
                {editing ? 'Close' : (
                  <>
                    <Icon name="plus" /> Add staff
                  </>
                )}
              </button>
            )}
          </>
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


      {error && <div className="err">{error}</div>}
      {notice && (
        <div className="alert warn" role="status">
          {notice}
        </div>
      )}

      {scheduleFor && (
        <Modal
          title={`${scheduleFor.name}'s schedule`}
          subtitle={
            scheduleFor.stats.upcoming === 1
              ? '1 class still to teach'
              : `${scheduleFor.stats.upcoming} classes still to teach`
          }
          onClose={() => setScheduleFor(null)}
        >
          <StaffSchedule
            base={base}
            staffId={scheduleFor.id}
            onClose={() => setScheduleFor(null)}
          />
        </Modal>
      )}

      {hoursFor && (
        <WorkingHours
          base={base}
          staff={hoursFor}
          canEditHours={isAdmin}
          canEditExceptions={isAdmin}
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
              Role
              <input
                value={form.role}
                maxLength={80}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Wheel instructor"
              />
              {/* Distinct from the public bio, which is prose. This is the
                  line under a name on a card. */}
              <span className="tiny muted">
                Two or three words. Shown on their card, not on your booking
                page.
              </span>
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

      {visible && visible.length === 0 && (
        <EmptyState
          icon="◍"
          hint={
            statusFilter
              ? 'Try a different status.'
              : isAdmin
                ? 'Add someone to start scheduling classes.'
                : undefined
          }
        >
          {statusFilter ? 'Nobody matches that status.' : 'Nobody on the team yet.'}
        </EmptyState>
      )}

      {visible && visible.length > 0 && view === 'cards' && (
        <div className="staff-grid">
          {visible.map((row) => (
            <StaffCard
              key={row.id}
              row={row}
              canEdit={isAdmin}
              onEdit={() => startEdit(row)}
              onSchedule={() => setScheduleFor(row)}
            />
          ))}
        </div>
      )}

      {visible && visible.length > 0 && view === 'table' && (
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
            {visible.map((row) => (
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
                  <StatusPill status={AVAILABILITY[row.availability].tone}>
                    {AVAILABILITY[row.availability].label}
                  </StatusPill>
                  {/* The reason, when the studio typed one on the day off.
                      "Away today" without it sends somebody to the calendar
                      to find out what everyone already knows. */}
                  {row.awayReason && (
                    <div className="sub tiny">{row.awayReason}</div>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <div className="row-actions">
                      <button
                        className="link"
                        onClick={() => setScheduleFor(row)}
                      >
                        Schedule
                      </button>
                      <button className="link" onClick={() => startEdit(row)}>
                        Edit
                      </button>
                      {/* Distinct from Schedule, and the distinction matters:
                          Schedule is what they are down to teach, Hours is
                          when they are willing to. */}
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

/**
 * One instructor, as a card.
 *
 * The prototype's card carries a guest rating; this one does not, because
 * Artweel has no reviews — nothing anywhere collects guest feedback, so any
 * number in that slot would be invented and would read as earned. The two
 * tiles hold figures the product can actually stand behind, and the slot is
 * still there if ratings are ever built.
 *
 * "Not bookable yet" and "No hours set" are the two states worth spotting
 * from across the grid, and they are different faults with the same symptom:
 * one is nothing to teach, the other is no time to teach it. Both make the
 * person invisible to customers with no error anywhere.
 */
function StaffCard({
  row,
  canEdit,
  onEdit,
  onSchedule,
}: {
  row: StaffRow;
  canEdit: boolean;
  onEdit: () => void;
  onSchedule: () => void;
}) {
  const teaches = row.staffServices.map((s) => s.serviceType.name);

  return (
    <article className={`staff-card${row.isActive ? '' : ' is-inactive'}`}>
      <header className="staff-card-head">
        {/* The calendar colour, which is how this person is recognised on the
            schedule. Carrying it here means the card and the calendar agree. */}
        <span className="avatar lg" style={{ background: row.color }} aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="staff-card-id">
          <b>{row.name}</b>
          {/*
            Rendered even when there is no role, so the line is RESERVED. Most
            studios fill this in for some people and not others, and without
            the empty element those cards' badges and stat tiles sit a line
            higher than their neighbours' — a grid where nothing lines up
            across a row reads as broken rather than as varied.
          */}
          <div className="sub">{row.role}</div>
          <div className="staff-card-badge">
            <StatusPill status={AVAILABILITY[row.availability].tone}>
              {AVAILABILITY[row.availability].label}
            </StatusPill>
          </div>
        </div>
      </header>

      <div className="staff-tiles">
        <div className="stat-tile">
          <div className="l">Upcoming</div>
          <div className="v">{row.stats.upcoming}</div>
        </div>
        <div className="stat-tile">
          <div className="l">Classes taught</div>
          <div className="v">{row.stats.classesTaught}</div>
        </div>
      </div>

      <p className="staff-card-teaches tiny muted">
        {teaches.length > 0 ? teaches.join(' · ') : <NotBookable />}
      </p>

      <footer className="staff-card-foot">
        <span className="tiny muted">
          {row.stats.seatsTaught === 1
            ? '1 place taught'
            : `${row.stats.seatsTaught} places taught`}
        </span>
        <span className="row-actions">
          <button
            type="button"
            className="icon-btn"
            title={`${row.name}'s schedule`}
            aria-label={`${row.name}'s schedule`}
            onClick={onSchedule}
          >
            <Icon name="calendar" size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              className="icon-btn"
              title={`Edit ${row.name}`}
              aria-label={`Edit ${row.name}`}
              onClick={onEdit}
            >
              <Icon name="edit" size={14} />
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}
