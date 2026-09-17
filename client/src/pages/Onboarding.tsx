import { useCallback, useEffect, useState } from 'react';
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

type State = {
  steps: Step[];
  readyToPublish: boolean;
  complete: boolean;
  bookingUrl: string;
  organization: { name: string; slug: string; timezone: string };
};

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const base = useOrgBase();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      const res = await api.post<{ state: State }>(`${base}/onboarding/seed`, {});
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
                    </div>
                  </div>
                </li>
              ))}
          </ol>

          {remaining.length > 0 && (
            <div className="card">
              <h2>Start from a working studio</h2>
              <p className="sub">
                We will add three classes, an instructor, opening hours, a
                cancellation policy and your equipment — all typical for a
                ceramics studio. Change anything you like afterwards; nothing
                you have already set up will be touched.
              </p>
              <button className="primary" onClick={seed} disabled={busy}>
                {busy ? 'Setting up…' : 'Set up my studio'}
              </button>
            </div>
          )}

          {state.readyToPublish && (
            <div className="card" style={{ marginTop: 12 }}>
              <h2>Ready to go</h2>
              <p className="sub">
                Everything needed is in place. Publish to start taking bookings.
              </p>
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
