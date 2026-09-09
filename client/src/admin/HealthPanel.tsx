import { Link } from 'react-router-dom';
import type { Health, HealthComponent } from './types';

/**
 * Platform health, as a list of components with a real state each.
 *
 * NO UPTIME COLUMN. The reference design carried a "99.98%" against every row;
 * nothing in this system measures availability over time, so those figures
 * would be decoration on the one screen that exists to be believed when
 * something is broken.
 *
 * Latency is shown only where it was genuinely timed — the database round trip.
 * Stripe, Resend, Twilio and Google are reported as configured or not, which is
 * both cheap and the thing that has actually been wrong here: a staging box
 * with no Resend key sends nothing and looks entirely healthy otherwise.
 */

const STATUS_LABEL: Record<HealthComponent['status'], string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  'not-configured': 'Not configured',
};

export default function HealthPanel({ health }: { health: Health }) {
  const secondsAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(health.checkedAt).getTime()) / 1000),
  );

  return (
    <div className="card health-panel">
      <div className="health-head">
        <div>
          <h2>Platform Health</h2>
          <p className="sub">
            {health.degraded
              ? 'Something needs attention'
              : 'All systems operational'}
          </p>
        </div>

        <span className={`health-badge ${health.degraded ? 'bad' : 'good'}`}>
          <i />
          {health.degraded ? 'Degraded' : 'Operational'}
        </span>
      </div>

      <ul className="health-list">
        {health.components.map((c) => (
          <li key={c.key}>
            <span className={`health-dot ${c.status}`} aria-hidden />
            <span className="health-label">{c.label}</span>
            <span className="health-detail">
              {c.latencyMs !== null && (
                <strong className="health-latency">{c.latencyMs}ms</strong>
              )}
              <span title={STATUS_LABEL[c.status]}>{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="health-foot">
        <span className="sub">
          {secondsAgo < 60
            ? `Last checked ${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`
            : `Last checked ${Math.round(secondsAgo / 60)} min ago`}
        </span>
        <Link to="/admin/health">Details →</Link>
      </div>
    </div>
  );
}
