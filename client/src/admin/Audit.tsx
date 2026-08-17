import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, type AuditEntry } from './types';

/**
 * The audit log.
 *
 * Read-only, and there is no route that could make it anything else — entries are
 * only ever written as a side effect of the action they describe, inside its
 * transaction. An entry an operator could author would not be a record of their
 * actions.
 */
export default function Audit() {
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = params.toString();

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ entries: AuditEntry[] }>(
        `/api/platform/audit${query ? `?${query}` : ''}`,
      )
      .then((res) => !cancelled && setEntries(res.entries))
      .catch(() => !cancelled && setError('Could not load the audit log.'));

    return () => {
      cancelled = true;
    };
  }, [query]);

  const organizationId = params.get('organizationId');

  return (
    <>
      <div className="page-head">
        <h1>Audit</h1>
        {entries && (
          <span className="sub">
            {entries.length} most recent {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {organizationId && (
        <div className="toolbar">
          <span className="sub">
            Filtered to one studio.{' '}
            <Link to={`/admin/studios/${organizationId}`}>Open it</Link>
          </span>
          <button
            className="link"
            onClick={() => setParams(new URLSearchParams())}
          >
            Show everything
          </button>
        </div>
      )}

      {error && <div className="err">{error}</div>}

      {!entries ? (
        <div className="empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty">
          Nothing recorded yet. Platform actions appear here as they happen.
        </div>
      ) : (
        <ul className="list audit-list">
          {entries.map((entry) => (
            <li key={entry.id} className="audit-entry">
              <div className="row-head">
                <span>
                  <strong>{entry.action}</strong>
                  {entry.organizationId && (
                    <>
                      {' '}
                      <Link
                        to={`/admin/studios/${entry.organizationId}`}
                        className="sub"
                      >
                        studio
                      </Link>
                    </>
                  )}
                </span>
                <span className="sub">{dateTime(entry.createdAt)}</span>
              </div>

              <div className="sub">
                {entry.actorEmail}
                {entry.ip && ` · ${entry.ip}`}
              </div>

              {/*
                The reason is given its own line and normal text weight rather
                than being tucked into the metadata blob. It is the field that
                makes the rest of the row worth keeping.
              */}
              {entry.reason && <p className="audit-reason">{entry.reason}</p>}

              {entry.metadata != null && (
                <details>
                  <summary className="sub">details</summary>
                  <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
