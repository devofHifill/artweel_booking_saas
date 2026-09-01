import { useEffect, useRef, useState } from 'react';

/**
 * Help, containing only things that are true.
 *
 * The prototype has a `?` in its bar and nothing behind it, which a demo can
 * afford. Shipping the same button with nothing behind it would be worse than
 * having no button: it advertises help that does not exist and sends somebody
 * looking for it.
 *
 * There is no documentation site, no support address and no help centre in
 * this product — checked, not assumed. What DOES exist is two real keyboard
 * shortcuts, and most people never discover either. So that is what this says.
 *
 * When there is somewhere to send people, it goes here and this comment goes
 * away.
 */

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '/', what: 'Jump to search, from anywhere' },
  { keys: 'Esc', what: 'Close this, or any other panel' },
];

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* A glyph rather than an icon: there is no question-mark in the set,
            and one character carries this perfectly well. */}
        <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 600 }}>
          ?
        </span>
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Keyboard shortcuts">
          <p className="tiny muted" style={{ margin: '2px 6px 8px' }}>
            Keyboard shortcuts
          </p>
          <ul className="mini-list">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="mini-row">
                <span className="mini-main">{s.what}</span>
                <kbd>{s.keys}</kbd>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
