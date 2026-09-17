import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, tokens, type Membership } from './api';
import { clearBrand, loadBrand } from './brand';

/**
 * Session and studio context.
 *
 * The active organization lives here rather than in the token, matching the
 * server: identity is global, authority is per-studio, and a freelance
 * instructor working at three studios switches between them without logging
 * out.
 */

type User = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

type AuthState = {
  user: User | null;
  memberships: Membership[];
  activeOrgId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  setActiveOrg: (id: string) => void;
};

const AuthContext = createContext<AuthState | null>(null);

const ACTIVE_ORG_KEY = 'bsaas.activeOrg';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(
    localStorage.getItem(ACTIVE_ORG_KEY),
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tokens.access) {
      setLoading(false);
      return;
    }

    try {
      const me = await api.get<{ user: User; memberships: Membership[] }>(
        '/api/auth/me',
      );
      setUser(me.user);
      setMemberships(me.memberships);

      // A stored org the user no longer belongs to would 404 every request.
      setActiveOrgId((current) => {
        const stillValid = me.memberships.some(
          (m) => m.organizationId === current,
        );
        return stillValid ? current : (me.memberships[0]?.organizationId ?? null);
      });
    } catch {
      tokens.clear();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The api client raises this when a refresh fails for good.
  useEffect(() => {
    const onSignedOut = () => {
      setUser(null);
      setMemberships([]);
    };
    window.addEventListener('bsaas:signed-out', onSignedOut);
    return () => window.removeEventListener('bsaas:signed-out', onSignedOut);
  }, []);

  /**
   * The active studio, remembered — and its accent, fetched.
   *
   * The theme load lives here rather than in a page because it has to follow the
   * ACTIVE STUDIO, not the route. An instructor who works at two studios expects
   * the whole dashboard to change colour when they switch, not on their next
   * navigation; hanging it off a page would leave the previous studio's accent
   * painted until something happened to remount.
   */
  useEffect(() => {
    if (!activeOrgId) return;
    localStorage.setItem(ACTIVE_ORG_KEY, activeOrgId);
    void loadBrand(activeOrgId);
  }, [activeOrgId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<{
      user: User;
      memberships: Membership[];
      tokens: { accessToken: string; refreshToken: string };
    }>('/api/auth/login', { email, password });

    tokens.set(result.tokens.accessToken, result.tokens.refreshToken);
    setUser(result.user);
    setMemberships(result.memberships);
    setActiveOrgId(result.memberships[0]?.organizationId ?? null);
  }, []);

  const signOut = useCallback(() => {
    const refreshToken = tokens.refresh;
    // Revoke server-side too — clearing localStorage alone leaves a working
    // refresh token behind on a shared machine.
    if (refreshToken) {
      void api.post('/api/auth/logout', { refreshToken }).catch(() => {});
    }
    tokens.clear();
    localStorage.removeItem(ACTIVE_ORG_KEY);
    // The login screen is Artweel's, not the last studio's — and on a shared
    // machine the next person should not be shown the previous one's branding.
    clearBrand();
    setUser(null);
    setMemberships([]);
    setActiveOrgId(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      memberships,
      activeOrgId,
      loading,
      signIn,
      signOut,
      setActiveOrg: setActiveOrgId,
    }),
    [user, memberships, activeOrgId, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** The path prefix for everything the active studio owns. */
export function useOrgBase(): string {
  const { activeOrgId } = useAuth();
  return `/api/organizations/${activeOrgId}`;
}

export function useActiveOrg(): Membership | null {
  const { memberships, activeOrgId } = useAuth();
  return memberships.find((m) => m.organizationId === activeOrgId) ?? null;
}
