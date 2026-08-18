import { useEffect, useState } from 'react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
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
import Courses from './pages/Courses';
import CourseDetail from './pages/CourseDetail';
import Pieces from './pages/Pieces';
import Firings from './pages/Firings';
import Packs from './pages/Packs';
import CustomerDetail from './pages/CustomerDetail';
import Billing from './pages/Billing';
import AdminApp from './admin/AdminApp';
import { Shell } from './components/Shell';
import { Icon } from './components/Icon';
import { ThemeToggle } from './components/ThemeToggle';

export default function App() {
  const { user, loading, signOut, memberships, activeOrgId, setActiveOrg } =
    useAuth();
  const org = useActiveOrg();
  const location = useLocation();
  const [showSignUp, setShowSignUp] = useState(false);

  if (loading) return <div className="empty">Loading…</div>;

  if (!user) {
    // The flip between the two screens lives INSIDE the auth layout now, so it
    // sits in the panel's header rather than floating under a full-height
    // split screen with nothing around it.
    const flip = () => setShowSignUp((v) => !v);

    return showSignUp ? (
      <SignUp onSignedUp={() => window.location.reload()} onSwitch={flip} />
    ) : (
      <Login onSwitch={flip} />
    );
  }

  /**
   * The platform surface, branched ABOVE everything studio-related.
   *
   * Two reasons it sits here rather than inside the shell below:
   *
   * 1. Nothing in the studio sidebar is conditional on being an operator, so no
   *    conditional can ever leak platform UI to a customer. The admin tree has
   *    its own shell entirely.
   *
   * 2. An Artweel operator may belong to NO studio, which is the normal case for
   *    a staff account. Below this line, zero memberships means the "No studio
   *    yet" dead end — so branching after it would have made /admin unreachable
   *    for exactly the accounts that need it.
   *
   * Whether the caller is actually an admin is not decided here. AdminApp asks
   * the server, which 404s for everyone without a live grant.
   */
  if (location.pathname.startsWith('/admin')) {
    return <AdminApp />;
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
    <Shell
      brand={
        <>
          {org?.organization.name ?? 'Studio'}
          <small>{org?.role.toLowerCase().replace('_', ' ')}</small>
        </>
      }
      sidebar={
        <>
          <nav className="nav">
            <NavLink to="/" end>
              <Icon name="today" />
              Today
            </NavLink>
            <NavLink to="/calendar">
              <Icon name="calendar" />
              Calendar
            </NavLink>
            <NavLink to="/bookings">
              <Icon name="bookings" />
              Bookings
            </NavLink>
            <NavLink to="/classes">
              <Icon name="classes" />
              Classes
            </NavLink>
            <NavLink to="/courses">
              <Icon name="courses" />
              Courses
            </NavLink>
            <NavLink to="/register">
              <Icon name="register" />
              Register
            </NavLink>
            <NavLink to="/studio">
              <Icon name="studio" />
              Studio floor
            </NavLink>
            <NavLink to="/customers">
              <Icon name="customers" />
              Customers
            </NavLink>
            <NavLink to="/packs">
              <Icon name="packs" />
              Packs
            </NavLink>
            <NavLink to="/billing">
              <Icon name="plan" />
              Plan
            </NavLink>
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

          <ThemeToggle />

          <button onClick={signOut} style={{ marginTop: 12 }}>
            Sign out
          </button>
        </>
      }
    >
      <BillingBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/courses/:seriesId" element={<CourseDetail />} />
        <Route path="/register" element={<Register />} />
        <Route path="/studio" element={<Navigate to="/studio/pieces" replace />} />
        <Route path="/studio/pieces" element={<Pieces />} />
        <Route path="/studio/firings" element={<Firings />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:customerId" element={<CustomerDetail />} />
        <Route path="/packs" element={<Packs />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
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
