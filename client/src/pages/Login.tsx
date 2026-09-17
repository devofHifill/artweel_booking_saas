import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { AuthField, AuthLayout } from '../components/AuthLayout';
import ForgotPassword from './ForgotPassword';

export default function Login({ onSwitch }: { onSwitch?: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The request screen lives here rather than as its own route: it is a detour
  // off sign-in, and returns to it, so a URL of its own would only be a page
  // to get stranded on. The reset page proper (/reset-password) does need a
  // URL — it is the far end of an emailed link.
  const [forgot, setForgot] = useState(false);

  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await signIn(email, password);
    } catch (err) {
      // The server deliberately returns one message for a wrong password and
      // an unknown address, so login cannot be used to discover who has an
      // account. Showing it verbatim keeps that property.
      setError(
        err instanceof ApiError ? err.message : 'Could not sign in.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      intro="Pick up where the studio left off."
      switchLabel="Start your studio"
      onSwitch={onSwitch}
    >
      <form className="auth-form" onSubmit={submit}>
        {/* Live, so the failure is announced rather than only drawn. */}
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

        <AuthField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />

        <button className="auth-submit" type="submit" disabled={busy}>
          <Icon name="signin" size={18} />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="auth-forgot">
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(null);
              setForgot(true);
            }}
          >
            Forgot your password?
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
