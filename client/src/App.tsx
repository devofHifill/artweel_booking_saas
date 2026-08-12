import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { useAuth, useActiveOrg, useOrgBase } from './lib/auth';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Onboarding from './pages/Onboarding';
import Today from './pages/Today';
import Bookings from './pages/Bookings';
import CalendarPage from './pages/Calendar';
import Customers from './pages/Customers';
import Register from './pages/Register';
import Classes from './pages/Classes';
import CustomerDetail from './pages/CustomerDetail';
import Billing from './pages/Billing';

export default function App() {
  const { user, loading, signOut, memberships, activeOrgId, setActiveOrg } =
    useAuth();
  const org = useActiveOrg();
  const [showSignUp, setShowSignUp] = useState(false);

  if (loading) return <div className="empty">Loading…</div>;

  if (!user) {
    return (
      <>
        {showSignUp ? (
          <SignUp onSignedUp={() => window.location.reload()} />
        ) : (
          <Login />
        )}
        <div style={{ textAlign: 'center', marginTop: -20 }}>
          <button className="link" onClick={() => setShowSignUp((v) => !v)}>
            {showSignUp
              ? 'Already have an account? Sign in'
              : 'New here? Start your studio'}
          </button>
        </div>
      </>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="login">
        <div className="card">
          <h2>No studio yet</h2>
          <p className="sub">
            This account is not attached to a studio. Ask an owner to invite you.
          </p>
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {org?.organization.name ?? 'Studio'}
          <small>{org?.role.toLowerCase().replace('_', ' ')}</small>
        </div>

        <nav className="nav">
          <NavLink to="/" end>Today</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
          <NavLink to="/classes">Classes</NavLink>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/billing">Plan</NavLink>
        </nav>

        <div className="spacer" />

        {memberships.length > 1 && (
          <>
            <label htmlFor="org">Studio</label>
            <select
              id="org"
              value={activeOrgId ?? ''}
              onChange={(e) => setActiveOrg(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organization.name}
                </option>
              ))}
            </select>
          </>
        )}

        <button onClick={signOut} style={{ marginTop: 12 }}>
          Sign out
        </button>
      </aside>

      <main className="main">
        <BillingBanner />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/classes" element={<Classes />} />
          <Route path="/register" element={<Register />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:customerId" element={<CustomerDetail />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * A studio that has not published yet lands on the wizard instead of an empty
 * Today view. Showing "nothing booked today" to somebody who has not set
 * anything up tells them nothing about what to do next.
 */
function Home() {
  const base = useOrgBase();
  const [complete, setComplete] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ complete: boolean }>(`${base}/onboarding`)
      .then((res) => !cancelled && setComplete(res.complete))
      .catch(() => !cancelled && setComplete(true));
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (complete === null) return <div className="empty">Loading…</div>;
  if (!complete) return <Navigate to="/setup" replace />;
  return <Today />;
}

function SetupRoute() {
  const navigate = useNavigate();
  return <Onboarding onDone={() => navigate('/')} />;
}

/** Trial and payment warnings, on every page rather than only on billing. */
function BillingBanner() {
  const base = useOrgBase();
  const [notice, setNotice] = useState<{
    level: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ billing: { notice: { level: string; message: string } | null } }>(
        `${base}/billing`,
      )
      .then((res) => !cancelled && setNotice(res.billing.notice))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!notice) return null;

  return (
    <div className={`alert ${notice.level === 'danger' ? 'danger' : 'warn'}`}>
      {notice.message}{' '}
      <NavLink to="/billing">See plans</NavLink>
    </div>
  );
}
