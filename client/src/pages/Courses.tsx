import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

/**
 * Multi-week courses, as cohorts rather than as a pile of classes.
 *
 * A cohort is created empty and its dates are generated separately, because
 * those are different kinds of decision: what the course IS can be edited all
 * week, but once students hold the dates, changing them means telling people
 * the course moved. The detail screen enforces that ordering.
 */

type SeriesRow = {
  id: string;
  name: string;
  cohortLabel: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  sessionCount: number;
  capacity: number;
  priceCents: number;
  enrolledCount: number;
  seatsRemaining: number;
  serviceType: { id: string; name: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  _count: { sessions: number };
};

type ServiceOption = { id: string; name: string; bookingMode: string };

export default function Courses() {
  const base = useOrgBase();
  const navigate = useNavigate();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [cohortLabel, setCohortLabel] = useState('');
  const [sessionCount, setSessionCount] = useState(6);
  const [capacity, setCapacity] = useState(8);
  const [price, setPrice] = useState('240');

  const load = useCallback(async () => {
    try {
      const params = status ? `?status=${status}` : '';
      const res = await api.get<{ series: SeriesRow[] }>(
        `${base}/courses${params}`,
      );
      setSeries(res.series);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load courses.');
    }
  }, [base, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ services: ServiceOption[] }>(
          `${base}/services`,
        );
        // Only a COURSE_SERIES service can back a cohort — the API refuses
        // anything else. Classes.tsx filters these same services OUT for the
        // same reason, from the other side.
        setServices(
          res.services.filter((x) => x.bookingMode === 'COURSE_SERIES'),
        );
      } catch {
        // The form stays empty; the list above is still useful.
      }
    })();
  }, [base]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceTypeId || !name.trim()) return;

    setBusy(true);
    try {
      const res = await api.post<{ series: SeriesRow }>(`${base}/courses`, {
        serviceTypeId,
        name: name.trim(),
        ...(cohortLabel.trim() ? { cohortLabel: cohortLabel.trim() } : {}),
        sessionCount,
        capacity,
        priceCents: Math.round(Number(price) * 100),
      });
      setName('');
      setCohortLabel('');
      setCreating(false);
      setError(null);
      await load();
      // Straight to the cohort, because it has no dates yet and is useless
      // until it does. Leaving them on the list invites forgetting that step.
      navigate(`/courses/${res.series.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-head">
        <h1>Courses</h1>
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          {isAdmin && (
            <button onClick={() => setCreating((v) => !v)}>
              {creating ? 'Close' : 'New course'}
            </button>
          )}
        </div>
      </header>

      {error && <div className="err">{error}</div>}

      {isAdmin && creating && services.length === 0 && (
        <div className="card">
          <h2>New course</h2>
          <p className="sub">
            No class is set up to run as a course yet. A course needs a service
            whose booking mode is a multi-week course — set one up under
            services first, then come back.
          </p>
        </div>
      )}

      {isAdmin && creating && services.length > 0 && (
        <form className="card schedule" onSubmit={(e) => void create(e)}>
          <h2>New course</h2>

          <div className="fields">
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Beginner Wheel, 6 weeks"
                required
              />
            </label>

            <label>
              Class
              <select
                value={serviceTypeId}
                onChange={(e) => setServiceTypeId(e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cohort
              <input
                value={cohortLabel}
                onChange={(e) => setCohortLabel(e.target.value)}
                placeholder="Autumn 2026"
              />
            </label>

            <label>
              Weeks
              <input
                type="number"
                min={1}
                max={52}
                value={sessionCount}
                onChange={(e) => setSessionCount(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Places
              <input
                type="number"
                min={1}
                max={500}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Price for the whole course
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </label>
          </div>

          <p className="sub">
            Dates come next. A course is created without them so you can settle
            what it costs and how many places it has before anyone is holding a
            date in their calendar.
          </p>

          <button type="submit" disabled={busy || !serviceTypeId || !name.trim()}>
            {busy ? 'Creating…' : 'Create and pick dates'}
          </button>
        </form>
      )}

      {series.length === 0 && !error && (
        <div className="card empty">No courses yet.</div>
      )}

      <div className="list">
        {series.map((s) => (
          <div key={s.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>
                  <Link to={`/courses/${s.id}`}>{s.name}</Link>
                </strong>
                {s.cohortLabel && <span className="tag">{s.cohortLabel}</span>}
                <span className={`tag ${s.status}`}>
                  {s.status.toLowerCase()}
                </span>
                <div className="sub">
                  {s.serviceType.name} · {s.sessionCount} week
                  {s.sessionCount === 1 ? '' : 's'} ·{' '}
                  {money(s.priceCents, currency)}
                  {s.staff ? ` · ${s.staff.name}` : ''}
                </div>
              </div>

              <div className="counts">
                {s._count.sessions === 0 ? (
                  <span className="tag warn-tag">no dates yet</span>
                ) : (
                  <>
                    {s.enrolledCount}/{s.capacity} enrolled
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
