import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { tokens } from '../lib/api';
import { useActiveOrg, useAuth } from '../lib/auth';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { Icon } from './Icon';
import { initials } from './layout';

/**
 * Who you are signed in as, which studio, and the way out.
 *
 * The prototype's avatar is decoration — it has no accounts and nothing behind
 * the chip. Ours has three real things to put there, and they were all in the
 * sidebar: the signed-in identity, the studio switcher a freelance instructor
 * teaching at three studios actually needs, and Sign out.
 *
 * They MOVED rather than being copied. Two sign-out buttons and two studio
 * switchers would be the same mistake this phase keeps declining — one
 * question, two answers, free to drift. The topbar is where people look for an
 * account, so that is where the account now lives.
 *
 * The theme control stays in the sidebar: it is a device preference, not an
 * account, and it belongs next to nothing in particular.
 *
 * Plan & billing is here too, for owners and admins. It is the one entry point:
 * the sidebar's Plan item stays hidden, and the trial/payment banner and the
 * bell link to the same page. Billing belongs to a STUDIO, not to the person,
 * so the link names the active studio — the switcher right above it can change
 * which one that is.
 *
 * Change password is for everyone, whatever their role — except inside a
 * support session, where the server's actor is the OPERATOR, so the form would
 * change their password from a studio's tab.
 */
export function AccountMenu() {
  const { user, memberships, activeOrgId, setActiveOrg, signOut } = useAuth();
  const org = useActiveOrg();
  // Mirrors the guard on the /billing route; the server enforces it.
  const canBill = org?.role === 'OWNER' || org?.role === 'ADMIN';
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
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

  if (!user) return null;

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="avatar avatar-btn"
        aria-label={`Signed in as ${user.name || user.email}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(user.name || user.email)}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Your account">
          <div style={{ padding: '4px 6px 10px' }}>
            <b>{user.name || 'Signed in'}</b>
            <div className="tiny muted">{user.email}</div>
          </div>

          {/* Only when there is a choice to make. One studio needs no picker. */}
          {memberships.length > 1 && (
            <div style={{ padding: '0 6px 10px' }}>
              <label htmlFor="acct-org" className="tiny muted">
                Studio
              </label>
              <select
                id="acct-org"
                value={activeOrgId ?? ''}
                onChange={(e) => setActiveOrg(e.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(canBill || !tokens.support) && (
            <div className="menu-sep">
              {canBill && org && (
                <NavLink
                  to="/billing"
                  className="bell-item"
                  onClick={() => setOpen(false)}
                >
                  <Icon name="plan" size={16} />
                  <span className="mini-main">
                    Plan &amp; billing
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {org.organization.name}
                    </span>
                  </span>
                </NavLink>
              )}
              {!tokens.support && (
                <button
                  type="button"
                  className="bell-item"
                  onClick={() => {
                    setOpen(false);
                    setChangingPassword(true);
                  }}
                >
                  <Icon name="settings" size={16} />
                  <span className="mini-main">Change password</span>
                </button>
              )}
            </div>
          )}

          <div className="menu-sep">
            <button type="button" onClick={signOut} style={{ width: '100%' }}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {changingPassword && (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      )}
    </div>
  );
}
