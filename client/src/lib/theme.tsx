import { useEffect, useState } from 'react';

/**
 * Light / dark / follow-the-system.
 *
 * The product supported dark mode only through `prefers-color-scheme`, so a
 * user could not choose. Plenty of people run a dark OS and want a light app —
 * or work in a bright studio and want the opposite — and had no way to say so.
 *
 * Three states rather than two, because "follow my system" is a real preference
 * and not the same as "light". A two-way toggle silently converts a user who
 * has never touched it into someone pinned to whatever the OS said the first
 * time they loaded the page.
 */

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'bsaas.theme';

function read(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Applies the choice to the document root.
 *
 * `system` REMOVES the attribute rather than writing a value, which hands
 * control back to the `prefers-color-scheme` media query in the stylesheet.
 * Writing `data-theme="system"` would match neither selector and strand the
 * user in permanent light mode.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  }, [theme]);

  /** light → dark → system → light. */
  const cycle = () =>
    setTheme((t) => (t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light'));

  return { theme, setTheme, cycle };
}

/**
 * Runs before React mounts, from main.tsx.
 *
 * Without this the page paints with the system theme and then corrects itself
 * once React hydrates — a white flash for anyone who chose dark, on every
 * single page load.
 */
export function applyStoredThemeEarly() {
  applyTheme(read());
}
