import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { BrandMark, Wordmark } from './BrandMark';
import { marketingUrl } from '../lib/marketing';

/**
 * The signed-out shell: brand panel on the left, form on the right.
 *
 * Sign in and sign up share it rather than each drawing their own page. They
 * are two states of one screen — people flip between them constantly, and when
 * the two are built separately the flip is a jarring relayout instead of a
 * swap of the middle column. Forgot and reset password use it too.
 *
 * It is dressed as the marketing site (the 2026-11 "premium light" design),
 * not as the dashboard: somebody arrives here from "Start free" on
 * bookaihub.com, and the step across hosts should not look like a different
 * product. So `.auth` sets the marketing palette and fonts on itself, and the
 * screen is light whatever the dashboard theme is, as the marketing site is.
 * The brand panel is the landing page's dark closing panel.
 */
export function AuthLayout({
  title,
  intro,
  switchLabel,
  onSwitch,
  children,
}: {
  title: string;
  intro?: ReactNode;
  /** Label for the top-right link across to the other screen. */
  switchLabel: string;
  onSwitch?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <section className="auth-brand">
        <span className="auth-glow" aria-hidden="true" />
        <svg className="auth-rings" viewBox="0 0 800 800" aria-hidden="true">
          <circle cx="400" cy="400" r="180" />
          <circle cx="400" cy="400" r="270" />
          <circle cx="400" cy="400" r="360" />
        </svg>

        <a className="auth-logo on-dark" href={marketingUrl('/')}>
          <BrandMark size={34} />
          <Wordmark />
        </a>

        <div className="auth-brand-mid">
          <span className="auth-label">For studios, tours and workshops</span>
          <h2 className="auth-head">
            Mind the work, <br />
            not the <em>calendar.</em>
          </h2>
          <p className="auth-kicker">
            Classes, tours, private sessions and mobile work in one schedule,
            capped by the wheels, kayaks, benches or seats you really have.
            Customers pay straight into your Stripe, with no commission.
          </p>
          <StudioDayMock />
        </div>

        <ul className="auth-proof" aria-label="Works with">
          <li><span className="auth-dot v" aria-hidden="true" />Payouts to your Stripe</li>
          <li><span className="auth-dot b" aria-hidden="true" />Google Calendar sync</li>
          <li><span className="auth-dot g" aria-hidden="true" />Email and text reminders</li>
        </ul>
      </section>

      <section className="auth-panel">
        <header className="auth-top">
          <a className="auth-logo" href={marketingUrl('/')} aria-label="BookAIHub home">
            <BrandMark size={32} />
            <Wordmark />
          </a>

          {onSwitch && (
            <button type="button" className="auth-switch" onClick={onSwitch}>
              {switchLabel}
              <Icon name="chevron" size={15} />
            </button>
          )}
        </header>

        <div className="auth-body">
          <h1>{title}</h1>
          {intro && <p className="auth-intro">{intro}</p>}
          {children}
        </div>

        <footer className="auth-foot">
          <span>© {new Date().getFullYear()} BookAIHub Inc</span>
          <nav aria-label="Legal">
            <a href={marketingUrl('/terms')}>Terms</a>
            <a href={marketingUrl('/privacy')}>Privacy</a>
            <a href={marketingUrl('/')}>bookaihub.com</a>
          </nav>
        </footer>
      </section>
    </div>
  );
}

/**
 * The form's one primary button, as the marketing site draws its primary: an
 * orange pill with a sheen on hover and a white arrow disc whose arrow slides
 * out and is replaced.
 */
export function AuthSubmit({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  const arrow = (
    <svg viewBox="0 0 12 12">
      <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" />
    </svg>
  );

  return (
    <button className="auth-submit" type="submit" disabled={busy} aria-busy={busy}>
      <span className="lbl">{busy ? busyLabel : label}</span>
      <span className="arr" aria-hidden="true">
        {arrow}
        {arrow}
      </span>
    </button>
  );
}

/**
 * A sample of the product, not a stock photo: today's sessions with how full
 * each one is against the kit it runs on, and the two things that happen
 * without anybody doing anything (a booking lands, a deposit is paid).
 *
 * Three different trades on one day on purpose. The platform serves pottery,
 * tours, workshops and more (see the marketing site's trade pages), and the
 * screen every one of them signs in through should not speak only to one.
 *
 * Decorative: `aria-hidden`, because a screen reader reading out three
 * invented class times before reaching the password field is pure obstruction.
 */
function StudioDayMock() {
  const rows = [
    { name: 'Wheel throwing · Intro', time: '09:30', taken: 8, of: 8 },
    { name: 'Bench basics · Woodshop', time: '13:00', taken: 4, of: 6 },
    { name: 'Sunset kayak tour', time: '18:30', taken: 7, of: 12 },
  ];

  return (
    <div className="auth-stage" aria-hidden="true">
      <div className="auth-mock">
        <div className="auth-mock-head">
          <span>Today</span>
          <span className="auth-mock-count">3 sessions · 26 places</span>
        </div>

        <div className="auth-mock-rows">
          {rows.map((row) => (
            <div className="auth-mock-row" key={row.name}>
              <span className="auth-mock-time">{row.time}</span>
              <span className="auth-mock-name">{row.name}</span>
              <span className={`auth-mock-seats${row.taken === row.of ? ' full' : ''}`}>
                {row.taken === row.of ? 'Full' : `${row.taken}/${row.of}`}
              </span>
              <span className="auth-mock-bar">
                <i style={{ width: `${(row.taken / row.of) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>

        <div className="auth-mock-chip">Kayak 13 in for repair</div>
      </div>

      <div className="auth-float f1">
        <span className="auth-float-ic ok">✓</span>
        <div>
          <b>Booking confirmed</b>
          <span>Sunset kayak tour · Sat 18:30</span>
        </div>
      </div>
      <div className="auth-float f2">
        <span className="auth-float-ic pay">$</span>
        <div>
          <b>Paid to your Stripe</b>
          <span>Deposit · 0% commission</span>
        </div>
      </div>
    </div>
  );
}

/**
 * One field: pill input, label that rides up out of the way, optional reveal.
 *
 * The label floats rather than being replaced by a placeholder. A placeholder
 * that vanishes on the first keystroke means anyone who looks away mid-form
 * has to clear the box to find out what it wanted — and it is invisible to a
 * screen reader as a name, which is why it cannot be the label here.
 */
export function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required,
  error,
  hint,
}: {
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`auth-field${isPassword ? ' has-reveal' : ''}`}>
      <div className="auth-field-box">
        <input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          /* A single space keeps the box "filled" for CSS while showing
             nothing, so :placeholder-shown can drive the floating label.
             No field here takes a real placeholder: one would sit directly
             under the resting label and read as text already typed. */
          placeholder=" "
        />
        <label htmlFor={id}>{label}</label>

        {isPassword && (
          <button
            type="button"
            className="auth-reveal"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} size={18} />
          </button>
        )}
      </div>

      {hint && !error && (
        <p className="auth-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="auth-hint bad" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}
