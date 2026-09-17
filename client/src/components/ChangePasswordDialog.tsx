import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal } from './layout';

/**
 * "Change password", for whoever is signed in.
 *
 * Shared by the studio account menu and the platform sidebar: a password
 * belongs to the person, not to a studio, and an operator with no studio has
 * one too.
 *
 * On success the server revokes EVERY refresh token, this browser's included —
 * changing a password is what you do when you think someone else has it. So
 * this ends by signing out rather than carrying on with an access token that
 * has a few minutes left and would then fail with no explanation. The dialog
 * says so before the button is pressed, not after.
 *
 * Portalled to <body>: it is opened from inside the topbar, and a fixed
 * backdrop inside a sticky, stacked header is clipped by it.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    if (next === current) {
      setError('The new password is the same as the current one.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not change the password.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Once changed there is no live session to return to, so every way out of
  // the dialog is the way to the sign-in screen.
  const close = done ? signOut : onClose;

  return createPortal(
    done ? (
      <Modal title="Password changed" onClose={close}>
        <p style={{ marginTop: 0 }}>
          Your new password is set, and you have been signed out on every
          device. Sign in again with the new password.
        </p>
        <div className="counter-foot">
          <span />
          <div className="counter-actions">
            <button type="button" className="primary" onClick={signOut}>
              Sign in again
            </button>
          </div>
        </div>
      </Modal>
    ) : (
      <Modal
        title="Change password"
        subtitle="You will be signed out everywhere, including here."
        onClose={close}
      >
        <form onSubmit={submit}>
          <div aria-live="polite">{error && <div className="err">{error}</div>}</div>

          <div className="setting setting-stack">
            <label htmlFor="cpCurrent">Current password</label>
            <input
              id="cpCurrent"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>

          <div className="setting setting-stack">
            <label htmlFor="cpNext">New password</label>
            <input
              id="cpNext"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="tiny muted">
              At least 12 characters, and not one you use anywhere else.
            </p>
          </div>

          <div className="setting setting-stack">
            <label htmlFor="cpConfirm">Confirm new password</label>
            <input
              id="cpConfirm"
              type="password"
              autoComplete="new-password"
              required
              maxLength={256}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <div className="counter-foot">
            <span />
            <div className="counter-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    ),
    document.body,
  );
}
