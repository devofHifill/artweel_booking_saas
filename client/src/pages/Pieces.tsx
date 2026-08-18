import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

/**
 * The shelf: every pot in the studio and where it is in the firing cycle.
 *
 * Logging is deliberately a batch form against a class, because that is the
 * moment the work actually exists — a board of wet pots at the end of a
 * session, and nobody filling in twelve separate forms.
 */

type PieceStatus =
  | 'GREENWARE'
  | 'AWAITING_BISQUE'
  | 'BISQUE_FIRING'
  | 'BISQUED'
  | 'AWAITING_GLAZE'
  | 'GLAZE_FIRING'
  | 'FINISHED'
  | 'COLLECTED'
  | 'BROKEN';

type Piece = {
  id: string;
  label: string;
  status: PieceStatus;
  shelfLocation: string | null;
  readyAt: string | null;
  customer: { id: string; name: string; email: string };
  firing: { id: string; firingType: string; status: string } | null;
};

type UncollectedResponse = {
  holdDays: number;
  cutoff: string | null;
  pieces: (Piece & { daysWaiting: number | null })[];
};

type SessionRow = {
  id: string;
  startsAt: string;
  serviceType: { name: string };
};

type RegisterEntry = {
  bookingId: string;
  customer: { id: string; name: string };
};

/**
 * Which moves are legal, mirrored from `pieces/piece.service.ts`.
 *
 * DUPLICATED ON PURPOSE, and the only copy of this that matters is the
 * server's — it rejects anything illegal regardless of what this screen
 * offers. This exists so the UI does not present a move that is going to be
 * refused. The server file notes the workflow is not universal (single-fire,
 * raku, salt all break it); if that table widens, widen this one too, or move
 * both behind an endpoint.
 */
const TRANSITIONS: Record<PieceStatus, PieceStatus[]> = {
  GREENWARE: ['AWAITING_BISQUE', 'BROKEN'],
  AWAITING_BISQUE: ['BISQUE_FIRING', 'GREENWARE', 'BROKEN'],
  BISQUE_FIRING: ['BISQUED', 'BROKEN', 'AWAITING_BISQUE'],
  BISQUED: ['AWAITING_GLAZE', 'BROKEN'],
  AWAITING_GLAZE: ['GLAZE_FIRING', 'BISQUED', 'BROKEN'],
  GLAZE_FIRING: ['FINISHED', 'BROKEN', 'AWAITING_GLAZE'],
  FINISHED: ['COLLECTED', 'AWAITING_GLAZE', 'BROKEN'],
  COLLECTED: ['AWAITING_GLAZE'],
  BROKEN: [],
};

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'GREENWARE', label: 'Wet' },
  { value: 'AWAITING_BISQUE', label: 'For bisque' },
  { value: 'BISQUED', label: 'Bisqued' },
  { value: 'AWAITING_GLAZE', label: 'For glaze' },
  { value: 'FINISHED', label: 'Ready' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'BROKEN', label: 'Broken' },
];

const humanise = (status: string) => status.toLowerCase().replace(/_/g, ' ');

export default function Pieces() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [uncollected, setUncollected] = useState<UncollectedResponse | null>(
    null,
  );
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Batch logging ---------------------------------------------------------
  const [logging, setLogging] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [attendees, setAttendees] = useState<RegisterEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const params = status ? `?status=${status}` : '';
      const [p, u] = await Promise.all([
        api.get<{ pieces: Piece[] }>(`${base}/pieces${params}`),
        api.get<UncollectedResponse>(`${base}/pieces/uncollected`),
      ]);
      setPieces(p.pieces);
      setUncollected(u);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pieces.');
    }
  }, [base, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recent classes are where pots come from, so the picker looks backwards.
  useEffect(() => {
    if (!logging) return;
    void (async () => {
      const today = new Date();
      const from = new Date(today.getTime() - 21 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const to = today.toISOString().slice(0, 10);
      try {
        const res = await api.get<{ sessions: SessionRow[] }>(
          `${base}/sessions?from=${from}&to=${to}`,
        );
        setSessions(res.sessions);
      } catch {
        setSessions([]);
      }
    })();
  }, [base, logging]);

  useEffect(() => {
    if (!sessionId) {
      setAttendees([]);
      setCounts({});
      return;
    }
    void (async () => {
      try {
        const res = await api.get<{ entries: RegisterEntry[] }>(
          `${base}/sessions/${sessionId}/register`,
        );
        setAttendees(res.entries);
        setCounts(
          Object.fromEntries(res.entries.map((e) => [e.customer.id, 1])),
        );
      } catch {
        setAttendees([]);
      }
    })();
  }, [base, sessionId]);

  async function logBatch() {
    const entries = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([customerId, count]) => ({ customerId, count }));

    if (entries.length === 0) return;

    setBusy(true);
    try {
      await api.post(`${base}/pieces/batch`, { sessionId, entries });
      setLogging(false);
      setSessionId('');
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the work.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Moving a piece on.
   *
   * FINISHED is the one with a consequence outside this screen: it texts the
   * owner that their work is ready. Said out loud before it happens, because
   * an accidental click here reaches a customer's phone and cannot be recalled.
   */
  async function move(piece: Piece, to: PieceStatus) {
    if (to === 'FINISHED') {
      if (
        !confirm(
          `Mark "${piece.label}" as ready?\n\n` +
            `${piece.customer.name} will be told their work is ready to collect. ` +
            'That message goes out as soon as you confirm.',
        )
      )
        return;
    } else if (to === 'BROKEN') {
      if (!confirm(`Mark "${piece.label}" as broken? This cannot be undone.`))
        return;
    }

    setBusy(true);
    try {
      await api.post(`${base}/pieces/${piece.id}/status`, { status: to });
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  const shelf = uncollected?.pieces ?? [];

  return (
    <div>
      <header className="page-head">
        <h1>Pieces</h1>
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button onClick={() => setLogging((v) => !v)}>
            {logging ? 'Close' : 'Log a class'}
          </button>
        </div>
      </header>

      <nav className="subnav">
        <Link to="/studio/pieces" className="on">
          Pieces
        </Link>
        <Link to="/studio/firings">Firings</Link>
      </nav>

      {error && <div className="err">{error}</div>}

      {logging && (
        <div className="card schedule">
          <h2>Log a class's work</h2>
          <p className="sub">
            Pick the class, then say how many pots each person made. Everything
            starts as wet work.
          </p>

          {sessions.length === 0 ? (
            <p className="sub">
              No classes have run in the last three weeks, so there is no work
              to log against one yet.
            </p>
          ) : (
            <label>
              Class
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">Choose…</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {dateIn(s.startsAt, timezone)} — {s.serviceType.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {sessionId && attendees.length === 0 && (
            <p className="sub">Nobody was booked into that class.</p>
          )}

          {attendees.length > 0 && (
            <>
              <ul className="queue">
                {attendees.map((entry) => (
                  <li key={entry.customer.id}>
                    <span className="who">{entry.customer.name}</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={counts[entry.customer.id] ?? 0}
                      onChange={(e) =>
                        setCounts((c) => ({
                          ...c,
                          [entry.customer.id]: Number(e.target.value),
                        }))
                      }
                      aria-label={`Pots by ${entry.customer.name}`}
                      style={{ width: 70 }}
                    />
                  </li>
                ))}
              </ul>
              <button onClick={() => void logBatch()} disabled={busy}>
                {busy ? 'Logging…' : 'Log the work'}
              </button>
            </>
          )}
        </div>
      )}

      {/* --- The shelf that needs chasing ---------------------------------- */}

      {shelf.length > 0 && (
        <div className="card">
          {/*
            Not "everything ready" — the endpoint returns only work that has
            been ready longer than the studio holds it, which is the list worth
            chasing. Finished work inside the hold period is nobody's problem
            yet and appears in the list below like anything else.
          */}
          <div className="row-head" style={{ cursor: 'default' }}>
            <h2>On the shelf too long</h2>
            <div className="counts">
              {uncollected?.cutoff
                ? `ready over ${uncollected.holdDays} days ago`
                : 'held indefinitely'}
            </div>
          </div>
          <ul className="queue">
            {shelf.map((piece) => (
              <li key={piece.id}>
                <span className="who">
                  {piece.label}
                  <span className="sub">
                    <Link to={`/customers/${piece.customer.id}`}>
                      {piece.customer.name}
                    </Link>
                    {piece.shelfLocation ? ` · ${piece.shelfLocation}` : ''}
                  </span>
                </span>
                <span className="counts">
                  {piece.daysWaiting !== null
                    ? `${piece.daysWaiting} days`
                    : ''}
                </span>
                <button
                  className="link"
                  onClick={() => void move(piece, 'COLLECTED')}
                  disabled={busy}
                >
                  Collected
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Everything ---------------------------------------------------- */}

      {pieces.length === 0 && !error && (
        <div className="card empty-state">
          <span className="empty-mark" aria-hidden="true">◍</span>
          <p className="empty-title">Nothing logged yet.</p>
        </div>
      )}

      <div className="list">
        {pieces.map((piece) => (
          <div key={piece.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>{piece.label}</strong>
                <span className={`tag ${piece.status}`}>
                  {humanise(piece.status)}
                </span>
                <div className="sub">
                  <Link to={`/customers/${piece.customer.id}`}>
                    {piece.customer.name}
                  </Link>
                  {piece.shelfLocation ? ` · ${piece.shelfLocation}` : ''}
                  {piece.firing
                    ? piece.firing.status === 'COMPLETE'
                      ? ` · from a ${piece.firing.firingType.toLowerCase()} firing`
                      : ` · in a ${piece.firing.firingType.toLowerCase()} firing`
                    : ''}
                </div>
              </div>

              <div className="counts">
                {TRANSITIONS[piece.status].length === 0 ? (
                  <span className="sub">no further moves</span>
                ) : (
                  TRANSITIONS[piece.status].map((next) => (
                    <button
                      key={next}
                      className={`link ${next === 'BROKEN' ? 'danger' : ''}`}
                      onClick={() => void move(piece, next)}
                      disabled={busy}
                    >
                      {humanise(next)}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
