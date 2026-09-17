import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { DataTable, StatusPill } from './layout';

/**
 * The Settings sections added on 2026-09-07 to match the prototype's list.
 *
 * ONE RULE RUNS THROUGH ALL OF THESE: a control here only exists if something
 * reads it. Settings is the screen where a decorative field does the most
 * damage — a dashboard tile that lies is embarrassing, a SETTING that lies
 * changes what an operator believes their business is doing, and they find out
 * from a customer or an accountant rather than from us.
 *
 * So the prototype's tax rate, service fee and permission matrix are not here.
 * Where the prototype offers a control we cannot honour, this shows the truth
 * instead — including when the truth is "this is set by us, not by you".
 *
 * Two controls are present but qualified ON SCREEN rather than silently:
 *
 * - The SPF/DKIM badge reports the real state instead of the prototype's
 *   hardcoded "Active". It is the same feature as the from-address beside it,
 *   and a studio believing its domain is verified when it is not would find
 *   out through confirmations that stop arriving.
 * - The SMS sender ID is recorded and not yet used, because an alphanumeric
 *   sender has to be registered per studio through the same A2P 10DLC queue
 *   that has US texting blocked. The panel says so.
 */

type Org = {
  name: string;
  legalName: string | null;
  address: string | null;
  website: string | null;
  businessType: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  emailBcc: string | null;
  emailFooter: string | null;
  emailFromAddress: string | null;
  emailDomainStatus: 'NOT_SET' | 'PENDING' | 'ACTIVE';
  smsEnabled: boolean;
  smsSenderId: string | null;
  smsQuietFromHour: number;
  smsQuietToHour: number;
  dateFormat: string;
  timeFormat: string;
  currency: string;
  timezone: string;
  defaultMinNoticeMinutes: number;
  defaultMaxHorizonDays: number;
  seatHoldMinutes: number;
  overbookingBuffer: number;
  allowSameDayBookings: boolean;
  autoConfirmOnPayment: boolean;
  requireWaiver: boolean;
  requirePhoneAtCheckout: boolean;
  allowChildTickets: boolean;
  depositsEnabled: boolean;
  defaultDepositPercent: number;
  allowPayOnArrival: boolean;
  acceptCash: boolean;
};

/**
 * What the SPF/DKIM badge says.
 *
 * Three real states, because the middle one matters: a studio that has been
 * given DNS records and has not published them yet is in a different position
 * from one that has never asked, and telling them apart is the difference
 * between "do nothing" and "your records are not live".
 */
const DOMAIN_STATUS: Record<
  Org['emailDomainStatus'],
  { label: string; tone: string }
> = {
  NOT_SET: { label: 'Not set up', tone: 'DRAFT' },
  PENDING: { label: 'Waiting for DNS', tone: 'PENDING' },
  ACTIVE: { label: 'Active', tone: 'CONFIRMED' },
};

/** A labelled switch, reusing the one built for the Automations table. */
function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="rule-toggle">
      {/*
        A button with role="switch", not a checkbox — same reasoning as the
        Automations table: this performs an action against the server and can
        be refused, and an optimistic checkbox that snaps back is how somebody
        comes to believe a rule is on when it is not.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`switch${on ? ' on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="switch-knob" />
      </button>
      <span>{label}</span>
    </div>
  );
}

/** Shared save plumbing: PATCH the organisation, report, re-read. */
function useOrgSave() {
  const base = useOrgBase();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.patch(`${base}/`.replace(/\/$/, ''), patch);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return { save, busy, saved, error };
}

function useOrgSettings() {
  const base = useOrgBase();
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ organization: Org }>(`${base}`)
      .then((res) => setOrg(res.organization))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load.'),
      );
  }, [base]);

  return { org, setOrg, error };
}

function Footer({
  busy,
  saved,
  onSave,
}: {
  busy: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="toolbar">
      <button className="primary" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
      {saved && (
        <span className="tiny muted" role="status">
          Saved.
        </span>
      )}
    </div>
  );
}

// --- Booking settings -------------------------------------------------------

export function BookingSettingsSection() {
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();

  const [form, setForm] = useState({
    noticeHours: '0',
    horizonDays: '120',
    seatHoldMinutes: '15',
    overbookingBuffer: '0',
    allowSameDayBookings: true,
    autoConfirmOnPayment: true,
    requireWaiver: false,
    requirePhoneAtCheckout: false,
    allowChildTickets: true,
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      /*
        Stored in MINUTES, shown in HOURS.

        Minutes because that is what `service_types.min_notice_minutes` holds
        and what availability compares against; hours because that is how a
        studio says it. Rounded on the way in, so 90 minutes reads as 2 rather
        than 1.5 — a whole-number box showing a fraction is a box people type
        nonsense into.
      */
      noticeHours: String(Math.round(org.defaultMinNoticeMinutes / 60)),
      horizonDays: String(org.defaultMaxHorizonDays),
      seatHoldMinutes: String(org.seatHoldMinutes),
      overbookingBuffer: String(org.overbookingBuffer),
      allowSameDayBookings: org.allowSameDayBookings,
      autoConfirmOnPayment: org.autoConfirmOnPayment,
      requireWaiver: org.requireWaiver,
      requirePhoneAtCheckout: org.requirePhoneAtCheckout,
      allowChildTickets: org.allowChildTickets,
    });
  }, [org]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>Booking rules</h2>
      <p className="sub">
        How far ahead guests can book and what they must provide.
      </p>

      {error && <div className="err">{error}</div>}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="brNotice">Minimum notice (hours)</label>
          <input
            id="brNotice"
            type="number"
            min={0}
            max={336}
            value={form.noticeHours}
            onChange={(e) => setForm({ ...form, noticeHours: e.target.value })}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="brHorizon">Maximum advance (days)</label>
          <input
            id="brHorizon"
            type="number"
            min={1}
            max={730}
            value={form.horizonDays}
            onChange={(e) => setForm({ ...form, horizonDays: e.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="brHold">Seat hold during checkout (minutes)</label>
          <input
            id="brHold"
            type="number"
            min={1}
            max={60}
            value={form.seatHoldMinutes}
            onChange={(e) =>
              setForm({ ...form, seatHoldMinutes: e.target.value })
            }
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="brBuffer">Overbooking buffer</label>
          <input
            id="brBuffer"
            type="number"
            min={0}
            max={20}
            value={form.overbookingBuffer}
            onChange={(e) =>
              setForm({ ...form, overbookingBuffer: e.target.value })
            }
          />
        </div>
      </div>

      <div className="rule-toggles">
        <Toggle
          on={form.allowSameDayBookings}
          label="Allow same-day bookings"
          onChange={(v) => setForm({ ...form, allowSameDayBookings: v })}
        />
        <Toggle
          on={form.autoConfirmOnPayment}
          label="Confirm bookings automatically when payment succeeds"
          onChange={(v) => setForm({ ...form, autoConfirmOnPayment: v })}
        />
        <Toggle
          on={form.requireWaiver}
          label="Require a signed waiver before departure"
          onChange={(v) => setForm({ ...form, requireWaiver: v })}
        />
        <Toggle
          on={form.requirePhoneAtCheckout}
          label="Require a phone number at checkout"
          onChange={(v) => setForm({ ...form, requirePhoneAtCheckout: v })}
        />
        <Toggle
          on={form.allowChildTickets}
          label="Allow child tickets where the activity supports them"
          onChange={(v) => setForm({ ...form, allowChildTickets: v })}
        />
      </div>

      {/*
        Two of these do something narrower than their label implies, and saying
        so costs less than an operator finding out from a customer.
      */}
      <div className="alert" role="note">
        <b>Notice</b> and <b>advance</b> are what a <b>new</b> activity starts
        with — activities you have already set up keep their own.{' '}
        <b>Require a signed waiver</b> flags guests who have not signed on the
        register and the daily manifest; it does not stop them booking, because
        nothing here collects the document itself.
      </div>

      <Footer
        busy={busy}
        saved={saved}
        onSave={() =>
          void save({
            defaultMinNoticeMinutes: (Number(form.noticeHours) || 0) * 60,
            defaultMaxHorizonDays: Number(form.horizonDays) || 120,
            seatHoldMinutes: Number(form.seatHoldMinutes) || 15,
            overbookingBuffer: Number(form.overbookingBuffer) || 0,
            allowSameDayBookings: form.allowSameDayBookings,
            autoConfirmOnPayment: form.autoConfirmOnPayment,
            requireWaiver: form.requireWaiver,
            requirePhoneAtCheckout: form.requirePhoneAtCheckout,
            allowChildTickets: form.allowChildTickets,
          })
        }
      />
    </section>
  );
}

// --- Email ------------------------------------------------------------------

export function EmailSettingsSection() {
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();
  const [form, setForm] = useState({
    emailFromName: '',
    emailFromAddress: '',
    emailReplyTo: '',
    emailBcc: '',
    emailFooter: '',
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      emailFromName: org.emailFromName ?? '',
      emailFromAddress: org.emailFromAddress ?? '',
      emailReplyTo: org.emailReplyTo ?? '',
      emailBcc: org.emailBcc ?? '',
      emailFooter: org.emailFooter ?? '',
    });
  }, [org]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>Email</h2>
      <p className="sub">Where your transactional email comes from.</p>

      {error && <div className="err">{error}</div>}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="esName">From name</label>
          <input
            id="esName"
            maxLength={120}
            value={form.emailFromName}
            placeholder={org.name}
            onChange={(e) => setForm({ ...form, emailFromName: e.target.value })}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="esFrom">From address</label>
          <input
            id="esFrom"
            type="email"
            maxLength={254}
            value={form.emailFromAddress}
            placeholder="bookings@yourstudio.com"
            onChange={(e) =>
              setForm({ ...form, emailFromAddress: e.target.value })
            }
          />
        </div>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="esReply">Reply-to</label>
          <input
            id="esReply"
            type="email"
            maxLength={254}
            value={form.emailReplyTo}
            placeholder="hello@yourstudio.com"
            onChange={(e) => setForm({ ...form, emailReplyTo: e.target.value })}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="esBcc">BCC every message to</label>
          <input
            id="esBcc"
            type="email"
            maxLength={254}
            value={form.emailBcc}
            placeholder="optional"
            onChange={(e) => setForm({ ...form, emailBcc: e.target.value })}
          />
        </div>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="esFooter">Email footer</label>
        <textarea
          id="esFooter"
          rows={3}
          maxLength={1000}
          value={form.emailFooter}
          placeholder="Your studio · address · phone"
          onChange={(e) => setForm({ ...form, emailFooter: e.target.value })}
        />
      </div>

      {/*
        The badge reports the REAL state and is not a decoration.

        Domain authentication is the same feature as the from-address above:
        Resend refuses a from-address on an unverified domain with a 403, so
        the address is stored whenever it is typed and USED only while this
        reads Active. A hardcoded "Active" here would be a claim about DNS
        records that do not exist, on the one screen where believing it means
        your confirmations stop arriving.
      */}
      <div className="domain-auth">
        <span>Domain authentication (SPF + DKIM)</span>
        <StatusPill status={DOMAIN_STATUS[org.emailDomainStatus].tone}>
          {DOMAIN_STATUS[org.emailDomainStatus].label}
        </StatusPill>
      </div>

      {org.emailDomainStatus !== 'ACTIVE' && (
        <p className="tiny muted">
          Until this is set up, mail goes out from our address with your name
          on it, and anything in <b>From address</b> is saved but not used —
          sending from an unverified domain is refused outright rather than
          quietly delivered. Get in touch and we will set up the DNS records.
        </p>
      )}

      <Footer busy={busy} saved={saved} onSave={() => void save(form)} />
    </section>
  );
}

// --- SMS --------------------------------------------------------------------

/** "21:00" ⇄ 21. The inputs are times; the columns are whole hours. */
const hourToTime = (h: number) => `${String(h).padStart(2, '0')}:00`;
const timeToHour = (v: string) => {
  const parsed = Number(v.split(':')[0]);
  return Number.isFinite(parsed) ? Math.min(23, Math.max(0, parsed)) : 0;
};

export function SmsSettingsSection() {
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();

  const [form, setForm] = useState({
    smsEnabled: true,
    smsSenderId: '',
    quietFrom: '21:00',
    quietTo: '08:00',
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      smsEnabled: org.smsEnabled,
      smsSenderId: org.smsSenderId ?? '',
      quietFrom: hourToTime(org.smsQuietFromHour),
      quietTo: hourToTime(org.smsQuietToHour),
    });
  }, [org]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>SMS</h2>
      <p className="sub">Text messages for reminders and departure changes.</p>

      {error && <div className="err">{error}</div>}

      <div className="rule-toggles">
        <Toggle
          on={form.smsEnabled}
          label="Send SMS messages"
          onChange={(v) => setForm({ ...form, smsEnabled: v })}
        />
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="smsProvider">Provider</label>
          {/* One option and not stored, same as the payment provider: Twilio
              is the only one wired, so a saved choice would be a preference
              nothing honours. */}
          <select id="smsProvider" value="twilio" disabled>
            <option value="twilio">Twilio</option>
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="smsSender">Sender ID</label>
          <input
            id="smsSender"
            maxLength={11}
            value={form.smsSenderId}
            placeholder="Up to 11 characters"
            onChange={(e) => setForm({ ...form, smsSenderId: e.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="smsFrom">Quiet hours from</label>
          <input
            id="smsFrom"
            type="time"
            step={3600}
            value={form.quietFrom}
            onChange={(e) => setForm({ ...form, quietFrom: e.target.value })}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="smsTo">Quiet hours to</label>
          <input
            id="smsTo"
            type="time"
            step={3600}
            value={form.quietTo}
            onChange={(e) => setForm({ ...form, quietTo: e.target.value })}
          />
        </div>
      </div>

      {/*
        The prototype's own wording, kept because it is accurate and it is the
        single most useful thing this screen can say: unregistered US traffic
        is filtered SILENTLY, so a studio that switches this on and sees no
        error will believe it is working.
      */}
      <div className="alert warn" role="note">
        In production, US SMS needs an approved A2P 10DLC campaign and explicit
        consent per recipient. Reminders respect quiet hours; booking
        confirmations do not.
      </div>

      {/* Said plainly, because a saved field that changes nothing is exactly
          what this screen must not have without admitting it. */}
      <p className="tiny muted">
        <b>Sender ID is recorded, not yet in use.</b> Texts go out from our
        number until an alphanumeric sender is registered for you — the same
        10DLC queue as above. Tell us what you want and we will register it.
      </p>

      <Footer
        busy={busy}
        saved={saved}
        onSave={() =>
          void save({
            smsEnabled: form.smsEnabled,
            smsSenderId: form.smsSenderId.trim() || null,
            smsQuietFromHour: timeToHour(form.quietFrom),
            smsQuietToHour: timeToHour(form.quietTo),
          })
        }
      />
    </section>
  );
}

// --- Payments ---------------------------------------------------------------

type Payments = {
  provider: string;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export function PaymentSettingsSection() {
  const base = useOrgBase();
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();
  const [stripe, setStripe] = useState<Payments | null>(null);

  const [form, setForm] = useState({
    defaultDepositPercent: '0',
    depositsEnabled: true,
    allowPayOnArrival: false,
    acceptCash: true,
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      defaultDepositPercent: String(org.defaultDepositPercent),
      depositsEnabled: org.depositsEnabled,
      allowPayOnArrival: org.allowPayOnArrival,
      acceptCash: org.acceptCash,
    });
  }, [org]);

  useEffect(() => {
    /* The connection itself is Integrations' to report and this reads the
       same endpoint, so the two screens cannot disagree about whether the
       studio can take money. */
    api
      .get<{ payments: Payments }>(`${base}/integrations`)
      .then((res) => setStripe(res.payments))
      .catch(() => setStripe(null));
  }, [base]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>Payments</h2>
      <p className="sub">What guests can pay with, and when.</p>

      {error && <div className="err">{error}</div>}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="paProvider">Payment provider</label>
          {/*
            One option, and not stored. Stripe is the only provider
            implemented, so a saved choice would be a preference the code
            cannot honour — an owner picking PayPal and wondering why nothing
            changed. The field is here because operators expect to see who
            takes their money.
          */}
          <select id="paProvider" value="stripe" disabled>
            <option value="stripe">Stripe</option>
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="paDeposit">Deposit percentage</label>
          <input
            id="paDeposit"
            type="number"
            min={0}
            max={99}
            value={form.defaultDepositPercent}
            onChange={(e) =>
              setForm({ ...form, defaultDepositPercent: e.target.value })
            }
          />
        </div>
      </div>

      <div className="rule-toggles">
        <Toggle
          on={form.depositsEnabled}
          label="Let guests pay a deposit instead of the full amount"
          onChange={(v) => setForm({ ...form, depositsEnabled: v })}
        />
        <Toggle
          on={form.allowPayOnArrival}
          label='Allow "pay on arrival" bookings'
          onChange={(v) => setForm({ ...form, allowPayOnArrival: v })}
        />
        <Toggle
          on={form.acceptCash}
          label="Accept cash at the meeting point"
          onChange={(v) => setForm({ ...form, acceptCash: v })}
        />
      </div>

      <dl className="pay-facts">
        <div>
          <dt>Connected account</dt>
          <dd>
            {stripe?.connected
              ? stripe.chargesEnabled
                ? 'Connected — taking payments'
                : 'Connected — not yet able to take payments'
              : 'Not connected'}
          </dd>
        </div>
        <div>
          <dt>Payouts</dt>
          <dd>
            {stripe?.payoutsEnabled ? 'Enabled' : 'Not enabled yet'}
          </dd>
        </div>
        <div>
          <dt>Processing fee</dt>
          {/*
            No number here on purpose. Stripe does not expose an account's
            negotiated rate through its API, so anything printed would be a
            guess sitting next to somebody's revenue — and a studio on a
            different country's pricing would be told the wrong figure with
            our name on it.
          */}
          <dd className="muted">Set by Stripe — see your Stripe dashboard</dd>
        </div>
      </dl>

      <div className="alert" role="note">
        Deposit terms are still set <b>per activity</b> — a six-week course and
        a two-hour taster rarely want the same one. The percentage above is
        what a <b>new</b> activity starts at; the switch turns deposits off
        everywhere, whatever an activity says.
      </div>

      <Footer
        busy={busy}
        saved={saved}
        onSave={() =>
          void save({
            defaultDepositPercent: Number(form.defaultDepositPercent) || 0,
            depositsEnabled: form.depositsEnabled,
            allowPayOnArrival: form.allowPayOnArrival,
            acceptCash: form.acceptCash,
          })
        }
      />
    </section>
  );
}

// --- Currency ---------------------------------------------------------------

const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD'];

export function CurrencySection() {
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    if (org) setCurrency(org.currency);
  }, [org]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>Currency</h2>
      <p className="sub">What your prices are in.</p>

      {error && <div className="err">{error}</div>}

      <div className="setting setting-stack">
        <label htmlFor="curSel">Currency</label>
        <select
          id="curSel"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="tiny muted">
          Used for every price, payment and report. Changing it does not
          convert existing prices — a £95 class becomes a $95 class.
        </p>
      </div>

      {/*
        The prototype's tax rate, tax label and service fee are not here, and
        saying so is better than a gap: an owner looking for tax needs to know
        it is absent rather than assume they have missed a screen.
      */}
      <div className="alert" role="note">
        <b>Tax is not calculated.</b> Nothing in Artweel adds tax to a price,
        shows it on a receipt or reports it, so there is no rate to set here.
        Prices are what your customer pays. If you need tax handled, tell us —
        it affects every price and refund, so it is not a field we can quietly
        add.
      </div>

      <Footer busy={busy} saved={saved} onSave={() => void save({ currency })} />
    </section>
  );
}

// --- Localisation -----------------------------------------------------------

/**
 * A shortlist, not the full IANA database.
 *
 * Moved here from the Studio section when timezone left it. A stored value
 * outside the list is still shown (see the select), so a studio set up by hand
 * or one that has moved is never silently reassigned to New York by opening
 * this page.
 */
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
];

const DATE_FORMATS = ['MMM D, YYYY', 'D MMM YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'];

export function LocalisationSection() {
  const { org } = useOrgSettings();
  const { save, busy, saved, error } = useOrgSave();
  const [timezone, setTimezone] = useState('');
  const [dateFormat, setDateFormat] = useState('MMM D, YYYY');
  const [timeFormat, setTimeFormat] = useState('12h');

  useEffect(() => {
    if (!org) return;
    setTimezone(org.timezone);
    setDateFormat(org.dateFormat);
    setTimeFormat(org.timeFormat);
  }, [org]);

  if (!org) return <div className="card">Loading…</div>;

  return (
    <section className="card">
      <h2>Localisation</h2>
      <p className="sub">Your studio's timezone, and how dates read to you.</p>

      {error && <div className="err">{error}</div>}

      <div className="setting setting-stack">
        <label htmlFor="locTz">Timezone</label>
        <select
          id="locTz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {timezone && !TIMEZONES.includes(timezone) && (
            <option value={timezone}>{timezone}</option>
          )}
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace('_', ' ')}
            </option>
          ))}
        </select>
        {/*
          The prototype calls timezone a display setting. It is not: every
          session, working-hours rule and availability window is resolved
          against it, so changing it moves when classes actually happen.
        */}
        <p className="tiny muted">
          This is <b>not</b> a display preference — class times, working hours
          and availability are all worked out from it.
        </p>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="locDate">Date format</label>
          <select
            id="locDate"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value)}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="locTime">Time format</label>
          <select
            id="locTime"
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value)}
          >
            <option value="12h">12-hour</option>
            <option value="24h">24-hour</option>
          </select>
        </div>
      </div>

      <p className="tiny muted">
        These two change what <b>you</b> see in the dashboard. Customers always
        get long, unambiguous dates on their confirmations.
      </p>

      <Footer
        busy={busy}
        saved={saved}
        onSave={() => void save({ timezone, dateFormat, timeFormat })}
      />
    </section>
  );
}

// --- What each role can do --------------------------------------------------

/**
 * The permissions table, READ ONLY.
 *
 * The prototype's is a grid of toggles with its own footnote admitting it is
 * "front-end simulation only". Artweel enforces four fixed roles in
 * middleware, so toggles here would change nothing — an owner unticking
 * "Cancel booking" for the front desk would believe they had removed it.
 *
 * This states what the middleware actually does. It is hand-maintained
 * against `requireAdmin` / `requireFrontDesk` / `requireMember`, which is the
 * honest weak point: if a guard changes and this does not, it goes stale. That
 * is a smaller risk than a control that lies, and the fix if it ever matters
 * is to generate it from the route table rather than to make it editable.
 */
type MatrixRow = {
  permission: string;
  label: string;
  roles: Record<string, boolean>;
};

type Matrix = {
  roles: { role: string; label: string }[];
  matrix: MatrixRow[];
};

/**
 * What each role may do, and the studio's ability to change it.
 *
 * These checkboxes are REAL. Unticking one writes an exception the server
 * reads on every guarded request — it is not, as the prototype's own footnote
 * admits of itself, a front-end simulation. The defaults reproduce the old
 * middleware exactly, so a studio that never opens this behaves as it always
 * did, and the table only ever holds deliberate exceptions.
 *
 * The Owner column is fixed and disabled. An owner can always do everything;
 * a studio able to untick one of their own permissions would be one support
 * ticket away from nobody being able to put it back.
 */
export function RolesTable() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const canEdit = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [data, setData] = useState<Matrix | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Matrix>(`${base}/permissions`)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load.'),
      );
  }, [base]);

  async function toggle(permission: string, role: string, next: boolean) {
    setBusy(`${role}:${permission}`);
    setError(null);
    try {
      /* The server answers with the whole matrix, so the screen repaints from
         what was actually stored rather than from what we hoped. */
      setData(
        await api.put<Matrix>(`${base}/permissions`, {
          role,
          permission,
          allowed: next,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <div className="card">{error ?? 'Loading…'}</div>;
  }

  return (
    <section className="card" style={{ padding: 0 }}>
      <header className="automations-head">
        <div>
          <h2>Roles &amp; permissions</h2>
          <span className="tiny muted">
            Toggle what each role can do. Owner is fixed.
          </span>
        </div>
      </header>

      {error && <div className="err">{error}</div>}

      <DataTable
        caption="What each role is allowed to do"
        head={
          <tr>
            <th>Permission</th>
            <th className="num">Owner</th>
            {data.roles.map((r) => (
              <th key={r.role} className="num">
                {r.label}
              </th>
            ))}
          </tr>
        }
      >
        {data.matrix.map((row) => (
          <tr key={row.permission}>
            <td>{row.label}</td>
            <td className="num">
              {/* Always on, never editable — see the note above. */}
              <input
                type="checkbox"
                checked
                disabled
                aria-label={`Owner: ${row.label} (always allowed)`}
              />
            </td>
            {data.roles.map((r) => (
              <td key={r.role} className="num">
                <input
                  type="checkbox"
                  checked={row.roles[r.role] ?? false}
                  disabled={!canEdit || busy === `${r.role}:${row.permission}`}
                  aria-label={`${r.label}: ${row.label}`}
                  onChange={(e) =>
                    void toggle(row.permission, r.role, e.target.checked)
                  }
                />
              </td>
            ))}
          </tr>
        ))}
      </DataTable>

      {/*
        The prototype's footnote says "front-end simulation only — a real
        product enforces these on the server". This one does, so it says so
        instead. Worth stating plainly: an operator has no way to tell by
        looking, and the whole value of the screen is that the answer is yes.
      */}
      <div className="table-foot">
        <span className="tiny muted">
          Enforced on the server for every request, not in your browser — so
          these limits hold even if somebody edits the page.
        </span>
      </div>
    </section>
  );
}

// --- Danger zone ------------------------------------------------------------

export function DangerZoneSection() {
  const org = useActiveOrg();
  const isOwner = org?.role === 'OWNER';

  return (
    <section className="card danger-zone">
      <h2 className="danger-title">Danger zone</h2>
      <p className="sub">Things that cannot be undone.</p>

      <div className="danger-row">
        <div>
          <b>Close this studio</b>
          <p className="tiny muted">
            Deletes your studio, its bookings, customers and payment history.
            {isOwner
              ? ' Only you can start this, and we will ask you to confirm by email.'
              : ' Only the owner can do this.'}
          </p>
        </div>
        {/*
          No button, and that is deliberate rather than unfinished.

          There is no endpoint behind this: deleting a studio means deleting
          bookings people have paid for and payment records a studio may be
          legally required to keep, so it needs a considered flow — a grace
          period, an export, and a decision about what Stripe keeps. A button
          that appears to do it and does not would be the worst version, and
          one that really did it without those questions answered would be
          worse still.
        */}
        <span className="tiny muted">
          Email support and we will take you through it.
        </span>
      </div>

      <div className="danger-row">
        <div>
          <b>Export your data</b>
          <p className="tiny muted">
            Customers and bookings download as CSV from their own screens —
            Customers → Export, and Bookings → Export CSV.
          </p>
        </div>
      </div>
    </section>
  );
}
