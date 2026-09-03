import { useCallback, useEffect, useState } from 'react';
import { api, dateIn, money, plusDays, timeIn, todayIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  initials,
  Kpi,
  PageHead,
  SegRange,
  StatGrid,
  StatusPill,
} from '../components/layout';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/states';
import { ServiceForm, type ServiceDraft } from '../components/ServiceForm';

/**
 * Scheduling classes.
 *
 * Kept apart from the Register page on purpose: putting a class on the
 * calendar is an owner's job and marking who turned up is the instructor's,
 * which is the same split the API enforces. One page doing both would show
 * every instructor a form they are not allowed to submit.
 */

type ServiceOption = {
  id: string;
  name: string;
  description?: string | null;
  bookingMode: string;
  capacityMax: number;
  durationMinutes: number;
  priceCents?: number;
  color?: string;
  isActive?: boolean;
  /**
   * Carried through to the edit form. They must be READ here even though this
   * screen never displays them: the form sends whatever it holds, so a field
   * this type forgets is a field the next save quietly resets to its default.
   */
  minNoticeMinutes?: number;
  maxHorizonDays?: number;
  depositType?: 'none' | 'percent' | 'fixed';
  depositValue?: number;
  highlights?: string | null;
  preparationNotes?: string | null;
  shortDescription?: string | null;
  childPriceCents?: number;
  colorAccent?: string | null;
  emoji?: string | null;
  meetingPoint?: string | null;
  bookingInstructions?: string | null;
  capacityMin?: number;
  cancellationPolicyId?: string | null;
  /**
   * Both already come back from `/services` and were being discarded.
   *
   * `_count.staffServices` is the useful one: a class with no instructor
   * assigned cannot be booked by anybody, silently — the same shape as the
   * fault the parity pass found, where anyone hired after signup was
   * permanently unbookable. The card says so rather than leaving it to be
   * discovered by a customer.
   */
  category?: { id: string; name: string } | null;
  serviceLocations?: { locationId: string }[];
  _count?: { staffServices: number; serviceLocations: number };
};

type SessionRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  seriesLabel: string | null;
  serviceType: { id: string; name: string };
  staff: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  courseSeries: { id: string; name: string } | null;
};

type Created = { id: string; localDate: string };
type Skipped = { localDate: string; reason: string };

type WaitlistEntry = {
  id: string;
  status: 'WAITING' | 'OFFERED' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';
  position: number;
  seats: number;
  offerExpiresAt: string | null;
  customer: { id: string; name: string; email: string; phone: string | null };
};

type WaitlistResponse = {
  session: { id: string; capacity: number; seatsTaken: number };
  waitingCount: number;
  seatsWanted: number;
  entries: WaitlistEntry[];
};

const WEEKDAYS = [
  ['MO', 'Mon'],
  ['TU', 'Tue'],
  ['WE', 'Wed'],
  ['TH', 'Thu'],
  ['FR', 'Fri'],
  ['SA', 'Sat'],
  ['SU', 'Sun'],
] as const;

/** Still in the running: holding a seat, or in line for one. */
const LIVE = new Set(['WAITING', 'OFFERED']);

/**
 * Queue order, not status order.
 *
 * The API sorts by status first, which puts the one person actually holding a
 * seat BELOW everyone merely waiting behind them — position 1 rendering last,
 * under positions 2 and 3. Whoever is next is the whole point of the panel, so
 * live entries come first in position order and finished ones settle
 * underneath as history.
 */
function orderedQueue(entries: WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort((a, b) => {
    const aLive = LIVE.has(a.status);
    const bLive = LIVE.has(b.status);
    if (aLive !== bLive) return aLive ? -1 : 1;
    return a.position - b.position;
  });
}

export default function Classes() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  /** Cards or table over the same catalogue. See the toggle for why both. */
  const [view, setView] = useState<'cards' | 'table'>('cards');


  /**
   * Opens the editor on one service.
   *
   * A function rather than the object literal it replaced, because two views
   * now offer Edit and this draft is where G3 already caught a foot-gun: the
   * form sends whatever it holds, so a field this builder forgets is a field
   * the next save silently resets to its default. One copy can be wrong; two
   * copies drift, and only one of them gets fixed.
   */
  function edit(svc: ServiceOption) {
    setEditing({
      id: svc.id,
      name: svc.name,
      description: svc.description,
      bookingMode: svc.bookingMode as never,
      durationMinutes: svc.durationMinutes,
      capacityMax: svc.capacityMax,
      priceCents: svc.priceCents ?? 0,
      color: svc.color ?? '#4f46e5',
      minNoticeMinutes: svc.minNoticeMinutes,
      maxHorizonDays: svc.maxHorizonDays,
      depositType: svc.depositType,
      depositValue: svc.depositValue,
      highlights: svc.highlights,
      preparationNotes: svc.preparationNotes,
      /* Every field the form can send has to be READ back here. One this
         object forgets is one the next save silently resets to its default,
         which is the quietest way to lose a studio's copy. */
      shortDescription: svc.shortDescription,
      childPriceCents: svc.childPriceCents ?? 0,
      colorAccent: svc.colorAccent,
      emoji: svc.emoji,
      meetingPoint: svc.meetingPoint,
      bookingInstructions: svc.bookingInstructions,
      capacityMin: svc.capacityMin ?? 1,
      categoryId: svc.category?.id ?? null,
      cancellationPolicyId: svc.cancellationPolicyId,
      /* The join is many-to-many and the form offers one, so the first is the
         one it edits. Without this the form opens blank and the next save
         sends null, clearing a location the studio never touched. */
      locationId: svc.serviceLocations?.[0]?.locationId ?? null,
    });
    setShowForm(true);
  }

  /** The catalogue editor. Null `editing` means creating a new one. */
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ServiceDraft | null>(null);

  const [from, setFrom] = useState(() => todayIn(timezone));
  const [to, setTo] = useState(() => plusDays(todayIn(timezone), 30));
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);

  /** What a studio can actually schedule today. */
  const bookable = services.filter((s) => s.isActive !== false);
  const inactive = services.length - bookable.length;

  /**
   * The average of what a studio charges, over its LIVE classes only.
   *
   * Including switched-off ones would let a class nobody can book drag the
   * figure an owner reads as "what I charge". Free classes count — a taster at
   * zero is a real price and pretending otherwise flatters the average.
   */
  const averageCents = bookable.length
    ? Math.round(
        bookable.reduce((sum, s) => sum + (s.priceCents ?? 0), 0) / bookable.length,
      )
    : 0;

  /**
   * Seats put on sale in the range below, and how many have gone.
   *
   * Computed from the sessions already loaded rather than fetched: the demo
   * fixes this at 30 days, but ours is whatever range the picker holds, so the
   * figure follows it and the foot says so instead of naming a window that
   * might not be the one on screen.
   */
  const seatsScheduled = sessions.reduce((sum, s) => sum + s.capacity, 0);
  const seatsTaken = sessions.reduce((sum, s) => sum + s.seatsTaken, 0);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: Created[]; skipped: Skipped[] } | null>(
    null,
  );

  // --- The form ------------------------------------------------------------
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [startLocalDate, setStartLocalDate] = useState(() => todayIn(timezone));
  const [localStartTime, setLocalStartTime] = useState('18:00');
  const [capacity, setCapacity] = useState(8);
  const [staffId, setStaffId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [repeating, setRepeating] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [count, setCount] = useState(6);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ sessions: SessionRow[] }>(
        `${base}/sessions?from=${from}&to=${to}`,
      );
      setSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load classes.');
    }
  }, [base, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The catalogue, on its own so saving an activity can refresh it.
   *
   * `load` above fetches SESSIONS; creating a service changes neither the
   * sessions nor the date range, so calling that after a save would leave the
   * new activity invisible until a reload.
   */
  const loadServices = useCallback(async () => {
    try {
      /*
        `includeInactive` because this is the CATALOGUE, and an owner who
        switched a class off still needs to find it to switch it back on.

        Without it the endpoint returns only active services, which meant the
        status pill on every card could say nothing but "Active" and an
        inactive count would always have been zero. The scheduling form below
        filters them back out — see `bookable`.
      */
      const s = await api.get<{ services: ServiceOption[] }>(
        `${base}/services?includeInactive=true`,
      );
      // A course service cannot take a loose class, so it is not offered.
      setServices(s.services.filter((x) => x.bookingMode !== 'COURSE_SERIES'));
    } catch {
      // The form simply stays empty; the list above is still useful.
    }
  }, [base]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    void (async () => {
      try {
        const [st, loc] = await Promise.all([
          api.get<{ staff: { id: string; name: string }[] }>(`${base}/staff`),
          api.get<{ locations: { id: string; name: string }[] }>(`${base}/locations`),
        ]);
        setStaff(st.staff);
        setLocations(loc.locations);
      } catch {
        /* Same reasoning as above. */
      }
    })();
  }, [base]);

  function toggleDay(code: string) {
    setDays((current) =>
      current.includes(code)
        ? current.filter((d) => d !== code)
        : [...current, code],
    );
  }

  async function schedule(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceTypeId) return;

    setBusy(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        serviceTypeId,
        startLocalDate,
        localStartTime,
        capacity,
      };
      if (staffId) body.staffId = staffId;
      if (locationId) body.locationId = locationId;
      if (repeating && days.length > 0) {
        body.repeat = {
          rrule: `FREQ=WEEKLY;BYDAY=${days.join(',')}`,
          count,
        };
      }

      const res = await api.post<{ created: Created[]; skipped: Skipped[] }>(
        `${base}/sessions`,
        body,
      );
      setResult(res);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(session: SessionRow) {
    const warning =
      session.seatsTaken > 0
        ? ` ${session.seatsTaken} booked place(s) will be cancelled, and any refund is yours to issue.`
        : '';

    if (!confirm(`Cancel ${session.serviceType.name}?${warning}`)) return;

    setBusy(true);
    try {
      await api.del(`${base}/sessions/${session.id}`);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  // --- The waitlist panel ----------------------------------------------------
  //
  // Loaded per session on expand rather than alongside the list. A month of
  // classes is thirty rows, and thirty waitlist queries to render badges almost
  // none of them need is a bad trade.
  const [openId, setOpenId] = useState<string | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistResponse | null>(null);
  const [wlBusy, setWlBusy] = useState(false);
  const [wlError, setWlError] = useState<string | null>(null);

  const loadWaitlist = useCallback(
    async (sessionId: string) => {
      setWlBusy(true);
      setWlError(null);
      try {
        setWaitlist(
          await api.get<WaitlistResponse>(
            `${base}/sessions/${sessionId}/waitlist`,
          ),
        );
      } catch (err) {
        setWaitlist(null);
        setWlError(
          err instanceof Error ? err.message : 'Could not load the waitlist.',
        );
      } finally {
        setWlBusy(false);
      }
    },
    [base],
  );

  function toggleWaitlist(sessionId: string) {
    if (openId === sessionId) {
      setOpenId(null);
      setWaitlist(null);
      setWlError(null);
      return;
    }
    setOpenId(sessionId);
    setWaitlist(null);
    void loadWaitlist(sessionId);
  }

  /**
   * Offering holds the seat, so the class stays full while the offer stands.
   * Said plainly here because the opposite guess — that offering merely sends
   * an email and the seat is still up for grabs — leads an owner to offer it to
   * three people at once.
   */
  async function offerNext(sessionId: string) {
    if (
      !confirm(
        'Offer the next free seat to the first person waiting?\n\n' +
          'The seat is held for them until the offer runs out, so the class ' +
          'stays full in the meantime.',
      )
    )
      return;

    setWlBusy(true);
    try {
      const res = await api.post<{ offered: boolean }>(
        `${base}/sessions/${sessionId}/waitlist/offer`,
        {},
      );
      if (!res.offered) {
        setWlError('Nothing to offer — no free seat, or nobody waiting for one.');
      }
      await loadWaitlist(sessionId);
      await load();
    } catch (err) {
      setWlError(err instanceof Error ? err.message : 'Could not offer a seat.');
      setWlBusy(false);
    }
  }

  async function removeEntry(sessionId: string, entry: WaitlistEntry) {
    const held =
      entry.status === 'OFFERED'
        ? '\n\nThey currently hold a seat; removing them frees it for the next person.'
        : '';
    if (!confirm(`Remove ${entry.customer.name} from the waitlist?${held}`)) return;

    setWlBusy(true);
    try {
      await api.del(`${base}/sessions/${sessionId}/waitlist/${entry.id}`);
      await loadWaitlist(sessionId);
      await load();
    } catch (err) {
      setWlError(err instanceof Error ? err.message : 'Could not remove them.');
      setWlBusy(false);
    }
  }

  const selected = services.find((s) => s.id === serviceTypeId);

  return (
    <div>
      {/* "Activities", matching the nav item and the 2026-08-20 decision that
          TourFlow's label wins here. The routes stay /classes. */}
      <PageHead
        title="Activities"
        lede="What you offer, and when it runs."
        actions={
          <>
            {/*
              The view toggle belongs to the whole page, so it sits in the page
              head beside the primary action — the prototype's arrangement.

              The two date inputs used to live here and have moved down to the
              schedule, which is the only thing they filter. In the header they
              read as page-wide controls and crowded out the two that are.
            */}
            <SegRange
              label="How to show the catalogue"
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
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Icon name="plus" size={16} />
                Create activity
              </button>
            )}
          </>
        }
      />

      {error && <div className="err">{error}</div>}

      {/*
        The four figures, matching the prototype's row.

        "Drafts" is "Switched off" here: a service has an isActive flag and no
        draft state, and calling a deactivated class a draft would invent a
        workflow the product does not have.

        There is no "seats sold" equivalent to the prototype's revenue figures
        on this screen — those live behind Reports, and a second request on a
        page that needs none is a poor trade for a number Reports already
        answers better.
      */}
      <StatGrid>
        <Kpi
          label="Live activities"
          value={String(bookable.length)}
          icon="classes"
          foot={
            services.length === 0 ? 'Nothing set up yet' : 'Bookable right now'
          }
        />
        <Kpi
          label="Switched off"
          value={String(inactive)}
          icon="classes"
          tone={inactive > 0 ? 'amber' : undefined}
          foot={inactive > 0 ? 'Not on your booking page' : 'All of them are live'}
        />
        <Kpi
          label="Average price"
          value={money(averageCents, currency)}
          icon="money"
          foot="Across your live classes"
        />
        <Kpi
          label="Seats scheduled"
          value={String(seatsScheduled)}
          icon="today"
          foot={
            seatsScheduled > 0
              ? `${seatsTaken} taken · in the range below`
              : 'Nothing scheduled in the range below'
          }
        />
      </StatGrid>

      {/*
        THE CATALOGUE.

        Until D4 this page could only schedule sessions of services that
        already existed, and nothing anywhere could create one — while
        onboarding carried a required "Add a class" step that completes when
        `services > 0`. A studio signing up could not finish setup.
      */}
      {showForm && isAdmin && (
        <ServiceForm
          base={base}
          existing={editing ?? undefined}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            void loadServices();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {/* No longer gated on `!showForm`. The editor was an inline card that
          replaced this section; as a dialog it floats over it, and blanking
          the page behind a dialog loses the very list the studio is editing
          against. */}
      {(
        <section className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="panel-head" style={{ margin: '-14px -16px 16px' }}>
            <h2>What you offer</h2>
            <div className="right tiny muted">
              {services.length} {services.length === 1 ? 'activity' : 'activities'}
            </div>
          </div>

          {services.length === 0 ? (
            <EmptyState hint={isAdmin ? 'Create one to start taking bookings.' : undefined}>
              Nothing set up yet.
            </EmptyState>
          ) : view === 'cards' ? (
            <div className="catalogue">
              {services.map((svc) => {
                const colour = svc.color ?? 'var(--clay)';
                /* The chosen second stop when there is one, and a darker shade
                   of the first when there is not — so a service created before
                   the gradient picker existed still gets a coherent card
                   rather than a flat block. */
                const accent =
                  svc.colorAccent ?? `color-mix(in srgb, ${colour} 65%, #000)`;
                const unstaffed = svc._count?.staffServices === 0;

                return (
                  <article className="cat-card" key={svc.id}>
                    {/*
                      The icon the studio picked, over the gradient it picked.

                      This used to read "there is no emoji anywhere in this
                      schema and inventing a field for one is a poor trade, so
                      the initials carry it" — true when it was written, and no
                      longer: the Create-activity form asks for both. The
                      initials stay as the fallback, because every service
                      created before that form existed has neither.
                    */}
                    <div
                      className="cat-head"
                      style={{
                        background: `linear-gradient(135deg, ${colour}, ${accent})`,
                      }}
                    >
                      <span className="cat-initials" aria-hidden="true">
                        {svc.emoji || initials(svc.name)}
                      </span>
                      <span className="cat-pins">
                        <StatusPill
                          status={svc.isActive === false ? 'INACTIVE' : 'ACTIVE'}
                        />
                        {svc.category && (
                          <span className="cat-tag">{svc.category.name}</span>
                        )}
                      </span>
                    </div>

                    <div className="cat-body">
                      <div className="cat-title">
                        <strong>{svc.name}</strong>
                        {svc.priceCents !== undefined && (
                          <span className="strong">
                            {money(svc.priceCents, currency)}
                          </span>
                        )}
                      </div>

                      {/* The short line is written FOR this spot; the long one
                          is the detail panel's and gets truncated to nonsense
                          here. Falls back to it only when there is no short. */}
                      {(svc.shortDescription || svc.description) && (
                        <p className="tiny muted cat-desc">
                          {svc.shortDescription || svc.description}
                        </p>
                      )}

                      <div className="cat-meta tiny muted">
                        <span>{svc.durationMinutes} min</span>
                        <span>
                          {svc.bookingMode === 'APPOINTMENT'
                            ? 'One to one'
                            : `Up to ${svc.capacityMax}`}
                        </span>
                        {svc._count && (
                          <span>
                            {svc._count.serviceLocations || 'no'}{' '}
                            {svc._count.serviceLocations === 1
                              ? 'location'
                              : 'locations'}
                          </span>
                        )}
                      </div>

                      <div className="cat-foot">
                        {/*
                          Not a decoration. A class nobody can teach takes no
                          bookings and says nothing about it — the exact
                          silent fault the parity pass found with instructor
                          hours.
                        */}
                        <span className={`tiny ${unstaffed ? 'warn' : 'muted'}`}>
                          {unstaffed
                            ? 'No instructor assigned'
                            : `${svc._count?.staffServices ?? 0} ${
                                svc._count?.staffServices === 1
                                  ? 'instructor'
                                  : 'instructors'
                              }`}
                        </span>
                        {isAdmin && (
                          <button className="sm" onClick={() => edit(svc)}>
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <DataTable
              caption="What you offer, with type, duration, capacity and price"
              head={
                <tr>
                  <th>Activity</th>
                  <th>Type</th>
                  <th className="num">Duration</th>
                  <th className="num">Capacity</th>
                  <th className="num">Price</th>
                  <th>Status</th>
                  {isAdmin && <th style={{ width: 80 }} />}
                </tr>
              }
            >
              {services.map((svc) => (
                <tr key={svc.id}>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: svc.color ?? 'var(--clay)' }}
                    />
                    {svc.name}
                    {svc.description && (
                      <div className="tiny muted">{svc.description}</div>
                    )}
                  </td>
                  <td>
                    {svc.bookingMode === 'APPOINTMENT' ? 'One to one' : 'Group class'}
                  </td>
                  <td className="num nowrap">{svc.durationMinutes} min</td>
                  {/* An appointment is one-to-one by a schema rule, so a
                      capacity column would read "1" down every such row and
                      invite somebody to change it. */}
                  <td className="num">
                    {svc.bookingMode === 'APPOINTMENT' ? '—' : svc.capacityMax}
                  </td>
                  <td className="num">
                    {svc.priceCents === undefined
                      ? '—'
                      : money(svc.priceCents, currency)}
                  </td>
                  <td>
                    <StatusPill status={svc.isActive === false ? 'INACTIVE' : 'ACTIVE'} />
                  </td>
                  {isAdmin && (
                    <td>
                      <button className="link" onClick={() => edit(svc)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </DataTable>
          )}
        </section>
      )}

      {isAdmin && (
        <form className="card schedule" onSubmit={(e) => void schedule(e)}>
          <h2>Schedule a class</h2>

          <div className="fields">
            <label>
              Class
              <select
                value={serviceTypeId}
                onChange={(e) => {
                  setServiceTypeId(e.target.value);
                  const svc = services.find((s) => s.id === e.target.value);
                  if (svc) setCapacity(Math.min(capacity, svc.capacityMax));
                }}
                required
              >
                <option value="">Choose…</option>
                {/* Active only. Scheduling a class a studio has switched off
                    would put a session on the calendar that its own booking
                    page will not sell. */}
                {bookable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={startLocalDate}
                onChange={(e) => setStartLocalDate(e.target.value)}
                required
              />
            </label>

            <label>
              Start
              <input
                type="time"
                value={localStartTime}
                onChange={(e) => setLocalStartTime(e.target.value)}
                required
              />
            </label>

            <label>
              Places
              <input
                type="number"
                min={1}
                max={selected?.capacityMax ?? 500}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Instructor
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Nobody yet</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Where
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Not set</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={repeating}
              onChange={(e) => setRepeating(e.target.checked)}
            />
            Repeat weekly
          </label>

          {repeating && (
            <div className="repeat">
              <div className="days">
                {WEEKDAYS.map(([code, label]) => (
                  <button
                    type="button"
                    key={code}
                    className={days.includes(code) ? 'on' : ''}
                    onClick={() => toggleDay(code)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                How many
                <input
                  type="number"
                  min={2}
                  max={52}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <p className="sub">
                A longer run of dated classes is really a course — set one up
                under Courses so it sells as one thing.
              </p>
            </div>
          )}

          <button type="submit" disabled={busy || !serviceTypeId}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>

          {result && (
            <div className="result">
              <p className="done">
                {result.created.length} class
                {result.created.length === 1 ? '' : 'es'} scheduled.
              </p>
              {result.skipped.length > 0 && (
                <div className="alert warn">
                  <strong>Skipped {result.skipped.length}:</strong>
                  <ul>
                    {result.skipped.map((s) => (
                      <li key={s.localDate}>
                        {s.localDate} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {/*
        The date range sits with the list it filters, not in the page head.

        It reads as a page-wide control up there, which it is not — it touches
        nothing in the catalogue above. "In this range" in the empty state now
        has the range it refers to next to it.
      */}
      <div className="panel-head" style={{ marginBottom: 'var(--space-3)' }}>
        <h2>Scheduled classes</h2>
        <div className="right row" style={{ gap: 'var(--space-2)' }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
          />
        </div>
      </div>

      {sessions.length === 0 && !error && (
        <EmptyState icon="◷">No classes in this range.</EmptyState>
      )}

      <div className="list">
        {sessions.map((session) => (
          <div key={session.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>{session.serviceType.name}</strong>
                {session.seriesLabel && (
                  <span className="tag">{session.seriesLabel}</span>
                )}
                {session.courseSeries && <span className="tag">course</span>}
                <div className="sub">
                  {dateIn(session.startsAt, timezone)} ·{' '}
                  {timeIn(session.startsAt, timezone)}
                  {session.staff ? ` · ${session.staff.name}` : ''}
                  {session.location ? ` · ${session.location.name}` : ''}
                </div>
              </div>

              <div className="counts">
                {session.seatsTaken}/{session.capacity} booked
                <button
                  className="link"
                  onClick={() => toggleWaitlist(session.id)}
                >
                  {openId === session.id ? 'Hide waitlist' : 'Waitlist'}
                </button>
                {isAdmin && (
                  <button
                    className="link danger"
                    onClick={() => void cancel(session)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {openId === session.id && (
              <div className="waitlist">
                {wlError && <div className="err">{wlError}</div>}
                {wlBusy && !waitlist && <p className="sub">Loading…</p>}

                {waitlist && waitlist.entries.length === 0 && (
                  <p className="sub">Nobody has joined this waitlist.</p>
                )}

                {waitlist && waitlist.entries.length > 0 && (
                  <>
                    <div className="row-head" style={{ cursor: 'default' }}>
                      <div className="sub">
                        {waitlist.waitingCount} waiting for{' '}
                        {waitlist.seatsWanted} seat
                        {waitlist.seatsWanted === 1 ? '' : 's'}
                      </div>
                      {isAdmin && (
                        <button
                          className="link"
                          onClick={() => void offerNext(session.id)}
                          disabled={wlBusy || waitlist.waitingCount === 0}
                        >
                          Offer next seat
                        </button>
                      )}
                    </div>

                    <ul className="queue">
                      {orderedQueue(waitlist.entries).map((entry) => (
                        <li key={entry.id}>
                          <span className="pos">
                            {LIVE.has(entry.status) ? entry.position : '·'}
                          </span>
                          <span className="who">
                            {entry.customer.name}
                            <span className="sub">
                              {entry.customer.email}
                              {entry.seats > 1 ? ` · ${entry.seats} seats` : ''}
                            </span>
                          </span>
                          <StatusPill status={entry.status}>
                            {entry.status === 'OFFERED' && entry.offerExpiresAt
                              ? `held until ${timeIn(entry.offerExpiresAt, timezone)}`
                              : undefined}
                          </StatusPill>
                          {isAdmin &&
                            (entry.status === 'WAITING' ||
                              entry.status === 'OFFERED') && (
                              <button
                                className="link danger"
                                onClick={() => void removeEntry(session.id, entry)}
                                disabled={wlBusy}
                              >
                                Remove
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
