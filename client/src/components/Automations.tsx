import { useCallback, useEffect, useState } from 'react';
import { api, dateIn } from '../lib/api';
import { DataTable, Modal } from './layout';
import { LoadingRegion, SkeletonTable } from './states';
import { Icon } from './Icon';

/**
 * Every message the product can send, and whether this studio sends it.
 *
 * Built from the CODE's list of templates rather than from the outbox. A
 * studio that has never had a waitlist offer fire still needs to see the rule
 * and see that it is on — a table assembled from sent messages would show them
 * nothing and imply the feature does not exist.
 *
 * The switch is real. Turning a rule off does not hide anything: the outbox
 * worker marks that studio's queued messages SKIPPED instead of delivering
 * them, which is a status the delivery log already has a tab for. A toggle
 * that only changed a colour would be the worst possible version of this
 * feature — an owner would believe reminders had stopped while customers kept
 * receiving them.
 */

type Template = {
  templateKey: string;
  channel: 'EMAIL' | 'SMS';
  subject: string | null;
  body: string;
};

export type Automation = {
  templateKey: string;
  name: string;
  trigger: string;
  /** True for messages a customer is entitled to expect. Warns, never blocks. */
  essential: boolean;
  channels: ('EMAIL' | 'SMS')[];
  customised: boolean;
  enabled: boolean;
  sentLast30Days: number;
  lastSentAt: string | null;
};

/**
 * "4 minutes ago".
 *
 * Relative, because the column is read at a glance to answer "is this thing
 * working" — and a timestamp makes you do the subtraction yourself. The exact
 * time is on the cell's title for when it matters.
 */
function ago(iso: string | null): string {
  if (!iso) return 'Never';

  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'Just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

export function Automations({
  base,
  isAdmin,
  timezone,
  onEdit,
}: {
  base: string;
  isAdmin: boolean;
  timezone: string;
  onEdit: (templateKey: string) => void;
}) {
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    name: string;
    subject?: string;
    body: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ automations: Automation[] }>(
        `${base}/notifications/automations`,
      );
      setRows(res.automations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The studio's own wording for a message, or the built-in text.
   *
   * Fetched fresh on each action rather than held in state: the editor below
   * this table can change it, and a preview or a test built from a stale copy
   * would show the studio something other than what their customers get —
   * which is the one thing these three buttons exist to prevent.
   */
  async function effectiveEmail(templateKey: string): Promise<Template> {
    const { defaults, overrides } = await api.get<{
      defaults: Template[];
      overrides: Template[];
    }>(`${base}/notifications/templates`);

    const match = (t: Template) =>
      t.templateKey === templateKey && t.channel === 'EMAIL';

    const found = overrides.find(match) ?? defaults.find(match);
    if (!found) throw new Error('That message has no email template.');
    return found;
  }

  async function toggle(row: Automation) {
    /*
      Confirmed only when switching OFF an essential message, and the wording
      says what the CUSTOMER experiences rather than what the setting does.
      "Turn off booking confirmation?" invites yes; "guests will not hear
      anything back" is the fact somebody needs before answering.
    */
    if (row.enabled && row.essential) {
      const ok = window.confirm(
        `Turn off "${row.name}"?\n\nGuests will no longer receive this message. ` +
          'It is one your customers are likely to expect, so they may contact ' +
          'you asking what happened.',
      );
      if (!ok) return;
    }

    setBusy(row.templateKey);
    setNote(null);

    try {
      await api.patch(`${base}/notifications/automations/${row.templateKey}`, {
        enabled: !row.enabled,
      });
      setNote(
        row.enabled
          ? `${row.name} is off. Messages already queued will be marked skipped rather than sent.`
          : `${row.name} is back on.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(null);
    }
  }

  /** The rendered message with sample values. Read only — Edit is separate. */
  async function showPreview(row: Automation) {
    setBusy(row.templateKey);
    setError(null);

    try {
      const template = await effectiveEmail(row.templateKey);
      const res = await api.post<{ subject?: string; body: string }>(
        `${base}/notifications/templates/preview`,
        {
          templateKey: row.templateKey,
          channel: 'EMAIL',
          subject: template.subject ?? undefined,
          body: template.body,
        },
      );
      setPreview({ name: row.name, subject: res.subject, body: res.body });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Send now.
   *
   * The prototype fakes this with a toast. Here it really sends — to YOUR
   * address, which is the only honest reading of "send now" on a row that
   * describes an automated message. There is no customer to send it to: this
   * message fires when somebody books, not when an owner clicks a button, and
   * an endpoint that posted studio-authored text to a typed-in address would
   * be a spam relay with a login page.
   */
  async function sendNow(row: Automation) {
    setBusy(row.templateKey);
    setNote(null);
    setError(null);

    try {
      const template = await effectiveEmail(row.templateKey);
      const res = await api.post<{ destination: string }>(
        `${base}/notifications/templates/test`,
        {
          templateKey: row.templateKey,
          channel: 'EMAIL',
          subject: template.subject ?? undefined,
          body: template.body,
        },
      );
      setNote(`${row.name} sent to ${res.destination}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(null);
    }
  }

  if (!rows) {
    return (
      <LoadingRegion label="Loading automations">
        <SkeletonTable rows={5} cols={6} />
      </LoadingRegion>
    );
  }

  return (
    <>
      {error && <div className="err">{error}</div>}

      <section className="card automations" style={{ padding: 0 }}>
        <header className="automations-head">
          <h2>Automations</h2>
          <span className="tiny muted">
            {isAdmin ? 'Toggle any rule on or off' : 'Read only'}
          </span>
        </header>

        {note && (
          <p className="automations-note sub tiny" role="status">
            {note}
          </p>
        )}

        <DataTable
          caption="Automated messages, when they fire, and whether they are switched on"
          head={
            <tr>
              <th>Notification</th>
              <th>Trigger</th>
              <th>Channel</th>
              <th>Last sent</th>
              <th className="num">30 days</th>
              <th>Status</th>
              {/* Unlabelled: a header over three icon buttons reads as a
                  column of data that is not there. */}
              <th aria-label="Actions" />
            </tr>
          }
        >
          {rows.map((row) => (
            <tr
              key={row.templateKey}
              className={row.enabled ? '' : 'row-inactive'}
            >
              <td>
                <span className="auto-name">
                  <b>{row.name}</b>
                  {row.customised && (
                    <span className="tiny muted">Your wording</span>
                  )}
                </span>
              </td>
              <td className="muted">{row.trigger}</td>
              <td>
                {/* One chip for the whole rule, matching how an owner thinks
                    about it. Whether a given guest gets the text depends on
                    their own consent, which is not the studio's to set. */}
                <span className="chip on">
                  {row.channels
                    .map((c) => (c === 'EMAIL' ? 'Email' : 'SMS'))
                    .join(' + ')}
                </span>
              </td>
              <td
                className="tiny muted"
                title={
                  row.lastSentAt ? dateIn(row.lastSentAt, timezone) : undefined
                }
              >
                {ago(row.lastSentAt)}
              </td>
              <td className="num">{row.sentLast30Days}</td>
              <td>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${row.name} is ${row.enabled ? 'on' : 'off'}`}
                  className={`switch${row.enabled ? ' on' : ''}`}
                  disabled={!isAdmin || busy === row.templateKey}
                  onClick={() => void toggle(row)}
                >
                  <span className="switch-knob" />
                </button>
              </td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Preview"
                    aria-label={`Preview ${row.name}`}
                    disabled={busy === row.templateKey}
                    onClick={() => void showPreview(row)}
                  >
                    <Icon name="eye" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Send one to me"
                    aria-label={`Send ${row.name} to me`}
                    disabled={!isAdmin || busy === row.templateKey}
                    onClick={() => void sendNow(row)}
                  >
                    <Icon name="send" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Edit the wording"
                    aria-label={`Edit ${row.name}`}
                    disabled={!isAdmin}
                    onClick={() => onEdit(row.templateKey)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      {preview && (
        <Modal
          title={`${preview.name} — preview`}
          onClose={() => setPreview(null)}
        >
          {preview.subject && (
            <p className="preview-subject">{preview.subject}</p>
          )}
          <pre className="template-body">{preview.body}</pre>
          <div className="counter-foot">
            <span className="tiny muted">
              Filled in with sample details, not a real booking.
            </span>
            <div className="counter-actions">
              <button type="button" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
