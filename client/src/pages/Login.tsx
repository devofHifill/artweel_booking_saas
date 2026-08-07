import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="login">
      <h1>Studio dashboard</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        Sign in to manage your bookings.
      </p>

      <form className="card" onSubmit={submit}>
        {error && <div className="err">{error}</div>}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
