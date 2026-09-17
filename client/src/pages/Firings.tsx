import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateIn, timeIn, zonedToInstant } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { StatusPill } from '../components/layout';
import { PageHead } from '../components/layout';
import { EmptyState } from '../components/states';

/**
 * Kiln loads.
 *
 * A firing is a batch of pots moving together, so the screen is built around
 * loading and unloading rather than around the kiln's calendar. The queue
 * counts at the top answer the only question that starts the day: is there
 * enough work waiting to be worth firing?
 */

type FiringStatus =
  | 'SCHEDULED'
  | 'LOADING'
  | 'FIRING'
  | 'COOLING'
  | 'COMPLETE'
  | 'CANCELLED';

type FiringRow = {
  id: string;
  firingType: 'BISQUE' | 'GLAZE';
  status: FiringStatus;
  startsAt: string;
  endsAt: string;
  cone: string | null;
  resource: { id: string; name: string };
  _count: { pieces: number };
};

type FiringDetail = Omit<FiringRow, '_count'> & {
  pieces: {
    id: string;
    label: string;
    status: string;
    customer: { id: string; name: string };
  }[];
};

type LoadablePiece = {
  id: string;
  label: string;
  status: string;
  customer: { id: string; name: string };
};

type Resource = { id: string; name: string; exclusive: boolean };

/**
 * What a firing of each type will take, and what it turns work into. Mirrors
 * `firings/firing.service.ts`; the server enforces it either way.
 */
const ACCEPTS: Record<'BISQUE' | 'GLAZE', string> = {
  BISQUE: 'AWAITING_BISQUE',
  GLAZE: 'AWAITING_GLAZE',
};

/** Only these can still be moved along. */
const FLOW: Record<FiringStatus, FiringStatus[]> = {
  SCHEDULED: ['LOADING', 'FIRING', 'COOLING', 'COMPLETE', 'CANCELLED'],
  LOADING: ['SCHEDULED', 'FIRING', 'COOLING', 'COMPLETE', 'CANCELLED'],
  FIRING: ['LOADING', 'COOLING', 'COMPLETE', 'CANCELLED'],
  COOLING: ['LOADING', 'FIRING', 'COMPLETE', 'CANCELLED'],
  COMPLETE: [],
  CANCELLED: [],
};

const humanise = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function Firings() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';

  const [firings, setFirings] = useState<FiringRow[]>([]);
  const [queue, setQueue] = useState<{
    awaitingBisque: number;
    awaitingGlaze: number;
  } | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FiringDetail | null>(null);
  const [loadable, setLoadable] = useState<LoadablePiece[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // --- Scheduling one --------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [resourceId, setResourceId] = useState('');
  const [firingType, setFiringType] = useState<'BISQUE' | 'GLAZE'>('BISQUE');
  const [startsAt, setStartsAt] = useState('');
  const [hours, setHours] = useState(14);
  const [cone, setCone] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, q] = await Promise.all([
        api.get<{ firings: FiringRow[] }>(`${base}/firings`),
        api.get<{ awaitingBisque: number; awaitingGlaze: number }>(
          `${base}/firings/queue`,
        ),
      ]);
      setFirings(f.firings);
      setQueue(q);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load firings.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ resources: Resource[] }>(
          `${base}/resources`,
        );
        setResources(res.resources);
      } catch {
        setResources([]);
      }
    })();
  }, [base]);

  const openFiring = useCallback(
    async (firing: FiringRow) => {
      setBusy(true);
      try {
        const [d, p] = await Promise.all([
          api.get<{ firing: FiringDetail }>(`${base}/firings/${firing.id}`),
          api.get<{ pieces: LoadablePiece[] }>(
            `${base}/pieces?status=${ACCEPTS[firing.firingType]}`,
          ),
        ]);
        setDetail(d.firing);
        setLoadable(p.pieces);
        setPicked(new Set());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open it.');
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  function toggleOpen(firing: FiringRow) {
    if (openId === firing.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(firing.id);
    setDetail(null);
    void openFiring(firing);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!resourceId || !startsAt) return;

    // Read as the studio's clock, not this browser's.
    const start = zonedToInstant(startsAt, timezone);
    const end = new Date(start.getTime() + hours * 3_600_000);

    setBusy(true);
    try {
      await api.post(`${base}/firings`, {
        resourceId,
        firingType,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        ...(cone.trim() ? { cone: cone.trim() } : {}),
      });
      setCreating(false);
      setStartsAt('');
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule it.');
    } finally {
      setBusy(false);
    }
  }

  async function loadPieces(firing: FiringRow) {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      await api.post(`${base}/firings/${firing.id}/pieces`, {
        pieceIds: [...picked],
      });
      await openFiring(firing);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load them.');
      setBusy(false);
    }
  }

  async function unload(firing: FiringRow, pieceId: string) {
    setBusy(true);
    try {
      await api.del(`${base}/firings/${firing.id}/pieces/${pieceId}`);
      await openFiring(firing);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unload it.');
      setBusy(false);
    }
  }

  /**
   * Advancing the firing.
   *
   * COMPLETE is the one that reaches outside the studio, and only for a glaze
   * firing: it moves every pot in the kiln to FINISHED, which texts each
   * owner. A bisque firing completing is invisible to customers. The warning
   * says which of those is about to happen rather than a single generic one,
   * because a generic warning on both is a warning nobody reads on either.
   */
  async function advance(firing: FiringRow, to: FiringStatus) {
    if (to === 'COMPLETE') {
      const count = detail?.pieces.length ?? firing._count.pieces;
      const message =
        firing.firingType === 'GLAZE'
          ? `Finish this glaze firing?\n\n${count} piece(s) will be marked ready, ` +
            'and their owners will be told to come and collect them. Those ' +
            'messages go out as soon as you confirm.'
          : `Finish this bisque firing?\n\n${count} piece(s) will move to bisqued ` +
            'and be ready for glazing. Customers are not told about this step.';
      if (!confirm(message)) return;
    } else if (to === 'CANCELLED') {
      if (!confirm('Cancel this firing? The kiln is freed for another load.'))
        return;
    }

    setBusy(true);
    try {
      await api.post(`${base}/firings/${firing.id}/status`, { status: to });
      await load();
      if (openId === firing.id) await openFiring(firing);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Firings"
        actions={
          <button onClick={() => setCreating((v) => !v)}>
            {creating ? 'Close' : 'Schedule a firing'}
          </button>
        }
      />

      <nav className="subnav">
        <Link to="/studio/pieces">Pieces</Link>
        <Link to="/studio/firings" className="on">
          Firings
        </Link>
      </nav>

      {error && <div className="err">{error}</div>}

      {queue && (
        <div className="card queue-counts">
          <div>
            <strong>{queue.awaitingBisque}</strong>
            <span className="sub">waiting for a bisque firing</span>
          </div>
          <div>
            <strong>{queue.awaitingGlaze}</strong>
            <span className="sub">waiting for a glaze firing</span>
          </div>
        </div>
      )}

      {creating && (
        <form className="card schedule" onSubmit={(e) => void create(e)}>
          <h2>Schedule a firing</h2>

          <div className="fields">
            <label>
              Kiln
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Type
              <select
                value={firingType}
                onChange={(e) =>
                  setFiringType(e.target.value as 'BISQUE' | 'GLAZE')
                }
              >
                <option value="BISQUE">Bisque</option>
                <option value="GLAZE">Glaze</option>
              </select>
            </label>

            <label>
              Starts ({timezone})
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </label>

            <label>
              Hours, including cooling
              <input
                type="number"
                min={1}
                max={96}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Cone
              <input
                value={cone}
                onChange={(e) => setCone(e.target.value)}
                placeholder="04"
              />
            </label>
          </div>

          <p className="sub">
            The kiln is held for the whole span, cooling included — a load you
            cannot unpack until Tuesday morning occupies the kiln until then.
          </p>

          <button type="submit" disabled={busy || !resourceId || !startsAt}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </form>
      )}

      {firings.length === 0 && !error && (
        <EmptyState icon="△">No firings scheduled.</EmptyState>
      )}

      <div className="list">
        {firings.map((firing) => (
          <div key={firing.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>{firing.resource.name}</strong>
                <StatusPill status={firing.firingType} />
                <StatusPill status={firing.status} />
                <div className="sub">
                  {dateIn(firing.startsAt, timezone)} ·{' '}
                  {timeIn(firing.startsAt, timezone)} →{' '}
                  {timeIn(firing.endsAt, timezone)}
                  {firing.cone ? ` · cone ${firing.cone}` : ''}
                </div>
              </div>

              <div className="counts">
                {firing._count.pieces} piece
                {firing._count.pieces === 1 ? '' : 's'}
                <button className="link" onClick={() => toggleOpen(firing)}>
                  {openId === firing.id ? 'Close' : 'Open'}
                </button>
              </div>
            </div>

            {openId === firing.id && (
              <div className="waitlist">
                {!detail && <p className="sub">Loading…</p>}

                {detail && (
                  <>
                    <div className="row-head" style={{ cursor: 'default' }}>
                      <div className="sub">In the kiln</div>
                      <div className="counts">
                        {FLOW[firing.status].length === 0 ? (
                          <span className="sub">finished</span>
                        ) : (
                          FLOW[firing.status].map((next) => (
                            <button
                              key={next}
                              className={`link ${next === 'CANCELLED' ? 'danger' : ''}`}
                              onClick={() => void advance(firing, next)}
                              disabled={busy}
                            >
                              {humanise(next)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {detail.pieces.length === 0 && (
                      <p className="sub">Empty.</p>
                    )}

                    {detail.pieces.length > 0 && (
                      <ul className="queue">
                        {detail.pieces.map((piece) => (
                          <li key={piece.id}>
                            <span className="who">
                              {piece.label}
                              <span className="sub">{piece.customer.name}</span>
                            </span>
                            <StatusPill status={piece.status} />
                            {FLOW[firing.status].length > 0 && (
                              <button
                                className="link danger"
                                onClick={() => void unload(firing, piece.id)}
                                disabled={busy}
                              >
                                Take out
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {FLOW[firing.status].length > 0 && (
                      <div className="pack">
                        <div className="sub">
                          Waiting for a {firing.firingType.toLowerCase()} firing
                        </div>

                        {loadable.length === 0 && (
                          <p className="sub">
                            Nothing is waiting for this kind of firing.
                          </p>
                        )}

                        {loadable.length > 0 && (
                          <>
                            <ul className="queue">
                              {loadable.map((piece) => (
                                <li key={piece.id}>
                                  <label className="check">
                                    <input
                                      type="checkbox"
                                      checked={picked.has(piece.id)}
                                      onChange={(e) =>
                                        setPicked((current) => {
                                          const next = new Set(current);
                                          if (e.target.checked)
                                            next.add(piece.id);
                                          else next.delete(piece.id);
                                          return next;
                                        })
                                      }
                                    />
                                    <span className="who">
                                      {piece.label}
                                      <span className="sub">
                                        {piece.customer.name}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                            <button
                              onClick={() => void loadPieces(firing)}
                              disabled={busy || picked.size === 0}
                            >
                              Put {picked.size} in the kiln
                            </button>
                          </>
                        )}
                      </div>
                    )}
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
