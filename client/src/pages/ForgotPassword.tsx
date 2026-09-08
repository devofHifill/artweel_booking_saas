import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { AuthField, AuthLayout } from '../components/AuthLayout';

/**
 * "Send me a reset link."
 *
 * Reached from the sign-in screen, and it deliberately says the same thing
 * whether or not the address has an account — the server answers 202 either
 * way for the same reason, so telling the visitor "no such account" here would
 * hand back the membership oracle the API refuses to be. The confirmation is
 * therefore shown on success regardless of what the response contained.
 */
export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      /*
        The only errors that reach here are rate limiting and the network —
        an unknown address still returns 202. Surfacing those is fine; they
        say nothing about whether the account exists.
      */
      setError(
        err instanceof ApiError ? err.message : 'Could not send the link.',
      );
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        intro="If that address has an account, a reset link is on its way. It works once and expires within the hour."
        switchLabel="Back to sign in"
        onSwitch={onBack}
      >
        <p className="sub">
          No email after a few minutes? Check spam, or make sure you typed the
          address you signed up with — then try again.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter your email and we'll send you a link to set a new one."
      switchLabel="Back to sign in"
      onSwitch={onBack}
    >
      <form className="auth-form" onSubmit={submit}>
        <div aria-live="polite">
          {error && <div className="err auth-err">{error}</div>}
        </div>

        <AuthField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />

        <button className="auth-submit" type="submit" disabled={busy}>
          <Icon name="send" size={18} />
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
