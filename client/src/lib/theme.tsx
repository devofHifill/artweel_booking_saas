import { useSyncExternalStore } from 'react';

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

/**
 * One store, shared by every control.
 *
 * This was `useState` inside the hook, which was correct while exactly one
 * control existed. It stops being correct the moment there are two — the
 * sidebar toggle and the one in Settings → Appearance. Each hook instance would
 * hold its own copy: clicking either would update the DOM and localStorage for
 * real, while the other went on displaying the previous value until something
 * unrelated remounted it. The setting would look like it had failed to save.
 *
 * `useSyncExternalStore` is the sanctioned way to read from something outside
 * React, and it keeps the hook's existing shape, so nothing that calls it
 * changes.
 */
let current: Theme = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return current;
}

/** Applies, persists and broadcasts — in that order, so the paint is not queued. */
export function setTheme(next: Theme) {
  current = next;
  applyTheme(next);

  // 'system' removes the key rather than storing the word, matching applyTheme:
  // a stored "system" would match neither selector on the next load.
  if (next === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, next);

  for (const listener of listeners) listener();
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);

  /** light → dark → system → light. */
  const cycle = () =>
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');

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
