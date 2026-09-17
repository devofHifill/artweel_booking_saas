import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonCard } from '../components/states';

/**
 * The daily manifest.
 *
 * This replaces the Register screen, which showed one class at a time and
 * nothing else. What an instructor opening the studio actually wants is the
 * whole day on one surface, printable, with the two facts the old screen made
 * them go and look up somewhere else: who has not paid, and who has never
 * been here before.
 *
 * Three things carried over from the register deliberately, because they were
 * right:
 *
 *   Marks are held locally and submitted as ONE request PER CLASS. Marking six
 *   students one tap at a time over studio wifi is how a register ends up
 *   half-saved, and half-saved is worse than unsaved because nobody notices.
 *   The manifest spans a whole day, so the batch is still the class — you
 *   check the 10am in at 10am and the 2pm at 2pm.
 *
 *   A class that has not started cannot be marked, and says so, rather than
 *   offering buttons that fail.
 *
 *   The day shown defaults to TODAY in the STUDIO's timezone, not the
 *   browser's.
 *
 * Appointments are on the sheet too. They hang off a staff member rather than
 * a session, so a studio whose Tuesday is four private lessons used to open
 * the register to an empty page.
 */

type RollEntry = {
  bookingId: string;
  customer: { id: string; name: string; email: string; phone: string | null };
  seats: number;
  status: string;
  viaEnrollment: boolean;
  notes: string | null;
  balanceCents: number;
  firstVisit: boolean;
  /** Where a travelling class happens — the customer's own address. */
  serviceAddress: string | null;
};

type ManifestSession = {
  id: string;
  kind: 'class' | 'appointment';
  startsAt: string;
  endsAt: string;
  timezone: string;
  serviceName: string;
  color: string;
  staff: { id: string; name: string; phone: string | null } | null;
  location: { id: string; name: string; address: string | null } | null;
  course: { id: string; name: string; cohortLabel: string | null } | null;
  seriesIndex: number | null;
  capacity: number;
  seatsTaken: number;
  markable: boolean;
  roll: RollEntry[];
  balanceCents: number;
};

type Manifest = {
  studio: { name: string; timezone: string; currency: string };
  date: string;
  sessions: ManifestSession[];
  totals: {
    classes: number;
    appointments: number;
    heads: number;
    checkedIn: number;
    toMark: number;
    balanceOwedCents: number;
    firstVisits: number;
  };
  recipients: { staffId: string; name: string; sessions: number }[];
};

type Mark = 'ATTENDED' | 'NO_SHOW' | 'CONFIRMED';

/** Local date in the STUDIO's zone, not the browser's. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Shifts a `YYYY-MM-DD` by whole days without going near a timezone. */
function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + days));
  return shifted.toISOString().slice(0, 10);
}

function longDate(date: string, timezone: string): string {
  // Parsed as UTC noon so the label cannot slip a day either side of the
  // date line while being formatted back into the studio's zone.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00Z`));
}

export default function DailyManifest() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const canSend = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [day, setDay] = useState(() => todayIn(timezone));
  const [data, setData] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<Manifest>(`${base}/manifest?date=${day}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the day.');
    }
  }, [base, day]);

  useEffect(() => {
    setData(null);
    setSent(null);
    void load();
  }, [load]);

  async function sendToInstructors() {
    if (!data || data.recipients.length === 0) return;

    setSending(true);
    setSent(null);
    try {
      const res = await api.post<{ queued: number; sentTo: string[] }>(
        `${base}/manifest/send`,
        { date: day },
      );
      setSent(
        res.queued === 0
          ? 'Nothing to send — nobody is on the rota today.'
          : `Sent to ${res.sentTo.join(', ')}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the sheet.');
    } finally {
      setSending(false);
    }
  }

  const currency = data?.studio.currency ?? 'USD';
  const isToday = day === todayIn(timezone);

  return (
    <div className="manifest">
      <PageHead
        title="Daily manifest"
        lede={longDate(day, timezone)}
        actions={
          <div className="manifest-nav no-print">
            <button
              type="button"
              onClick={() => setDay(shiftDay(day, -1))}
              aria-label="Previous day"
            >
              ←
            </button>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Day"
            />
            <button
              type="button"
              onClick={() => setDay(shiftDay(day, 1))}
              aria-label="Next day"
            >
              →
            </button>
            {!isToday && (
              <button type="button" onClick={() => setDay(todayIn(timezone))}>
                Today
              </button>
            )}
          </div>
        }
      />

      {/* Printed sheets lose their context. The studio name and date are in
          the DOM for print only, because on screen the page head already
          says both. */}
      <div className="print-only print-head">
        <strong>{data?.studio.name}</strong>
        <span>{longDate(day, timezone)}</span>
      </div>

      {error && (
        <div className="alert danger no-print" role="alert">
          {error}
        </div>
      )}

      {!data && !error && (
        <LoadingRegion label="Loading the day">
          <SkeletonCard lines={4} />
        </LoadingRegion>
      )}

      {data && (
        <>
          <div className="manifest-summary">
            <Figure label="Classes" value={data.totals.classes} />
            {data.totals.appointments > 0 && (
              <Figure label="Appointments" value={data.totals.appointments} />
            )}
            <Figure label="Booked in" value={data.totals.heads} />
            <Figure
              label="Checked in"
              value={`${data.totals.checkedIn}/${data.totals.heads}`}
            />
            {data.totals.firstVisits > 0 && (
              <Figure label="First visits" value={data.totals.firstVisits} />
            )}
            <Figure
              label="To collect"
              value={money(data.totals.balanceOwedCents, currency)}
            />
          </div>

          <div className="manifest-actions no-print">
            <button type="button" onClick={() => window.print()}>
              Print
            </button>

            {canSend && data.recipients.length > 0 && (
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendToInstructors()}
              >
                {sending
                  ? 'Sending…'
                  : `Send to ${data.recipients
                      .map((r) => r.name.split(' ')[0])
                      .join(', ')}`}
              </button>
            )}

            {sent && (
              <span className="done" role="status">
                {sent}
              </span>
            )}
          </div>

          {data.sessions.length === 0 && (
            <EmptyState icon="◷" hint="Pick another day, or add a class from the calendar.">
              Nothing on this day.
            </EmptyState>
          )}

          {/*
            Jump links for a long day, which is where the prototype shows one
            departure at a time behind a chip per slot. Anchors rather than a
            filter: this is a SHEET, and a sheet you have to click through to
            read is not one — but eight classes is a long scroll on a phone in
            a doorway. Below three there is nothing to navigate.
          */}
          {data.sessions.length > 3 && (
            <nav className="chips manifest-jump no-print" aria-label="Jump to a class">
              {data.sessions.map((session) => (
                <a
                  className="chip"
                  key={`jump:${session.kind}:${session.id}`}
                  href={`#s-${session.kind}-${session.id}`}
                >
                  {timeIn(session.startsAt, session.timezone)} · {session.serviceName}
                  <span className="tiny muted">
                    {' '}
                    {session.seatsTaken}/{session.capacity}
                  </span>
                </a>
              ))}
            </nav>
          )}

          {data.sessions.map((session) => (
            <SessionSheet
              key={`${session.kind}:${session.id}`}
              session={session}
              currency={currency}
              onSaved={load}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="manifest-figure">
      <span className="tiny muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * One class, with its roll.
 *
 * Marks live in this component rather than the page, so an unsaved 2pm is not
 * wiped by saving the 10am — and so each block's Save button counts only its
 * own class.
 */
function SessionSheet({
  session,
  currency,
  onSaved,
}: {
  session: ManifestSession;
  currency: string;
  onSaved: () => Promise<void>;
}) {
  const base = useOrgBase();

  const initial = useMemo(
    () =>
      Object.fromEntries(
        session.roll
          .filter((e) => e.status === 'ATTENDED' || e.status === 'NO_SHOW')
          .map((e) => [e.bookingId, e.status as Mark]),
      ),
    [session.roll],
  );

  const [marks, setMarks] = useState<Record<string, Mark>>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A reload replaces the session object; re-seed from what is now recorded so
  // the sheet shows the saved truth rather than this component's memory of it.
  useEffect(() => {
    setMarks(initial);
    setSaved(false);
  }, [initial]);

  function setMark(bookingId: string, mark: Mark) {
    setSaved(false);
    setMarks((current) => {
      // Tapping the same button again clears it, which is how you undo a
      // mistap without hunting for a third control.
      if (current[bookingId] === mark) {
        const next = { ...current };
        delete next[bookingId];
        return next;
      }
      return { ...current, [bookingId]: mark };
    });
  }

  function markAllPresent() {
    setSaved(false);
    setMarks(
      Object.fromEntries(session.roll.map((e) => [e.bookingId, 'ATTENDED' as Mark])),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);

    // Everyone on the roll goes in the request. Anybody left untouched is sent
    // as CONFIRMED, which is what "not marked" means — and it also undoes a
    // previous mark that has just been cleared.
    const entries = session.roll.map((entry) => ({
      bookingId: entry.bookingId,
      status: marks[entry.bookingId] ?? ('CONFIRMED' as Mark),
    }));

    try {
      if (session.kind === 'class') {
        await api.post(`${base}/sessions/${session.id}/register`, { entries });
      } else {
        // An appointment has no session behind it, so there is no register to
        // post. It is one booking, which means one request is already the
        // batch this page is careful about everywhere else.
        const only = entries[0]!;
        await api.post(`${base}/bookings/${only.bookingId}/attendance`, {
          status: only.status,
        });
      }

      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const marked = Object.keys(marks).length;
  const full = session.capacity > 0 && session.seatsTaken >= session.capacity;

  const heads = session.roll.reduce((sum, entry) => sum + entry.seats, 0);

  return (
    <section className="card manifest-session" id={`s-${session.kind}-${session.id}`}>
      <header className="ms-head">
        <span className="ms-swatch" style={{ background: session.color }} aria-hidden="true" />

        <div className="ms-when">
          <b>{timeIn(session.startsAt, session.timezone)}</b>
          <span className="tiny muted">
            {timeIn(session.endsAt, session.timezone)}
          </span>
        </div>

        <div className="ms-what">
          <h2>
            {session.serviceName}
            {session.kind === 'appointment' && (
              <span className="tag">appointment</span>
            )}
            {session.course && (
              <span className="tag">
                {session.course.cohortLabel ?? session.course.name}
                {session.seriesIndex !== null && ` · week ${session.seriesIndex + 1}`}
              </span>
            )}
          </h2>
          <p className="sub">
            {session.staff?.name ?? 'No instructor assigned'}
            {/* The number to ring when somebody is not where they should be.
                Sent to the sheet rather than looked up on another screen,
                because the person reading this is holding paper. */}
            {session.staff?.phone && ` · ${session.staff.phone}`}
            {session.location ? ` · ${session.location.name}` : ''}
          </p>

          {/* The address was already on the wire and had no reader. A printed
              sheet naming a room but not the building is no use to a stand-in
              instructor who has never been there. */}
          {session.location?.address && (
            <p className="tiny muted ms-address">{session.location.address}</p>
          )}
        </div>

        <div className="ms-count">
          <b className={full ? 'full' : undefined}>
            {session.seatsTaken}/{session.capacity}
          </b>
          {session.balanceCents > 0 && (
            <span className="tiny owed">
              {money(session.balanceCents, currency)} owed
            </span>
          )}
        </div>
      </header>

      {session.roll.length === 0 ? (
        <p className="sub">Nobody is booked in.</p>
      ) : (
        <table className="roll">
          <thead>
            <tr>
              {/* Numbered, because that is how a roll is read aloud — "number
                  seven hasn't turned up" — and how twelve ticks get checked
                  against twelve names without counting twice. */}
              <th scope="col" className="num rownum">
                #
              </th>
              <th scope="col">Name</th>
              <th scope="col" className="contact-col">
                Contact
              </th>
              <th scope="col" className="num">
                Places
              </th>
              <th scope="col" className="num">
                Balance
              </th>
              <th scope="col" className="no-print">
                Check in
              </th>
              {/* The printed sheet gets a box to tick with a pen, because the
                  studio wifi does not reach the kiln room. */}
              <th scope="col" className="print-only">
                ✓
              </th>
            </tr>
          </thead>

          <tbody>
            {session.roll.map((entry, index) => (
              <tr key={entry.bookingId}>
                <td className="num rownum tiny muted">{index + 1}</td>

                <td>
                  <span className="roll-name">{entry.customer.name}</span>
                  {entry.firstVisit && <span className="tag first">first visit</span>}
                  {entry.viaEnrollment && <span className="tag">course</span>}
                  {/* A travelling class happens at the customer's door, and
                      this is the sheet whose whole job is saying where to go.
                      Per row, because two mobile bookings are two doorsteps. */}
                  {entry.serviceAddress && (
                    <p className="tiny roll-address">{entry.serviceAddress}</p>
                  )}
                  {entry.notes && <p className="tiny muted roll-note">{entry.notes}</p>}
                </td>

                <td className="tiny muted contact-col">
                  {entry.customer.phone ?? entry.customer.email}
                </td>

                <td className="num">{entry.seats}</td>

                <td className="num">
                  {entry.balanceCents > 0 ? (
                    <span className="owed">
                      {money(entry.balanceCents, currency)}
                    </span>
                  ) : (
                    <span className="tiny muted">paid</span>
                  )}
                </td>

                <td className="no-print">
                  <div className="marks">
                    <button
                      type="button"
                      disabled={!session.markable || busy}
                      aria-pressed={marks[entry.bookingId] === 'ATTENDED'}
                      className={marks[entry.bookingId] === 'ATTENDED' ? 'on' : ''}
                      onClick={() => setMark(entry.bookingId, 'ATTENDED')}
                    >
                      Here
                    </button>
                    <button
                      type="button"
                      disabled={!session.markable || busy}
                      aria-pressed={marks[entry.bookingId] === 'NO_SHOW'}
                      className={marks[entry.bookingId] === 'NO_SHOW' ? 'on' : ''}
                      onClick={() => setMark(entry.bookingId, 'NO_SHOW')}
                    >
                      Absent
                    </button>
                  </div>
                </td>

                <td className="print-only tickbox" aria-hidden="true" />
              </tr>
            ))}
          </tbody>

          {/* Reconciles the sheet without adding a column up by hand — the one
              thing somebody does with a printed roll at the end of a class. */}
          <tfoot>
            <tr>
              <td className="rownum" />
              <td>Total</td>
              <td className="contact-col" />
              <td className="num">
                {heads}/{session.capacity}
              </td>
              <td className="num">
                {session.balanceCents > 0 ? (
                  <span className="owed">
                    {money(session.balanceCents, currency)}
                  </span>
                ) : (
                  <span className="tiny muted">all paid</span>
                )}
              </td>
              <td className="no-print" />
              <td className="print-only" />
            </tr>
          </tfoot>
        </table>
      )}

      {error && (
        <div className="alert danger no-print" role="alert">
          {error}
        </div>
      )}

      {!session.markable && session.roll.length > 0 && (
        <p className="sub no-print">
          This has not started yet, so there is no attendance to record.
        </p>
      )}

      {session.markable && session.roll.length > 0 && (
        <div className="ms-actions no-print">
          <button type="button" className="link" onClick={markAllPresent} disabled={busy}>
            Everyone is here
          </button>
          <div className="spacer" />
          {saved && <span className="done">Saved</span>}
          <button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : `Save (${marked}/${session.roll.length})`}
          </button>
        </div>
      )}
    </section>
  );
}
