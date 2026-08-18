import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import Overview from './Overview';
import Studios from './Studios';
import StudioDetail from './StudioDetail';
import Health from './Health';
import Audit from './Audit';
import { Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { LoadingRegion, SkeletonList } from '../components/states';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Artweel's own operator surface.
 *
 * Rendered as a SEPARATE SHELL, not as extra links in the studio sidebar. Same
 * Vite bundle — a second build pipeline is not worth it for one operator — but no
 * conditional anywhere inside the studio shell that could leak platform UI to a
 * customer. `App.tsx` branches to this above everything studio-related, which is
 * also what makes it reachable for an operator who belongs to no studio at all.
 *
 * Discovery is `GET /api/platform/me`, which 404s for everyone without a live
 * grant. The client deliberately learns nothing more than that: no flag on
 * `/api/auth/me`, so a studio owner's browser never receives the fact that this
 * surface exists.
 */

type Grant = {
  userId: string;
  grantedAt: string | null;
  note: string | null;
};

export default function AdminApp() {
  const { user, signOut } = useAuth();
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>(
    'checking',
  );
  const [grant, setGrant] = useState<Grant | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ platformAdmin: Grant }>('/api/platform/me')
      .then((res) => {
        if (cancelled) return;
        setGrant(res.platformAdmin);
        setState('allowed');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A 404 is the expected answer for everyone who is not an admin. Any
        // other failure is also not an invitation to render the surface.
        setState(err instanceof ApiError ? 'denied' : 'denied');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') return (
      <LoadingRegion label="Loading">
        <SkeletonList count={2} lines={3} />
      </LoadingRegion>
    );

  /**
   * Says only what a wrong URL would say. The server already answers 404 here;
   * a client-side "you are not a platform admin" would hand back exactly the
   * fact the 404 withholds.
   */
  if (state === 'denied') {
    return (
      <div className="login">
        <div className="card">
          <h2>Not found</h2>
          <p className="sub">There is nothing at this address.</p>
          <a href="/">Back to your studio</a>
        </div>
      </div>
    );
  }

  return (
    <Shell
      className="admin"
      brand={
        <>
          Artweel
          <small>platform</small>
        </>
      }
      sidebar={
        <>
          <nav className="nav">
            <NavLink to="/admin" end>
              <Icon name="overview" />
              Overview
            </NavLink>
            <NavLink to="/admin/studios">
              <Icon name="studios" />
              Studios
            </NavLink>
            <NavLink to="/admin/health">
              <Icon name="health" />
              Health
            </NavLink>
            <NavLink to="/admin/audit">
              <Icon name="audit" />
              Audit
            </NavLink>
          </nav>

          <div className="spacer" />

          <div className="admin-who">
            <strong>{user?.email}</strong>
            {grant?.note && <span className="sub">{grant.note}</span>}
          </div>

          {/*
            A link rather than a nav item: the studio dashboard is a different
            application that happens to share a bundle.
          */}
          <a href="/" className="sub">
            Studio dashboard
          </a>

          <ThemeToggle />

          <button onClick={signOut} style={{ marginTop: 12 }}>
            Sign out
          </button>
        </>
      }
    >
      {/*
        ABSOLUTE paths, not relative ones.

        `App.tsx` renders this component directly rather than through a
        `<Route path="/admin/*">`, so there is no parent route to establish a
        base and these patterns are matched against the whole pathname. With
        `path="/"` here, nothing matched at `/admin`: the shell rendered, the
        gate returned 200, and the main panel was simply blank — a failure with
        no error anywhere to point at it.
      */}
      <Routes>
        <Route path="/admin" element={<Overview />} />
        <Route path="/admin/studios" element={<Studios />} />
        <Route
          path="/admin/studios/:organizationId"
          element={<StudioDetail />}
        />
        <Route path="/admin/health" element={<Health />} />
        <Route path="/admin/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}
