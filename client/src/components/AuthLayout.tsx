import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';

/**
 * The signed-out shell: brand panel on the left, form on the right.
 *
 * Sign in and sign up share it rather than each drawing their own page. They
 * are two states of one screen — people flip between them constantly, and when
 * the two are built separately the flip is a jarring relayout instead of a
 * swap of the middle column.
 *
 * The left panel is dark in BOTH themes on purpose. It is brand surface, not
 * document surface, so it uses fixed colours rather than the theme tokens;
 * everything on it is written against that dark ground.
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
        <p className="auth-kicker">
          Classes, bookings, kilns and packs — one studio calendar.
        </p>

        <div className="auth-brand-mid">
          <h2 className="auth-head">
            Mind the clay,
            <br />
            not the calendar.
          </h2>
          <StudioDayMock />
        </div>

        <p className="auth-brand-foot">Artweel · studio management</p>
      </section>

      <section className="auth-panel">
        <header className="auth-top">
          <span className="auth-mark">
            <Wordmark />
            Artweel
          </span>

          {onSwitch && (
            <button type="button" className="auth-switch" onClick={onSwitch}>
              <Icon name="customers" size={17} />
              {switchLabel}
            </button>
          )}
        </header>

        <div className="auth-body">
          <h1>{title}</h1>
          {intro && <p className="auth-intro">{intro}</p>}
          {children}
        </div>

        <footer className="auth-foot">
          <span>© {new Date().getFullYear()} Artweel</span>
          <ThemeToggle />
        </footer>
      </section>
    </div>
  );
}

/** Concentric rings — a pot seen from directly above the wheel. */
function Wordmark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <defs>
        <linearGradient id="artweel-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6e3418" />
          <stop offset="55%" stopColor="#c06a3c" />
          <stop offset="100%" stopColor="#e0a878" />
        </linearGradient>
      </defs>
      <circle cx="13" cy="13" r="11" fill="none" stroke="url(#artweel-mark)" strokeWidth="2.4" />
      <circle cx="13" cy="13" r="4.5" fill="none" stroke="url(#artweel-mark)" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A sample of the product, not a stock photo of hands on a wheel.
 *
 * Decorative: `aria-hidden`, because a screen reader reading out three
 * invented class times before reaching the password field is pure obstruction.
 */
function StudioDayMock() {
  const rows = [
    { name: 'Wheel throwing · Intro', time: '09:30', seats: '8/8' },
    { name: 'Open studio', time: '13:00', seats: '5/10' },
    { name: 'Glaze & load', time: '17:30', seats: '6/6' },
  ];

  return (
    <div className="auth-mock" aria-hidden="true">
      <div className="auth-mock-head">
        <span>Today</span>
        <span className="auth-mock-count">3 sessions</span>
      </div>

      <div className="auth-mock-rows">
        {rows.map((row) => (
          <div className="auth-mock-row" key={row.name}>
            <span className="auth-mock-time">{row.time}</span>
            <span className="auth-mock-name">{row.name}</span>
            <span className="auth-mock-seats">{row.seats}</span>
          </div>
        ))}
      </div>

      <div className="auth-mock-chip">Kiln 2 · bisque, cooling</div>
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
