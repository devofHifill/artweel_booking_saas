import { useCallback, useEffect, useState } from 'react';
import { api, dateIn, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  PageHead,
  StatusPill,
  Tabs,
  Toolbar,
} from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonTable } from '../components/states';

/**
 * Notifications.
 *
 * Most of this existed on the server already — the delivery log, the template
 * defaults and overrides, and a preview renderer. What it never had was a
 * screen, so "did my customer get their reminder?" was answerable only from
 * psql, and a failed message stayed failed forever.
 *
 * The one thing added for this page is Retry, because the dashboard now tells
 * an owner that three customers were not sent their confirmation and that
 * sentence needs somewhere to lead.
 */

type LogRow = {
  id: string;
  channel: 'EMAIL' | 'SMS';
  templateKey: string;
  destination: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  attempts: number;
  scheduledFor: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
};

type Template = {
  templateKey: string;
  channel: 'EMAIL' | 'SMS';
  subject: string | null;
  body: string;
  isActive?: boolean;
};

const TABS = [
  { id: 'log', label: 'Delivery log' },
  { id: 'templates', label: 'Templates' },
];

/**
 * `booking.confirmed` → "Booking confirmed".
 *
 * The keys are dot-separated and lower case — `booking.confirmed`,
 * `reminder.24h`, `piece.ready`. Splitting on underscores alone left the dot in
 * place and rendered "Booking.confirmed" on every row, which reads as a leaked
 * identifier rather than a name for a message.
 */
function humanKey(key: string): string {
  const words = key.replace(/[._-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function Notifications() {
  const [tab, setTab] = useState('log');

  return (
    <>
      <PageHead
        title="Notifications"
        lede="What your customers were sent, and what they will be sent next time."
      />

      <Tabs items={TABS} active={tab} onChange={setTab} label="Notification sections" />

      {tab === 'log' ? <DeliveryLog /> : <Templates />}
    </>
  );
}

// --- Delivery log -----------------------------------------------------------

function DeliveryLog() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);

    try {
      const res = await api.get<{ notifications: LogRow[] }>(
        `${base}/notifications?${params}`,
      );
      setRows(res.notifications);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the log.');
    }
  }, [base, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(row: LogRow) {
    setBusy(row.id);
    setNotice(null);
    try {
      await api.post(`${base}/notifications/${row.id}/retry`);
      setNotice(`Queued again for ${row.destination}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send it again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Toolbar>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everything</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Waiting to send</option>
          <option value="SENT">Sent</option>
          <option value="SKIPPED">Skipped</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </Toolbar>

      {error && <div className="err">{error}</div>}
      {notice && (
        <div className="alert warn" role="status">
          {notice}
        </div>
      )}

      {!rows && !error && (
        <LoadingRegion label="Loading the delivery log">
          <SkeletonTable rows={6} cols={5} />
        </LoadingRegion>
      )}

      {rows && rows.length === 0 && (
        <EmptyState icon="✉" hint="Messages appear here as bookings are made.">
          Nothing sent yet.
        </EmptyState>
      )}

      {rows && rows.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Every message this studio has sent, with why any of them did not go"
            head={
              <tr>
                <th>When</th>
                <th>Message</th>
                <th>To</th>
                <th>Status</th>
                <th>Why</th>
                {isAdmin && <th style={{ width: 120 }} />}
              </tr>
            }
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="nowrap">
                  {dateIn(row.createdAt, timezone)}
                  <div className="sub tiny">{timeIn(row.createdAt, timezone)}</div>
                </td>
                <td>
                  {humanKey(row.templateKey)}
                  <div className="sub tiny">{row.channel.toLowerCase()}</div>
                </td>
                <td className="wrap-any">{row.destination}</td>
                <td>
                  <StatusPill status={row.status} />
                </td>
                <td className="reason">
                  {/*
                    SKIPPED rows carry the reason and it is usually the whole
                    answer: "they replied STOP in March" is a very different
                    thing from "we have no number for them".
                  */}
                  {row.lastError ? (
                    <span className="sub">{row.lastError}</span>
                  ) : row.attempts > 1 ? (
                    <span className="sub tiny">{row.attempts} attempts</span>
                  ) : (
                    <span className="sub">—</span>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    {row.status === 'FAILED' && (
                      <button
                        className="link"
                        disabled={busy === row.id}
                        onClick={() => void retry(row)}
                      >
                        {busy === row.id ? 'Sending…' : 'Send again'}
                      </button>
                    )}
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

// --- Templates --------------------------------------------------------------

/**
 * The wording of each message.
 *
 * Defaults and studio overrides arrive together so the editor can show which
 * messages have been changed and which are still the built-in text. An override
 * is an upsert on (studio, template, channel), so editing one is independent of
 * every other.
 */
function Templates() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const isAdmin = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [defaults, setDefaults] = useState<Template[] | null>(null);
  const [overrides, setOverrides] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: '', body: '' });
  const [preview, setPreview] = useState<{ subject?: string; body: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ defaults: Template[]; overrides: Template[] }>(
        `${base}/notifications/templates`,
      );
      setDefaults(res.defaults);
      setOverrides(res.overrides);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const keyOf = (t: Template) => `${t.templateKey}:${t.channel}`;
  const overrideFor = (t: Template) =>
    overrides.find((o) => keyOf(o) === keyOf(t));

  function startEdit(t: Template) {
    const current = overrideFor(t) ?? t;
    setEditing(keyOf(t));
    setForm({ subject: current.subject ?? '', body: current.body });
    setPreview(null);
  }

  async function save(t: Template) {
    setBusy(true);
    try {
      await api.put(`${base}/notifications/templates`, {
        templateKey: t.templateKey,
        channel: t.channel,
        subject: t.channel === 'EMAIL' ? form.subject : null,
        body: form.body,
        isActive: true,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(t: Template) {
    try {
      const res = await api.post<{ subject?: string; body: string }>(
        `${base}/notifications/templates/preview`,
        {
          templateKey: t.templateKey,
          channel: t.channel,
          subject: t.channel === 'EMAIL' ? form.subject : undefined,
          body: form.body,
        },
      );
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not render a preview.');
    }
  }

  if (error) return <div className="err">{error}</div>;

  if (!defaults) {
    return (
      <LoadingRegion label="Loading templates">
        <SkeletonTable rows={5} cols={3} />
      </LoadingRegion>
    );
  }

  return (
    <div className="template-list">
      {defaults.map((template) => {
        const override = overrideFor(template);
        const open = editing === keyOf(template);

        return (
          <section className="card template" key={keyOf(template)}>
            <header className="template-head">
              <div>
                <h3>
                  {humanKey(template.templateKey)}
                  <span className="chip on">{template.channel.toLowerCase()}</span>
                  {override ? (
                    <StatusPill status="ACTIVE">Your wording</StatusPill>
                  ) : (
                    <StatusPill status="DRAFT">Default</StatusPill>
                  )}
                </h3>
              </div>

              {isAdmin && (
                <button className="link" onClick={() => (open ? setEditing(null) : startEdit(template))}>
                  {open ? 'Close' : 'Edit'}
                </button>
              )}
            </header>

            {!open && (
              <pre className="template-body">{(override ?? template).body}</pre>
            )}

            {open && (
              <div className="template-edit">
                {template.channel === 'EMAIL' && (
                  <label>
                    Subject
                    <input
                      value={form.subject}
                      maxLength={200}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    />
                  </label>
                )}

                <label>
                  Message
                  <textarea
                    rows={6}
                    value={form.body}
                    maxLength={4000}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                  />
                </label>

                {/*
                  Tokens collapse silently when they resolve to nothing, by
                  design — a customer must never receive "Hi {{name}}". That
                  makes the preview the only way to catch a typo in a token
                  name, so it sits next to Save rather than somewhere else.
                */}
                <p className="sub tiny">
                  Tokens like <code>{'{{customerName}}'}</code> are filled in when
                  the message is sent. A token that does not exist disappears
                  rather than showing to your customer, so preview before saving.
                </p>

                <div className="toolbar">
                  <button className="primary" disabled={busy} onClick={() => void save(template)}>
                    Save
                  </button>
                  <button className="link" onClick={() => void showPreview(template)}>
                    Preview
                  </button>
                </div>

                {preview && (
                  <div className="template-preview">
                    <span className="preview-label">Preview</span>
                    {preview.subject && <p className="preview-subject">{preview.subject}</p>}
                    <pre className="template-body">{preview.body}</pre>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
