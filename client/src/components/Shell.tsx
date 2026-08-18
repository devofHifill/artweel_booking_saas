import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';

/**
 * The app shell: a sidebar that becomes an off-canvas drawer on small screens.
 *
 * Shared by the studio dashboard and /admin. They are deliberately separate
 * applications with separate navigation — but the shell *mechanics* are the
 * same, and duplicating a focus trap and a scroll lock in two places is how the
 * two quietly diverge.
 *
 * Below 900px the sidebar is fixed and translated off-canvas; the CSS owns the
 * animation, this component owns only the open/closed state and the behaviours
 * that state implies.
 */
export function Shell({
  brand,
  sidebar,
  children,
  className = '',
}: {
  /** Rendered in the sidebar and, on small screens, in the top bar. */
  brand: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  /**
   * Navigating closes the drawer.
   *
   * Without this, tapping a nav link changes the page behind a drawer that stays
   * open over it — the single most common bug in hand-rolled mobile navigation,
   * and it reads as the tap not having worked.
   */
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  /** Escape closes it, because a modal-ish overlay that traps you is worse than no overlay. */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKey);
    // The page behind must not scroll under the drawer.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className={`shell ${className}`.trim()}>
      {/*
        Skip link. Ten nav items sit before the page body, and without this a
        keyboard or screen-reader user walks through all of them on every single
        navigation. Invisible until focused.
      */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* Only rendered small — the CSS hides it above 900px. */}
      <div className="topbar">
        <button
          className="menu-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          <Icon name={open ? 'close' : 'menu'} size={20} />
        </button>
        <div className="brand">{brand}</div>
      </div>

      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}

      <aside className={`sidebar ${open ? 'open' : ''}`.trim()}>
        <div className="brand">{brand}</div>
        {sidebar}
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
