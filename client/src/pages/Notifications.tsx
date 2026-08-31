import { useCallback, useEffect, useRef, useState } from 'react';
import { api, dateIn, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import {
  DataTable,
  Kpi,
  PageHead,
  StatGrid,
  StatusPill,
  Tabs,
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
  /** Sent by somebody testing a template on themselves, not to a customer. */
  isTest: boolean;
};

type Template = {
  templateKey: string;
  channel: 'EMAIL' | 'SMS';
  subject: string | null;
  body: string;
  isActive?: boolean;
};

type Stats = {
  days: number;
  totals: {
    sent: number;
    failed: number;
    pending: number;
    skipped: number;
    cancelled: number;
    deliveryRate: number | null;
  };
  channels: {
    email: { sent: number; failed: number; deliveryRate: number | null };
    sms: { sent: number; failed: number; deliveryRate: number | null };
  };
  delivery: {
    emailFrom: string;
    smsConfigured: boolean;
    smsFrom: string | null;
    /** The hours in which a text MAY be sent, not the quiet ones. */
    sendingWindow: { fromHour: number; toHour: number };
  };
};

const TABS = [
  { id: 'log', label: 'Delivery log' },
  { id: 'templates', label: 'Templates' },
];

/** The status tabs over the log. One per status the outbox can record. */
const LOG_TABS = [
  { id: '', label: 'Everything' },
  { id: 'SENT', label: 'Sent' },
  { id: 'PENDING', label: 'Waiting' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'SKIPPED', label: 'Skipped' },
  { id: 'CANCELLED', label: 'Cancelled' },
] as const;

/** 8 → "8am", 21 → "9pm". Nobody says "21:00" about a text message. */
function hour12(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);

    try {
      const res = await api.get<{
        notifications: LogRow[];
        counts: Record<string, number>;
      }>(`${base}/notifications?${params}`);
      setRows(res.notifications);
      setCounts(res.counts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the log.');
    }
  }, [base, status]);

  /* The figures do not move with the status tab — they describe the last
     thirty days whatever is being listed — so they are fetched once. */
  useEffect(() => {
    api
      .get<Stats>(`${base}/notifications/stats`)
      .then(setStats)
      .catch(() => setStats(null));
  }, [base]);

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
      {stats && (
        <StatGrid>
          <Kpi
            label="Messages sent"
            value={String(stats.totals.sent)}
            foot={`in the last ${stats.days} days`}
          />
          <Kpi
            label="Arrived"
            value={
              stats.totals.deliveryRate === null
                ? '\u2014'
                : `${stats.totals.deliveryRate}%`
            }
            /* Skips are excluded from the rate and named here: a studio seeing
               them counted as failures would try to fix something that is
               working correctly. */
            foot={
              stats.totals.skipped > 0
                ? `${stats.totals.skipped} held by a rule, not counted`
                : 'of everything attempted'
            }
          />
          <Kpi
            label="Failed"
            value={String(stats.totals.failed)}
            tone={stats.totals.failed > 0 ? 'red' : undefined}
            foot={stats.totals.failed > 0 ? 'each can be sent again' : 'nothing bounced'}
          />
          <Kpi
            label="Waiting"
            value={String(stats.totals.pending)}
            foot="queued or scheduled ahead"
          />
        </StatGrid>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 'var(--space-4)' }}>
        <div className="tabs-wrap">
          <div className="tabs" role="tablist" aria-label="Message status">
            {LOG_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={status === tab.id}
                className={`tab ${status === tab.id ? 'on' : ''}`.trim()}
                onClick={() => setStatus(tab.id)}
              >
                {tab.label}
                {/* A blank is not a zero — `counts` only carries statuses that
                    have rows, and a missing pill reads as "unknown". */}
                {counts.total !== undefined && (
                  <span className="pill">
                    {counts[tab.id === '' ? 'total' : tab.id] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

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
                  {row.isTest && <span className="tag">test</span>}
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

      {stats && <HowMessagesGoOut delivery={stats.delivery} channels={stats.channels} />}
    </>
  );
}

/**
 * Why a message might not have gone.
 *
 * Quiet hours and opt-out are enforced in the outbox and were explained
 * nowhere, which makes a SKIPPED row a mystery unless you already know the
 * rules. Every one of these is a PLATFORM setting rather than a studio one,
 * and the panel says so: showing a rule with no way to change it sends
 * somebody hunting for a knob that does not exist.
 */
function HowMessagesGoOut({
  delivery,
  channels,
}: {
  delivery: Stats['delivery'];
  channels: Stats['channels'];
}) {
  return (
    <section className="card panel" style={{ marginTop: 'var(--space-4)' }}>
      <header className="panel-head">
        <h2>How messages go out</h2>
        <span className="head-figure">set by the platform, not this studio</span>
      </header>

      <div className="panel-body">
        <div className="mini-list">
          <div className="mini-row">
            <span className="mini-main">
              <b>Email</b>
              <span className="tiny muted">from {delivery.emailFrom}</span>
            </span>
            <span className="mini-end tiny muted">
              {channels.email.deliveryRate === null
                ? 'nothing sent yet'
                : `${channels.email.deliveryRate}% arrived`}
            </span>
          </div>

          <div className="mini-row">
            <span className="mini-main">
              <b>Text messages</b>
              <span className="tiny muted">
                {delivery.smsConfigured
                  ? `from ${delivery.smsFrom}`
                  : 'no provider connected, so texts are recorded and not sent'}
              </span>
            </span>
            <span className="mini-end">
              {delivery.smsConfigured ? (
                <span className="tiny muted">
                  {channels.sms.deliveryRate === null
                    ? 'nothing sent yet'
                    : `${channels.sms.deliveryRate}% arrived`}
                </span>
              ) : (
                <StatusPill status="PENDING">Not connected</StatusPill>
              )}
            </span>
          </div>
        </div>

        {/*
          Written from what `applyQuietHours` actually does, which is not what
          the config's names suggest: 8-21 is the window in which texts MAY be
          sent, evaluated in the CLASS's zone, and it defers reminders only —
          a confirmation goes the moment it is created, at any hour. The first
          draft of this sentence called 8am-9pm "quiet hours" and put them in
          the customer's zone, which was wrong twice.
        */}
        <p className="sub tiny">
          Text reminders go out between{' '}
          {hour12(delivery.sendingWindow.fromHour)} and{' '}
          {hour12(delivery.sendingWindow.toHour)} in the class's own time zone;
          anything due outside that waits until{' '}
          {hour12(delivery.sendingWindow.fromHour)}. Confirmations are sent
          straight away, whatever the hour. Anyone who replies STOP stops
          receiving texts immediately, and that beats any consent recorded
          earlier.
        </p>
      </div>
    </section>
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
  const [tokens, setTokens] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  /* The editor's textarea, so a token lands where the cursor is rather than
     at the end of whatever has been typed. */
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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
    setTestNote(null);

    /*
      The preview is fetched on open rather than on demand, because it is also
      where the token list comes from. `availableTokens` has been in that
      response since B5 with nothing reading it, and a token list that is
      generated by the same call that renders them cannot drift from what the
      renderer actually knows — which a hard-coded list on this page would, the
      first time a token was added.
    */
    void renderPreview(t, {
      subject: current.subject ?? '',
      body: current.body,
    });
  }

  async function renderPreview(t: Template, draft: { subject: string; body: string }) {
    try {
      const res = await api.post<{
        subject?: string;
        body: string;
        availableTokens: string[];
      }>(`${base}/notifications/templates/preview`, {
        templateKey: t.templateKey,
        channel: t.channel,
        subject: t.channel === 'EMAIL' ? draft.subject : undefined,
        body: draft.body,
      });
      setPreview(res);
      setTokens(res.availableTokens ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not render a preview.');
    }
  }

  /** Inserts a token where the cursor is, and puts the cursor after it. */
  function insertToken(token: string) {
    const area = bodyRef.current;
    const text = `{{${token}}}`;

    if (!area) {
      setForm((current) => ({ ...current, body: current.body + text }));
      return;
    }

    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const next = area.value.slice(0, start) + text + area.value.slice(end);

    setForm((current) => ({ ...current, body: next }));

    /* After React has re-rendered with the new value — setting it before then
       would put the caret back where the old value ended. */
    requestAnimationFrame(() => {
      area.focus();
      area.selectionStart = area.selectionEnd = start + text.length;
    });
  }

  async function sendTest(t: Template) {
    setTesting(true);
    setTestNote(null);
    try {
      const res = await api.post<{ queued: boolean; destination: string }>(
        `${base}/notifications/templates/test`,
        {
          templateKey: t.templateKey,
          channel: t.channel,
          subject: t.channel === 'EMAIL' ? form.subject : undefined,
          body: form.body,
        },
      );
      setTestNote(`Sent to ${res.destination}. It appears in the delivery log.`);
    } catch (err) {
      setTestNote(
        err instanceof Error ? err.message : 'Could not send a test message.',
      );
    } finally {
      setTesting(false);
    }
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
                    ref={bodyRef}
                    rows={6}
                    value={form.body}
                    maxLength={4000}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                  />
                </label>

                {/* The tokens this message can actually use, from the renderer
                    itself rather than a list on this page that would fall
                    behind it. Clicking one drops it at the cursor. */}
                {tokens.length > 0 && (
                  <div className="chips token-chips">
                    {tokens.map((token) => (
                      <button
                        type="button"
                        className="chip"
                        key={token}
                        onClick={() => insertToken(token)}
                      >
                        {`{{${token}}}`}
                      </button>
                    ))}
                  </div>
                )}

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
                  <button
                    className="link"
                    onClick={() => void renderPreview(template, form)}
                  >
                    Preview
                  </button>
                  {/*
                    Preview renders the words; this proves the pipe. It goes to
                    YOUR address and nowhere else — there is no field to type a
                    recipient into, because an endpoint that sends studio text
                    to an arbitrary address is a spam relay with a login page.
                  */}
                  <button
                    className="link"
                    disabled={testing}
                    onClick={() => void sendTest(template)}
                  >
                    {testing ? 'Sending…' : 'Send me a test'}
                  </button>
                </div>

                {testNote && (
                  <p className="sub tiny" role="status">
                    {testNote}
                  </p>
                )}

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
