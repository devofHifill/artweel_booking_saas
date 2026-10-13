import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';

/**
 * The studio's default cancellation terms, step by step.
 *
 * This was four boxes: "free until N hours" and "late fee %", a two-step
 * ladder. Anything richer — the Standard policy setup creates has three steps
 * — could not be shown, and saving flattened it. It is now the ladder itself:
 * each step says how much notice it needs and what percentage it refunds,
 * which is exactly what the refund path evaluates (`evaluatePolicy`: the first
 * step whose notice the customer met).
 *
 * Refund only. There used to be a "studio credit" column, but nothing ever
 * issued the credit, so a customer in a credit step got nothing back while the
 * terms said otherwise. It was taken out rather than built, to keep the terms
 * one number a studio and a customer can both read.
 *
 * The same screen now holds the reschedule rules, which the policy has always
 * carried and no screen could reach: customers moving their own booking from
 * the manage page was allowed up to 24 hours before, with no way to change it.
 */

type Tier = {
  hoursBefore: number;
  refundPercent: number;
};

type Policy = {
  id: string;
  name: string;
  tiers: Tier[];
  isDefault: boolean;
  noShowFeePercent: number;
  description: string | null;
  allowReschedule: boolean;
  rescheduleCutoffHours: number;
};

/** One step as the form holds it: strings, so a half-typed box is not NaN. */
type Step = { hours: string; refund: string };

const toSteps = (tiers: Tier[]): Step[] =>
  [...tiers]
    .sort((a, b) => b.hoursBefore - a.hoursBefore)
    .map((t) => ({
      hours: String(t.hoursBefore),
      refund: String(t.refundPercent),
    }));

/**
 * Named shapes, so the common cases are one click. Nothing branches on the
 * name; the steps are what is applied.
 */
const PRESETS: Record<string, Tier[]> = {
  Flexible: [
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 0, refundPercent: 50 },
  ],
  Moderate: [
    { hoursBefore: 48, refundPercent: 100 },
    { hoursBefore: 0, refundPercent: 25 },
  ],
  Strict: [
    { hoursBefore: 168, refundPercent: 100 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  /* What "Set up the basics" creates: all back with two days' notice, half
     with one, nothing after that. */
  Standard: [
    { hoursBefore: 48, refundPercent: 100 },
    { hoursBefore: 24, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
};

const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

/** "a full refund", "50% back", "nothing back". */
function gives(refund: number): string {
  if (refund >= 100) return 'a full refund';
  if (refund > 0) return `${refund}% back`;
  return 'nothing back';
}

/**
 * The sentence a customer reads, generated from the steps.
 *
 * Offered as the placeholder and used when a studio writes nothing, so the
 * prose cannot contradict the terms being enforced.
 */
function generatedTerms(steps: Step[], noShow: number): string {
  const sorted = [...steps].sort((a, b) => num(b.hours) - num(a.hours));
  const lines = sorted.map((s) => {
    const what = gives(num(s.refund));
    if (num(s.hours) === 0) {
      return sorted.length === 1
        ? `Cancel any time and you get ${what}.`
        : `Cancel later than that and you get ${what}.`;
    }
    return `Cancel at least ${num(s.hours)} hours before and you get ${what}.`;
  });
  lines.push(
    noShow >= 100 ? 'No-shows get nothing back.' : `No-shows get ${100 - noShow}% back.`,
  );
  return lines.join(' ');
}

/** What is wrong with the steps, in the operator's words, or null. */
function problemWith(steps: Step[]): string | null {
  const hours = steps.map((s) => num(s.hours));
  if (new Set(hours).size !== hours.length) {
    return 'Two steps have the same number of hours. Give each a different one.';
  }
  for (const s of steps) {
    if (num(s.refund) > 100) return 'Percentages go up to 100.';
  }
  return null;
}

export function CancellationPolicySection() {
  const base = useOrgBase();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState('Flexible');
  /** Longest notice first; the last is always the 0-hour "later than that". */
  const [steps, setSteps] = useState<Step[]>(toSteps(PRESETS.Flexible!));
  const [noShowFee, setNoShowFee] = useState('100');
  const [description, setDescription] = useState('');
  const [allowReschedule, setAllowReschedule] = useState(true);
  const [rescheduleCutoff, setRescheduleCutoff] = useState('24');

  useEffect(() => {
    api
      .get<{ policies: Policy[] }>(`${base}/cancellation-policies`)
      .then((res) => {
        const chosen = res.policies.find((p) => p.isDefault) ?? res.policies[0];
        if (!chosen) return;
        setPolicy(chosen);
        setName(chosen.name);
        const loaded = toSteps(chosen.tiers ?? []);
        // A ladder must end at 0 hours; add the step if one never did.
        if (!loaded.some((s) => num(s.hours) === 0)) {
          loaded.push({ hours: '0', refund: '0' });
        }
        setSteps(loaded);
        setNoShowFee(String(chosen.noShowFeePercent ?? 100));
        setDescription(chosen.description ?? '');
        setAllowReschedule(chosen.allowReschedule ?? true);
        setRescheduleCutoff(String(chosen.rescheduleCutoffHours ?? 24));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load.'),
      );
  }, [base]);

  function applyPreset(presetName: string) {
    setName(presetName);
    const preset = PRESETS[presetName];
    if (preset) setSteps(toSteps(preset));
  }

  function editStep(index: number, change: Partial<Step>) {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...change } : s)));
    setName((n) => (n in PRESETS ? 'Custom' : n));
  }

  function addStep() {
    // A new step between the longest and the rest; the operator sets its hours.
    setSteps((current) => {
      const longest = num(current[0]?.hours ?? '0');
      const next = { hours: String(Math.max(1, Math.round(longest / 2) || 12)), refund: '50' };
      return [...current, next].sort((a, b) => num(b.hours) - num(a.hours));
    });
    setName((n) => (n in PRESETS ? 'Custom' : n));
  }

  function removeStep(index: number) {
    setSteps((current) => current.filter((_, i) => i !== index));
    setName((n) => (n in PRESETS ? 'Custom' : n));
  }

  const problem = problemWith(steps);

  async function save() {
    if (!policy || problem) return;
    setBusy(true);
    setSaved(false);
    setError(null);

    /* Longest notice first, as the server demands, ending at zero hours so a
       last-minute cancellation has defined terms. */
    const tiers: Tier[] = [...steps]
      .sort((a, b) => num(b.hours) - num(a.hours))
      .map((s) => ({
        hoursBefore: num(s.hours),
        refundPercent: num(s.refund),
      }));

    try {
      await api.patch(`${base}/cancellation-policies/${policy.id}`, {
        name: name.trim() || 'Custom',
        tiers,
        noShowFeePercent: Math.min(100, num(noShowFee)),
        description: description.trim() || null,
        allowReschedule,
        rescheduleCutoffHours: num(rescheduleCutoff),
      });
      setSteps(toSteps(tiers));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !policy) return <div className="err">{error}</div>;
  if (!policy) return <div className="card">Loading…</div>;

  const suggested = generatedTerms(steps, num(noShowFee));

  return (
    <section className="card">
      <h2>Cancellation policy</h2>
      <p className="sub">
        The default for new activities — each activity can choose its own.
      </p>

      {error && <div className="err">{error}</div>}

      <div className="setting setting-stack">
        <label htmlFor="cpType">Start from</label>
        <select
          id="cpType"
          value={name in PRESETS ? name : 'Custom'}
          onChange={(e) => applyPreset(e.target.value)}
        >
          {Object.keys(PRESETS).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="Custom">Custom</option>
        </select>
      </div>

      {/*
        The ladder. Each row: how much notice it needs, and what it gives back.
        The last row is the catch-all for anything later and cannot be removed —
        a cancellation a minute before still needs an answer.
      */}
      <h3 className="form-section">What a cancellation gets back</h3>
      <table className="policy-steps">
        <thead>
          <tr>
            <th scope="col">When they cancel</th>
            <th scope="col">Refund (%)</th>
            <th scope="col" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => {
            const last = num(step.hours) === 0;
            return (
              <tr key={i}>
                <td>
                  {last ? (
                    <span>{steps.length === 1 ? 'Any time' : 'Later than that'}</span>
                  ) : (
                    <label className="inline">
                      At least{' '}
                      <input
                        type="number"
                        min={1}
                        max={8760}
                        value={step.hours}
                        aria-label={`Step ${i + 1}: hours of notice`}
                        onChange={(e) => editStep(i, { hours: e.target.value })}
                      />{' '}
                      hours before
                    </label>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={step.refund}
                    aria-label={`Step ${i + 1}: refund percentage`}
                    onChange={(e) => editStep(i, { refund: e.target.value })}
                  />
                </td>
                <td>
                  {!last && (
                    <button type="button" className="link danger" onClick={() => removeStep(i)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="link" onClick={addStep}>
        + Add a step
      </button>
      {problem && (
        <div className="alert warn" role="alert">
          {problem}
        </div>
      )}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cpNoShow">No-show fee (%)</label>
          <input
            id="cpNoShow"
            type="number"
            min={0}
            max={100}
            value={noShowFee}
            onChange={(e) => setNoShowFee(e.target.value)}
          />
          <p className="tiny muted">What someone who doesn't turn up forfeits. 100 means nothing back.</p>
        </div>
      </div>

      {/*
        Customers moving their own booking from the manage page. The policy has
        always held these two values; nothing could change them, so every studio
        allowed moves up to 24 hours before whether it wanted to or not.
      */}
      <h3 className="form-section">Changing the date</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={allowReschedule}
          onChange={(e) => setAllowReschedule(e.target.checked)}
        />
        Let customers change the date of their booking themselves
      </label>
      {allowReschedule && (
        <div className="setting setting-stack">
          <label htmlFor="cpResched">Up to how many hours before it starts</label>
          <input
            id="cpResched"
            type="number"
            min={0}
            max={8760}
            value={rescheduleCutoff}
            onChange={(e) => setRescheduleCutoff(e.target.value)}
          />
          <p className="tiny muted">
            From the Manage or cancel link in their confirmation. 0 means right up to the start.
          </p>
        </div>
      )}

      <div className="setting setting-stack">
        <label htmlFor="cpText">Policy text shown to guests</label>
        <textarea
          id="cpText"
          rows={3}
          maxLength={1000}
          value={description}
          placeholder={suggested}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="tiny muted">
          Leave this empty and guests are shown the sentence above. Whatever you
          write here is what they read; the steps are what is applied.
        </p>
      </div>

      <div className="toolbar">
        <button className="primary" disabled={busy || Boolean(problem)} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {saved && (
          <span className="tiny muted" role="status">
            Saved.
          </span>
        )}
      </div>
    </section>
  );
}
