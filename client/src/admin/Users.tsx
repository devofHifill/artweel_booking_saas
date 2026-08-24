import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { shortDate } from './types';
import { LoadingRegion, SkeletonTable } from '../components/states';

/**
 * Every user, across every studio.
 *
 * The only screen in the product that reads across tenants, which is why the
 * one action on it is heavily guarded and why the reason field is not optional.
 *
 * Filters live in the URL, matching Studios: an operator can bookmark or share
 * "the disabled accounts" without rebuilding the filter by hand.
 */

type PlatformUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  disabled: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  studios: { id: string; name: string; slug: string; role: string }[];
};

type UserList = {
  users: PlatformUser[];
  total: number;
  limit: number;
  offset: number;
};

const STATUSES = [
  { value: '', label: 'Everyone' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'unverified', label: 'Unverified' },
];

const MIN_REASON = 8;

export default function Users() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<UserList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [acting, setActing] = useState<PlatformUser | null>(null);

  const query = params.toString();

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        await api.get<UserList>(
          `/api/platform/users${query ? `?${query}` : ''}`,
        ),
      );
    } catch {
      setError('Could not load users.');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setParams(next);
  }

  return (
    <>
      <header className="page-head">
        <div className="ph-text">
          <h1>Users</h1>
          <p className="lede">
            Everyone with an account, across every studio. {data?.total ?? 0} in
            total.
          </p>
        </div>
      </header>

      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update('search', search.trim());
          }}
        >
          <input
            type="search"
            value={search}
            placeholder="Email or name"
            aria-label="Search users"
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <select
          value={params.get('status') ?? ''}
          aria-label="Status"
          onChange={(e) => update('status', e.target.value)}
        >
          {STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      {!data && !error && (
        <LoadingRegion label="Loading users">
          <SkeletonTable rows={6} cols={4} />
        </LoadingRegion>
      )}

      {data && (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Studios</th>
              <th scope="col">Joined</th>
              <th scope="col">Status</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {data.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <div className="tiny muted">{user.email}</div>
                </td>

                <td>
                  {user.studios.length === 0 ? (
                    <span className="tiny muted">none</span>
                  ) : (
                    user.studios.map((studio) => (
                      <div key={studio.id} className="tiny">
                        <Link to={`/admin/studios/${studio.id}`}>
                          {studio.name}
                        </Link>{' '}
                        <span className="muted">{studio.role.toLowerCase()}</span>
                      </div>
                    ))
                  )}
                </td>

                <td className="tiny muted">{shortDate(user.createdAt)}</td>

                <td>
                  {user.disabled ? (
                    <span className="tag off">disabled</span>
                  ) : user.emailVerified ? (
                    <span className="tag">active</span>
                  ) : (
                    <span className="tag">unverified</span>
                  )}
                  {user.disabled && user.disabledReason && (
                    <div className="tiny muted">{user.disabledReason}</div>
                  )}
                </td>

                <td>
                  <button
                    className={user.disabled ? '' : 'danger'}
                    onClick={() => setActing(user)}
                  >
                    {user.disabled ? 'Enable' : 'Disable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {acting && (
        <DisableForm
          user={acting}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/**
 * The reason is required and the consequence is spelled out.
 *
 * Disabling signs the person out of every device immediately, which is not
 * obvious from a button labelled "Disable" — and it is the part an operator
 * will be asked about afterwards.
 */
function DisableForm({
  user,
  onClose,
  onDone,
}: {
  user: PlatformUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabling = !user.disabled;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.post(`/api/platform/users/${user.id}/disabled`, {
        disabled: disabling,
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      // The server's message is the useful one — it knows why it refused, and
      // paraphrasing here would mean two places to keep in agreement.
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>
        {disabling ? 'Disable' : 'Enable'} {user.email}
      </h2>

      <p className="sub">
        {disabling ? (
          <>
            They will be signed out on every device immediately and cannot sign
            in again. Nothing is deleted — their studios, bookings and history
            stay exactly as they are.
          </>
        ) : (
          <>
            They will be able to sign in again. They will need to log in fresh:
            the sessions cut when the account was disabled are not restored.
          </>
        )}
      </p>

      <form onSubmit={submit}>
        <label>
          Reason
          <input
            type="text"
            required
            minLength={MIN_REASON}
            value={reason}
            placeholder="e.g. chargeback fraud on ticket #91"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p className="tiny muted">
          Goes in the audit log. At least {MIN_REASON} characters.
        </p>

        {error && (
          <div className="alert danger" role="alert">
            {error}
          </div>
        )}

        <div className="page-actions">
          <button
            type="submit"
            className={disabling ? 'danger' : 'primary'}
            disabled={busy || reason.trim().length < MIN_REASON}
          >
            {busy ? 'Saving…' : disabling ? 'Disable account' : 'Enable account'}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
