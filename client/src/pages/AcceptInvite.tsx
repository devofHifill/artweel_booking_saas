import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, tokens } from '../lib/api';
import { LoadingRegion, SkeletonCard } from '../components/states';

/**
 * "You have been invited to join a studio."
 *
 * Rendered OUTSIDE the signed-in shell, because the person reading it usually
 * has no account — which is the entire point of an invitation. It is one of
 * only two screens in the dashboard bundle that an unauthenticated visitor can
 * reach, the other being login.
 *
 * The page says what is on offer before it asks for anything: which studio,
 * from whom, and as what. An invitation link that opens straight onto a
 * password field is indistinguishable from a phishing page, and the people
 * receiving these are being asked to create a credential.
 */

type InvitePreview = {
  studio: string;
  role: string;
  email: string;
  name: string;
  invitedBy: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  needsPassword: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'an admin',
  INSTRUCTOR: 'an instructor',
  FRONT_DESK: 'front desk',
};

/** What to say for each way an invitation can be no good. */
const DEAD: Record<string, string> = {
  ACCEPTED:
    'This invitation has already been used. If that was you, sign in instead.',
  REVOKED:
    'This invitation was withdrawn. Ask the studio to send you a new one.',
  EXPIRED: 'This invitation has expired. Ask the studio to send you a new one.',
};

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvite(
        await api.get<InvitePreview>(
          `/api/auth/invitations/${encodeURIComponent(token ?? '')}`,
        ),
      );
    } catch {
      // A bad token and a token that never existed are the same thing to the
      // person holding it, and saying which would help somebody grinding them.
      setNotFound(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await api.post<{
        tokens: { accessToken: string; refreshToken: string };
      }>(`/api/auth/invitations/${encodeURIComponent(token ?? '')}/accept`, {
        password: invite?.needsPassword ? password : undefined,
      });

      /*
        Signed straight in. They have just proved who they are twice over —
        by receiving the link and by choosing a password — and bouncing them
        to a login screen reads as the product having lost track of them.
      */
      tokens.set(res.tokens.accessToken, res.tokens.refreshToken);
      // A hard navigation, not a router push: AuthProvider reads the token
      // once on mount, so a client-side route change would land on the
      // dashboard still believing nobody is signed in.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept.');
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Frame>
        <h2>That link is not valid</h2>
        <p className="sub">
          It may have been mistyped, or the invitation may have been withdrawn.
          Ask the studio to send you a new one.
        </p>
        <button type="button" onClick={() => navigate('/')}>
          Go to sign in
        </button>
      </Frame>
    );
  }

  if (!invite) {
    return (
      <Frame>
        <LoadingRegion label="Loading your invitation">
          <SkeletonCard lines={3} />
        </LoadingRegion>
      </Frame>
    );
  }

  if (invite.status !== 'PENDING') {
    return (
      <Frame>
        <h2>{invite.studio}</h2>
        <p className="sub">{DEAD[invite.status]}</p>
        <button type="button" onClick={() => navigate('/')}>
          Go to sign in
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
      <h2>Join {invite.studio}</h2>
      <p className="sub">
        {invite.invitedBy} invited you to {invite.studio} as{' '}
        {ROLE_LABELS[invite.role] ?? invite.role.toLowerCase()}. You will sign in
        as <strong>{invite.email}</strong>.
      </p>

      <form onSubmit={accept}>
        {invite.needsPassword ? (
          <>
            <label htmlFor="password">Choose a password</label>
            <input
              id="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="tiny muted">At least 12 characters.</p>
          </>
        ) : (
          /*
            They already have an account — a freelance instructor teaching at
            three studios is the ordinary case, not the exception. Asking for a
            password here would be asking them to change one.
          */
          <p className="sub">
            You already have an Artweel account for this address. Accepting adds{' '}
            {invite.studio} to it — your password does not change.
          </p>
        )}

        {error && (
          <div className="alert danger" role="alert">
            {error}
          </div>
        )}

        <div className="page-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Joining…' : `Join ${invite.studio}`}
          </button>
        </div>
      </form>
    </Frame>
  );
}

/** The signed-out frame, matching the login screen. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="card">{children}</div>
    </div>
  );
}
