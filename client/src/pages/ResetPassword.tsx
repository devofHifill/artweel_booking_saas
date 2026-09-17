import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { AuthField, AuthLayout } from '../components/AuthLayout';

/**
 * "Choose a new password." — the far end of the emailed link.
 *
 * Rendered OUTSIDE the signed-in shell (see App), because the person following
 * the link is usually locked out, which is the whole reason they are here. The
 * token lives in the query string of the link, never typed.
 *
 * On success the server has revoked every existing session — resetting is what
 * you do when you think someone else has the password, so leaving old sessions
 * alive would defeat it. That is why this ends at the sign-in screen rather
 * than dropping them straight into the dashboard: there is deliberately no live
 * session to drop them into.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reset the password.',
      );
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="That link is not valid"
        intro="It may have been mistyped, or the link may be incomplete. Ask for a fresh reset link and open it straight from your email."
        switchLabel="Back to sign in"
        onSwitch={() => window.location.assign('/')}
      >
        <span />
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password changed"
        intro="Your new password is set, and every other session has been signed out. Sign in with it now."
        switchLabel="Go to sign in"
        onSwitch={() => window.location.assign('/')}
      >
        <span />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      intro="Pick something you don't use anywhere else."
      switchLabel="Back to sign in"
      onSwitch={() => window.location.assign('/')}
    >
      <form className="auth-form" onSubmit={submit}>
        <div aria-live="polite">
          {error && <div className="err auth-err">{error}</div>}
        </div>

        <AuthField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint="At least 12 characters."
          required
        />

        <AuthField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          required
        />

        <button className="auth-submit" type="submit" disabled={busy}>
          <Icon name="signin" size={18} />
          {busy ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </AuthLayout>
  );
}
