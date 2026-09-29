import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { LoadingRegion, SkeletonList } from '../components/states';

/**
 * The setup wizard.
 *
 * The Phase 1 exit gate is a stranger going from signup to a live booking page
 * in under ten minutes, unaided. That rules out asking them to invent
 * anything, so the primary action is a single button that fills the studio in
 * with real ceramics defaults — the job becomes editing, not creating.
 *
 * Progress is read from the server, which derives it from the data rather than
 * from a flag. Someone who added a class through the normal screens has done
 * that step and is never asked again.
 */

type Step = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  optional: boolean;
};

/**
 * Where each step is done.
 *
 * The steps were labels: "Add a class" said what to do and not where, so a new
 * operator had to go and find Activities themselves, and the only thing on the
 * page you could press was the ceramics quick start. Each now goes to the
 * screen that completes it.
 */
const STEP_LINKS: Record<string, { to: string; todo: string; done: string }[]> = {
  studio: [
    { to: '/settings?section=studio', todo: 'Business information', done: 'Edit business information' },
  ],
  location: [
    { to: '/settings?section=locations', todo: 'Add a location', done: 'Manage locations' },
  ],
  service: [{ to: '/classes', todo: 'Go to Activities', done: 'Manage activities' }],
  hours: [{ to: '/staff', todo: 'Set hours on Staff & Guides', done: 'Manage hours' }],
  payments: [{ to: '/integrations', todo: 'Connect Stripe', done: 'Stripe settings' }],
};

type Problem = 'NO_DATES' | 'NO_INSTRUCTOR' | 'NO_HOURS' | 'NO_LOCATION';

/** The same wording as the activity cards, so the two screens agree. */
const PROBLEM_TEXT: Record<Problem, string> = {
  NO_DATES: 'no upcoming dates',
  NO_INSTRUCTOR: 'nobody teaches it',
  NO_HOURS: 'its instructors have no working hours',
  NO_LOCATION: 'its instructors do not work where it runs',
};

/** Activities customers cannot book yet, each with why and where to fix it. */
function StuckList({ stuck }: { stuck: { id: string; name: string; problem: Problem }[] }) {
  if (stuck.length === 0) {
    return (
      <p className="tiny">
        <Link to="/classes">Add an activity on Activities →</Link>
      </p>
    );
  }
  return (
    <ul className="tiny" style={{ margin: '4px 0 12px', paddingLeft: 18 }}>
      {stuck.map((s) => (
        <li key={s.id}>
          <strong>{s.name}</strong>: {PROBLEM_TEXT[s.problem]}.{' '}
          <Link to={s.problem === 'NO_HOURS' || s.problem === 'NO_LOCATION' ? '/staff' : '/classes'}>
            Fix it →
          </Link>
        </li>
      ))}
    </ul>
  );
}

type State = {
  steps: Step[];
  /** How many live activities customers can book, and what stops the rest. */
  bookable: { count: number; stuck: { id: string; name: string; problem: Problem }[] };
  readyToPublish: boolean;
  complete: boolean;
  bookingUrl: string;
  organization: {
    name: string;
    slug: string;
    timezone: string;
    businessType?: string | null;
  };
};

/** The business types the ceramics examples actually fit. */
const CERAMICS = ['Pottery studio', 'Ceramics school'];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const base = useOrgBase();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /* Whether to add the example pottery classes and equipment. Ticked for a
     ceramics studio, off for everyone else — a kayak business was handed
     three pottery classes and a kiln, or nothing at all. */
  const [examples, setExamples] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.get<State>(`${base}/onboarding`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load setup.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function seed() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ state: State }>(`${base}/onboarding/seed`, {
        examples: addExamples,
      });
      setState(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set that up.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      setState(await api.post<State>(`${base}/onboarding/publish`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) return <div className="err">{error}</div>;
  if (!state) return (
      <LoadingRegion label="Loading your setup">
        <SkeletonList count={4} lines={2} />
      </LoadingRegion>
    );

  const remaining = state.steps.filter(
    (s) => !s.done && !s.optional && s.id !== 'publish',
  );
  // Until somebody touches the box, it follows the studio's business type.
  const addExamples =
    examples ?? CERAMICS.includes(state.organization.businessType ?? '');

  return (
    <div style={{ maxWidth: 620 }}>
      <h1>Set up {state.organization.name}</h1>
      <p className="sub" style={{ marginBottom: 22 }}>
        A few minutes now and you can start taking bookings.
      </p>

      {error && <div className="err">{error}</div>}

      {state.complete ? (
        <div className="card">
          <h2>You are live</h2>
          <p className="sub">
            Put this link in your Instagram bio, on your website, anywhere.
          </p>

          <div
            className="card"
            style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {state.bookingUrl}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(state.bookingUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <a href={state.bookingUrl} target="_blank" rel="noreferrer">
              <button>Open booking page</button>
            </a>
            <button className="primary" onClick={onDone}>
              Go to dashboard
            </button>
          </div>
        </div>
      ) : (
        <>
          <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>
            {state.steps
              .filter((s) => s.id !== 'publish')
              .map((step) => (
                <li key={step.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span
                      aria-hidden
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        flex: '0 0 20px',
                        marginTop: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '.7rem',
                        background: step.done ? 'var(--ok)' : 'transparent',
                        border: step.done ? 'none' : '1px solid var(--line)',
                        color: '#fff',
                      }}
                    >
                      {step.done ? '✓' : ''}
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      {step.optional && (
                        <span className="sub" style={{ marginLeft: 8, fontSize: '.78rem' }}>
                          optional
                        </span>
                      )}
                      <div className="sub" style={{ fontSize: '.85rem' }}>
                        {step.description}
                      </div>
                      {STEP_LINKS[step.id] && (
                        <div className="setup-links">
                          {STEP_LINKS[step.id]!.map((link) => (
                            <Link
                              key={link.to}
                              to={link.to}
                              className={step.done ? 'tiny muted' : 'tiny'}
                            >
                              {step.done ? link.done : `${link.todo} →`}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ol>

          {remaining.length > 0 && (
            <div className="card">
              <h2>Set up the basics</h2>
              <p className="sub">
                We will add your location, make you the instructor, set opening
                hours of Tuesday to Saturday, 10:00 to 18:00, and a standard
                cancellation policy. Change any of it afterwards; nothing you
                have already set up will be touched.
              </p>
              <label className="check" style={{ margin: '4px 0 12px' }}>
                <input
                  type="checkbox"
                  checked={addExamples}
                  onChange={(e) => setExamples(e.target.checked)}
                />
                Also add three example pottery classes and studio equipment
                (for a ceramics studio)
              </label>
              <button className="primary" onClick={seed} disabled={busy}>
                {busy ? 'Setting up…' : 'Set up the basics'}
              </button>
            </div>
          )}

          {/*
            Every step ticked, and still nothing a customer could book.

            Setup used to say "Everything needed is in place" here, over a
            booking page that said "No dates scheduled yet" — the steps only
            count things, and a class with no dates still counts. The server
            now asks the booking page's own question and names what is stuck.
          */}
          {remaining.length === 0 && !state.readyToPublish && (
            <div className="card" style={{ marginTop: 12 }}>
              <h2>Almost — nothing can be booked yet</h2>
              <p className="sub">
                Your booking page would have nothing to sell. Fix one of these
                and you are ready to publish:
              </p>
              <StuckList stuck={state.bookable.stuck} />
            </div>
          )}

          {state.readyToPublish && (
            <div className="card" style={{ marginTop: 12 }}>
              <h2>Ready to go</h2>
              <p className="sub">
                {state.bookable.count === 1
                  ? 'One activity can be booked. Publish to start taking bookings.'
                  : `${state.bookable.count} activities can be booked. Publish to start taking bookings.`}
              </p>
              {/* Ready, but not everything — worth saying before they go live. */}
              {state.bookable.stuck.length > 0 && (
                <>
                  <p className="sub">These cannot be booked yet:</p>
                  <StuckList stuck={state.bookable.stuck} />
                </>
              )}
              <button className="primary" onClick={publish} disabled={busy}>
                Publish my booking page
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
