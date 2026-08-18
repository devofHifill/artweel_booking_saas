import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

/**
 * The pack catalogue: what a studio sells, not who bought it.
 *
 * Selling happens on the customer, because that is where the question is asked
 * ("can I get ten classes?"). This screen only decides what is on the menu.
 */

type Pack = {
  id: string;
  name: string;
  description: string | null;
  creditCount: number;
  priceCents: number;
  validityDays: number;
  isActive: boolean;
};

export default function Packs() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [creditCount, setCreditCount] = useState(10);
  const [price, setPrice] = useState('300');
  const [validityDays, setValidityDays] = useState(365);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ packs: Pack[] }>(`${base}/packs`);
      setPacks(res.packs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load packs.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    try {
      await api.post(`${base}/packs`, {
        name: name.trim(),
        creditCount,
        priceCents: Math.round(Number(price) * 100),
        validityDays,
      });
      setName('');
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create it.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Retiring rather than deleting.
   *
   * The API refuses to delete a pack somebody has bought, for the same reason
   * nothing else with history is hard-deleted — the purchase has to keep
   * meaning something. Taking it off the menu is the usual intent anyway.
   */
  async function setActive(pack: Pack, isActive: boolean) {
    setBusy(true);
    try {
      await api.patch(`${base}/packs/${pack.id}`, { isActive });
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-head">
        <h1>Class packs</h1>
        {isAdmin && (
          <div className="toolbar">
            <button onClick={() => setCreating((v) => !v)}>
              {creating ? 'Close' : 'New pack'}
            </button>
          </div>
        )}
      </header>

      {error && <div className="err">{error}</div>}

      {isAdmin && creating && (
        <form className="card schedule" onSubmit={(e) => void create(e)}>
          <h2>New pack</h2>

          <div className="fields">
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ten classes"
                required
              />
            </label>

            <label>
              Classes
              <input
                type="number"
                min={1}
                max={200}
                value={creditCount}
                onChange={(e) => setCreditCount(Number(e.target.value))}
                required
              />
            </label>

            <label>
              Price
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </label>

            <label>
              Good for (days, 0 = forever)
              <input
                type="number"
                min={0}
                max={3650}
                value={validityDays}
                onChange={(e) => setValidityDays(Number(e.target.value))}
                required
              />
            </label>
          </div>

          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {packs.length === 0 && !error && (
        <div className="card empty-state">
          <span className="empty-mark" aria-hidden="true">❏</span>
          <p className="empty-title">Nothing on the menu yet.</p>
        </div>
      )}

      <div className="list">
        {packs.map((pack) => (
          <div key={pack.id} className="card">
            <div className="row-head" style={{ cursor: 'default' }}>
              <div>
                <strong>{pack.name}</strong>
                {!pack.isActive && <span className="tag">retired</span>}
                <div className="sub">
                  {pack.creditCount} classes · {money(pack.priceCents, currency)}
                  {' · '}
                  {pack.validityDays > 0
                    ? `good for ${pack.validityDays} days`
                    : 'no expiry'}
                </div>
              </div>

              {isAdmin && (
                <div className="counts">
                  <button
                    className={`link ${pack.isActive ? 'danger' : ''}`}
                    onClick={() => void setActive(pack, !pack.isActive)}
                    disabled={busy}
                  >
                    {pack.isActive ? 'Retire' : 'Put back on sale'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
