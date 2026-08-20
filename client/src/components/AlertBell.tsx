import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import type { ShellAlert } from '../lib/useShellSummary';

/**
 * Things that are wrong and that nobody would otherwise find out about.
 *
 * Not a notification feed, and deliberately not shaped like one. Every entry is
 * a live condition read from the database on each load — Stripe not connected,
 * notifications that failed to send, a calendar whose token expired — so there
 * is nothing to mark as read and no history to page through. When the underlying
 * problem is fixed, the entry disappears because the query stops returning it.
 *
 * A feed would need a read/unread flag per user, which is a real feature with
 * real storage behind it. This is the useful half of it, honestly scoped.
 */

/** Where each condition is actually fixed. */
const DESTINATION: Record<ShellAlert['id'], string> = {
  payments: '/billing',
  notifications: '/bookings',
  calendars: '/settings',
};

export function AlertBell({ alerts }: { alerts: ShellAlert[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = alerts.length;
  const worst = alerts.some((a) => a.level === 'danger') ? 'danger' : 'warn';

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label={
          count === 0
            ? 'Nothing needs attention'
            : `${count} ${count === 1 ? 'thing needs' : 'things need'} attention`
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {/*
          A dot rather than a number. There are at most three of these and the
          count is not the useful part — "something is wrong" is, and a numeral
          here reads as unread messages, which these are not.
        */}
        {count > 0 && <span className={`bell-dot ${worst}`} aria-hidden="true" />}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Needs attention">
          {count === 0 ? (
            <p className="bell-none">Nothing needs your attention.</p>
          ) : (
            alerts.map((alert) => (
              <button
                key={alert.id}
                type="button"
                className={`bell-item ${alert.level}`}
                onClick={() => {
                  setOpen(false);
                  navigate(DESTINATION[alert.id]);
                }}
              >
                <span className="bell-mark" aria-hidden="true" />
                <span>{alert.message}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
