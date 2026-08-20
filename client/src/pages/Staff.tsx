import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { DataTable, PageHead, StatusPill, Toolbar } from '../components/layout';
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

const BLANK = {
  name: '',
  email: '',
  phone: '',
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
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK });

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
