import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Add or edit a customer.
 *
 * Built because the Customers screen could show a customer and never make
 * one. The studio's only way to create a row was to take a booking for it —
 * so a walk-in who asked about classes and left could not be written down,
 * and a typo in an email address, the single field the whole notification
 * system depends on, was permanent.
 *
 * ---
 *
 * WHAT THIS FORM DOES NOT TOUCH, and must not be extended to:
 *
 * SMS consent and the opt-out. `smsConsentAt` and `smsOptedOutAt` are a TCPA
 * record of what the CUSTOMER did — a ticked box on a booking form, a texted
 * STOP. They are not studio preferences. A field here that could clear an
 * opt-out would let a studio resubscribe somebody who had explicitly left,
 * by editing their phone number. The server refuses them too; this comment is
 * so nobody adds the field and then goes looking for the missing endpoint.
 */

export type CustomerStatus = 'ACTIVE' | 'VIP' | 'BLOCKED';

export type EditableCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  status: CustomerStatus;
  notes: string | null;
};

const STATUSES: { value: CustomerStatus; label: string; hint: string }[] = [
  { value: 'ACTIVE', label: 'Active', hint: 'An ordinary customer.' },
  { value: 'VIP', label: 'VIP', hint: 'Worth a second glance at the desk.' },
  {
    value: 'BLOCKED',
    label: 'Blocked',
    hint: 'A note to your staff. It does NOT stop them booking.',
  },
];

export function CustomerForm({
  base,
  editing,
  onSaved,
  onCancel,
}: {
  base: string;
  /** Null when adding. */
  editing: EditableCustomer | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  /* The prototype defaults this and so do we — most studios serve one
     country, and a blank field somebody has to fill for every walk-in is a
     field they will stop filling. */
  const [country, setCountry] = useState(editing?.country ?? 'United States');
  const [status, setStatus] = useState<CustomerStatus>(
    editing?.status ?? 'ACTIVE',
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      country: country.trim() || null,
      status,
      notes: notes.trim() || null,
    };

    try {
      if (editing) await api.patch(`${base}/customers/${editing.id}`, body);
      else await api.post(`${base}/customers`, body);
      onSaved();
    } catch (err) {
      /* The server's message names the person already using a clashing email,
         which is the only thing that makes that error actionable. */
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const chosen = STATUSES.find((s) => s.value === status);

  return (
    <form onSubmit={submit}>
      {error && <div className="err">{error}</div>}

      <div className="setting setting-stack">
        <label htmlFor="cfName">Full name</label>
        <input
          id="cfName"
          required
          maxLength={120}
          value={name}
          placeholder="Jane Doe"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cfEmail">Email</label>
        <input
          id="cfEmail"
          type="email"
          required
          maxLength={200}
          value={email}
          placeholder="jane@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="tiny muted">
          Every confirmation and reminder goes here, and it has to be unique
          within your studio.
        </p>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cfPhone">Phone</label>
          <input
            id="cfPhone"
            maxLength={40}
            value={phone}
            placeholder="+1 555 000 0000"
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cfCountry">Country</label>
          <input
            id="cfCountry"
            maxLength={80}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </div>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cfStatus">Status</label>
        <select
          id="cfStatus"
          value={status}
          onChange={(e) => setStatus(e.target.value as CustomerStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {/* Said plainly on the screen, not just in the code. An operator who
            marks somebody Blocked and assumes it prevents a booking has been
            misled by the word, and would find out from the customer. */}
        <p className="tiny muted">{chosen?.hint}</p>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cfNotes">Notes</label>
        <textarea
          id="cfNotes"
          rows={3}
          maxLength={2000}
          value={notes}
          placeholder="Allergies, preferences, anything the desk should know"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="counter-foot">
        <span className="tiny muted">
          {editing ? 'Changes apply everywhere immediately.' : ''}
        </span>
        <div className="counter-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save customer'}
          </button>
        </div>
      </div>
    </form>
  );
}
