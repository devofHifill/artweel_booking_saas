import { useState, type FormEvent } from 'react';
import { api, tokens, ApiError } from '../lib/api';
import { clearAttribution, readAttribution } from '../lib/attribution';
import { AuthField, AuthLayout, AuthSubmit } from '../components/AuthLayout';
import { marketingUrl } from '../lib/marketing';

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
export default function SignUp({
  onSignedUp,
  onSwitch,
}: {
  onSignedUp: () => void;
  onSwitch?: () => void;
}) {
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permitted, setPermitted] = useState(false);
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
    <AuthLayout
      title="Start your studio"
      intro="14 days free. No card needed."
      switchLabel="I already have an account"
      onSwitch={onSwitch}
    >
      <form className="auth-form" onSubmit={submit}>
        <div aria-live="polite">
          {error && <div className="err auth-err">{error}</div>}
        </div>

        <AuthField
          label="Studio name"
          value={organizationName}
          onChange={setOrganizationName}
          required
        />

        <AuthField
          label="Your name"
          autoComplete="name"
          value={name}
          onChange={setName}
          required
        />

        <AuthField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          required
        />

        <AuthField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          hint="At least 12 characters. Length beats symbols."
          required
        />

        {/* Stripe holds the platform answerable for what its studios sell, so
            a studio confirms up front that it is not a restricted business.
            Required by the browser only: it is not recorded on the server. */}
        <label className="auth-check">
          <input
            type="checkbox"
            checked={permitted}
            onChange={(e) => setPermitted(e.target.checked)}
            required
          />
          <span>
            My studio does not sell prescription or medical treatments, CBD or
            kava, adult services, or anything else on the{' '}
            <a href={marketingUrl('/terms')} target="_blank" rel="noopener">
              restricted list in our Terms
            </a>
            .
          </span>
        </label>

        <AuthSubmit busy={busy} label="Create my studio" busyLabel="Creating…" />

        {/* Stripe expects the policies to be reachable from signup. They open
            in a new tab so a half-filled form is not lost. */}
        <p className="auth-legal">
          By creating a studio you agree to the{' '}
          <a href={marketingUrl('/terms')} target="_blank" rel="noopener">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href={marketingUrl('/privacy')} target="_blank" rel="noopener">
            Privacy Policy
          </a>
          . See also our{' '}
          <a href={marketingUrl('/refund-policy')} target="_blank" rel="noopener">
            Refund &amp; Cancellation Policy
          </a>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
