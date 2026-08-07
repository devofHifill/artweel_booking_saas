import { useState, type FormEvent } from 'react';
import { api, tokens, ApiError } from '../lib/api';
import { clearAttribution, readAttribution } from '../lib/attribution';

/**
 * Self-serve signup.
 *
 * One screen, four fields, no card. A card wall here is where most people
 * leave, and a pottery studio evaluating software on a Sunday evening will
 * simply close the tab.
 *
 * The timezone is guessed from the browser rather than asked for. It is
 * almost always right, and every question removed is a person who finishes.
 */
export default function SignUp({ onSignedUp }: { onSignedUp: () => void }) {
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      const result = await api.post<{
        tokens: { accessToken: string; refreshToken: string };
      }>('/api/auth/register', {
        name,
        organizationName,
        email,
        password,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Which page introduced them. Sent once, then discarded.
        ...readAttribution(),
      });

      tokens.set(result.tokens.accessToken, result.tokens.refreshToken);
      clearAttribution();
      onSignedUp();
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        // Per-field messages so the form can point at the problem rather than
        // showing one generic banner.
        setFieldErrors(
          Object.fromEntries(err.details.map((d) => [d.field, d.message])),
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not sign up.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>Start your studio</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        14 days free. No card needed.
      </p>

      <form className="card" onSubmit={submit}>
        {error && <div className="err">{error}</div>}

        <label htmlFor="studio">Studio name</label>
        <input
          id="studio"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Clay & Co"
          required
        />

        <label htmlFor="name">Your name</label>
        <input
          id="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {fieldErrors.email && (
          <div className="sub" style={{ color: 'var(--danger)' }}>
            {fieldErrors.email}
          </div>
        )}

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {fieldErrors.password && (
          <div className="sub" style={{ color: 'var(--danger)' }}>
            {fieldErrors.password}
          </div>
        )}
        <div className="sub" style={{ fontSize: '.8rem', marginTop: 4 }}>
          At least 12 characters. Length beats symbols.
        </div>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create my studio'}
        </button>
      </form>
    </div>
  );
}
