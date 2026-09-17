import { Icon } from './Icon';
import { useTheme } from '../lib/theme';

/**
 * Cycles light → dark → system.
 *
 * The label states the CURRENT setting rather than the action, because with
 * three states "switch to dark" is ambiguous about where you are — and the
 * setting is the thing a user is trying to confirm when they look.
 */
export function ThemeToggle() {
  const { theme, cycle } = useTheme();

  const label = theme === 'system' ? 'System theme' : theme === 'dark' ? 'Dark' : 'Light';

  return (
    <button
      className="theme-toggle"
      onClick={cycle}
      title="Change theme"
      aria-label={`Theme: ${label}. Click to change.`}
    >
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />
      {label}
    </button>
  );
}
