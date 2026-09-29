import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { StatusPill } from './layout';
import { TIMEZONES } from './settings-sections';

/**
 * Locations: where a studio's classes and lessons happen.
 *
 * The API has had create, edit, switch-off and delete since Phase 1, and there
 * was no screen. The only way to get a location was the "Set up my studio"
 * button, and the activity form said "Add them in Settings" — where there was
 * nothing to add them with. Found walking a new studio through the app
 * (docs/ux-audit-findings.md #10).
 *
 * Fixed places only. A mobile service area needs a centre point and a travel
 * radius, which wants a map this screen does not have; those are listed but
 * not created here.
 */

type Location = {
  id: string;
  name: string;
  locationType: 'FIXED' | 'SERVICE_AREA' | 'CUSTOMER_SUPPLIED';
  address: string | null;
  timezone: string;
  isActive: boolean;
};

const TYPE_LABEL: Record<Location['locationType'], string | null> = {
  FIXED: null,
  SERVICE_AREA: 'Mobile service area',
  CUSTOMER_SUPPLIED: "Customer's own place",
};

type Draft = { name: string; address: string; timezone: string };

/**
 * The zone picker: the shortlist, plus the studio's own zone and the stored
 * one when either is not on it. The shortlist is mostly American, so without
 * the studio's zone a location saved in the wrong one could not be put right.
 */
function TimezoneSelect({
  id,
  value,
  onChange,
  studioZone,
  offerStudioDefault = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  studioZone: string;
  /** Adds an empty "Same as the studio" choice, for a new location. */
  offerStudioDefault?: boolean;
}) {
  const zones = [...new Set([value, studioZone, ...TIMEZONES].filter(Boolean))];
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {offerStudioDefault && (
        <option value="">Same as the studio{studioZone ? ` (${studioZone.replace('_', ' ')})` : ''}</option>
      )}
      {zones.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replace('_', ' ')}
        </option>
      ))}
    </select>
  );
}

export function LocationsSection() {
  const base = useOrgBase();
  const role = useActiveOrg()?.role;
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [locations, setLocations] = useState<Location[] | null>(null);
  const [studioZone, setStudioZone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState<Draft>({ name: '', address: '', timezone: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft>({ name: '', address: '', timezone: '' });

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ locations: Location[] }>(
        `${base}/locations?includeInactive=true`,
      );
      setLocations(res.locations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your locations.');
    }
  }, [base]);

  useEffect(() => {
    void load();
    api
      .get<{ organization: { timezone?: string } }>(base)
      .then((res) => setStudioZone(res.organization.timezone ?? ''))
      .catch(() => {
        /* The picker still works; it just cannot name the studio's zone. */
      });
  }, [base, load]);

  /** Runs one change, shows the server's own words if it refuses, reloads. */
  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      // The server's refusal is the useful message: plan limits, classes still
      // booked at a location, history that stops a delete.
      setError(err instanceof Error ? err.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = adding.name.trim();
    if (!name) return;
    const ok = await act(
      () =>
        api.post(`${base}/locations`, {
          name,
          address: adding.address.trim() || null,
          // Omitted means the studio's zone.
          ...(adding.timezone ? { timezone: adding.timezone } : {}),
        }),
      `${name} added.`,
    );
    if (ok) setAdding({ name: '', address: '', timezone: '' });
  }

  function startEdit(location: Location) {
    setEditingId(location.id);
    setEditing({
      name: location.name,
      address: location.address ?? '',
      timezone: location.timezone,
    });
  }

  async function saveEdit(location: Location) {
    const name = editing.name.trim();
    if (!name) return;
    const ok = await act(
      () =>
        api.patch(`${base}/locations/${location.id}`, {
          name,
          address: editing.address.trim() || null,
          timezone: editing.timezone,
        }),
      `${name} saved.`,
    );
    if (ok) setEditingId(null);
  }

  function setActive(location: Location, isActive: boolean) {
    void act(
      () => api.patch(`${base}/locations/${location.id}`, { isActive }),
      isActive
        ? `${location.name} is switched on.`
        : `${location.name} is switched off. Customers no longer see it.`,
    );
  }

  function remove(location: Location) {
    if (!confirm(`Remove ${location.name}? This cannot be undone.`)) return;
    void act(() => api.del(`${base}/locations/${location.id}`), `${location.name} removed.`);
  }

  return (
    <section className="card">
      <h2>Locations</h2>
      <p className="sub">
        Where your classes and lessons happen. With more than one, customers pick
        which on your booking page, and each class is at one of them.
      </p>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}

      {locations === null && !error && <p className="tiny muted">Loading…</p>}

      {locations && locations.length === 0 && (
        <p className="tiny muted">
          None yet. Add the place your classes happen, and any class already on
          your calendar goes there.
        </p>
      )}

      {locations && locations.length > 0 && (
        <ul className="loc-list">
          {locations.map((location) => (
            <li key={location.id} className={location.isActive ? '' : 'row-inactive'}>
              {editingId === location.id ? (
                <div className="fields">
                  <label>
                    Name
                    <input
                      value={editing.name}
                      maxLength={120}
                      required
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </label>
                  <label>
                    Address
                    <input
                      value={editing.address}
                      maxLength={500}
                      onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                    />
                  </label>
                  <label>
                    Timezone
                    <TimezoneSelect
                      id={`tz-${location.id}`}
                      value={editing.timezone}
                      studioZone={studioZone}
                      onChange={(tz) => setEditing({ ...editing, timezone: tz })}
                    />
                    {studioZone && editing.timezone !== studioZone && (
                      <span className="tiny muted">
                        Not the studio&apos;s timezone ({studioZone.replace('_', ' ')}).
                        Times here are shown in this one.
                      </span>
                    )}
                  </label>
                  <div className="toolbar">
                    <button
                      className="primary"
                      disabled={busy || !editing.name.trim()}
                      onClick={() => void saveEdit(location)}
                    >
                      Save
                    </button>
                    <button className="link" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="loc-row">
                  <div>
                    <strong>{location.name}</strong>{' '}
                    {TYPE_LABEL[location.locationType] && (
                      <span className="tag">{TYPE_LABEL[location.locationType]}</span>
                    )}
                    <div className="tiny muted">
                      {location.address || 'No address yet'} ·{' '}
                      {location.timezone.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="loc-actions">
                    <StatusPill status={location.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    {canEdit && (
                      <>
                        <button className="link" disabled={busy} onClick={() => startEdit(location)}>
                          Edit
                        </button>
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => setActive(location, !location.isActive)}
                        >
                          {location.isActive ? 'Switch off' : 'Switch on'}
                        </button>
                        <button
                          className="link danger"
                          disabled={busy}
                          onClick={() => remove(location)}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form className="loc-add" onSubmit={(e) => void add(e)}>
          <h3 className="form-section">Add a location</h3>
          <div className="fields">
            <label>
              Name
              <input
                value={adding.name}
                maxLength={120}
                required
                placeholder="The boathouse"
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                value={adding.address}
                maxLength={500}
                placeholder="Optional"
                onChange={(e) => setAdding({ ...adding, address: e.target.value })}
              />
            </label>
            <label>
              Timezone
              <TimezoneSelect
                id="tz-new"
                value={adding.timezone}
                studioZone={studioZone}
                offerStudioDefault
                onChange={(tz) => setAdding({ ...adding, timezone: tz })}
              />
            </label>
          </div>
          <div className="toolbar">
            <button className="primary" disabled={busy || !adding.name.trim()}>
              Add location
            </button>
          </div>
        </form>
      )}

      {!canEdit && (
        <p className="tiny muted">Only an owner or admin can change locations.</p>
      )}
    </section>
  );
}
