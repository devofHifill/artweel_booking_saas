import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';

/**
 * The studio's default cancellation terms.
 *
 * This replaces a read-only panel whose comment argued that a ladder editor
 * was too dangerous to half-build. That objection was about a GENERAL editor —
 * arbitrary rungs, reordering, credit splits. These four fields are a complete
 * editor for the two-rung ladder almost every studio actually wants, and the
 * one case they cannot express is detected and called out rather than silently
 * flattened.
 *
 * What the numbers mean, because the mapping is not obvious:
 *
 *   Free cancellation until (h)  a rung at that many hours, refunding 100%
 *   Late cancellation fee (%)    the zero-hour rung, refunding 100 minus it
 *   No-show fee (%)              `noShowFeePercent`, a separate branch in
 *                                evaluatePolicy — somebody who never turned up
 *                                gave no notice, which is not always the same
 *                                answer as cancelling a minute before.
 */

type Tier = {
  hoursBefore: number;
  refundPercent: number;
  creditPercent?: number;
};

type Policy = {
  id: string;
  name: string;
  tiers: Tier[];
  isDefault: boolean;
  noShowFeePercent: number;
  description: string | null;
};

/**
 * Named shapes, so the common cases are one click.
 *
 * These are the studio-facing NAME of the policy, stored in `name`. Nothing
 * branches on them — the ladder is what gets evaluated, and two studios both
 * calling their policy Flexible may well refund differently.
 */
const POLICY_PRESETS: Record<string, { freeUntil: number; lateFee: number }> = {
  Flexible: { freeUntil: 24, lateFee: 50 },
  Moderate: { freeUntil: 48, lateFee: 75 },
  Strict: { freeUntil: 168, lateFee: 100 },
};

/**
 * The sentence a customer reads, generated from the numbers.
 *
 * Offered as the placeholder and used by the booking page when a studio writes
 * nothing. Generated rather than stored means it cannot contradict the terms
 * being enforced — which is precisely what free text is free to do.
 */
function generatedTerms(
  freeUntil: number,
  lateFee: number,
  noShow: number,
): string {
  const parts = [
    freeUntil > 0
      ? `Free cancellation up to ${freeUntil} hours before your class starts.`
      : 'Cancellations are charged from the moment you book.',
  ];

  if (lateFee > 0 && freeUntil > 0) {
    parts.push(`Cancellations inside ${freeUntil} hours are charged ${lateFee}%.`);
  }

  parts.push(
    noShow >= 100
      ? 'No-shows are charged in full.'
      : `No-shows are charged ${noShow}%.`,
  );

  return parts.join(' ');
}

export function CancellationPolicySection() {
  const base = useOrgBase();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name: 'Flexible',
    freeUntil: '24',
    lateFee: '50',
    noShowFee: '100',
    description: '',
  });

  /** True when the stored ladder is richer than four boxes can hold. */
  const [complex, setComplex] = useState(false);

  useEffect(() => {
    api
      .get<{ policies: Policy[] }>(`${base}/cancellation-policies`)
      .then((res) => {
        const chosen = res.policies.find((p) => p.isDefault) ?? res.policies[0];
        if (!chosen) return;
        setPolicy(chosen);

        const tiers = [...(chosen.tiers ?? [])].sort(
          (a, b) => b.hoursBefore - a.hoursBefore,
        );
        const free = tiers.find((t) => t.refundPercent === 100);
        const last = tiers[tiers.length - 1];

        /*
          More than two rungs, or any studio credit, cannot be expressed here.
          The form still loads — hiding it would leave a studio unable to see
          its own terms — but it says so, because saving would otherwise
          quietly flatten a ladder somebody built deliberately.
        */
        setComplex(
          tiers.length > 2 || tiers.some((t) => (t.creditPercent ?? 0) > 0),
        );

        setForm({
          name: chosen.name,
          freeUntil: String(free?.hoursBefore ?? 0),
          lateFee: String(100 - (last?.refundPercent ?? 0)),
          noShowFee: String(chosen.noShowFeePercent ?? 100),
          description: chosen.description ?? '',
        });
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load.'),
      );
  }, [base]);

  function applyPreset(name: string) {
    const preset = POLICY_PRESETS[name];
    setForm((f) => ({
      ...f,
      name,
      ...(preset
        ? {
            freeUntil: String(preset.freeUntil),
            lateFee: String(preset.lateFee),
          }
        : {}),
    }));
  }

  async function save() {
    if (!policy) return;
    setBusy(true);
    setSaved(false);
    setError(null);

    const freeUntil = Number(form.freeUntil) || 0;
    const lateFee = Math.min(100, Math.max(0, Number(form.lateFee) || 0));

    /*
      Built in the order the server demands: longest notice first, and a final
      rung at zero hours so a last-minute cancellation has defined terms.
      `validateTiers` refuses anything else, and is right to — a ladder with no
      zero rung leaves the refund path with no answer.
    */
    const tiers: Tier[] = [
      ...(freeUntil > 0
        ? [{ hoursBefore: freeUntil, refundPercent: 100 }]
        : []),
      { hoursBefore: 0, refundPercent: 100 - lateFee },
    ];

    try {
      await api.patch(`${base}/cancellation-policies/${policy.id}`, {
        name: form.name,
        tiers,
        noShowFeePercent: Number(form.noShowFee) || 0,
        description: form.description.trim() || null,
      });
      setSaved(true);
      setComplex(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !policy) return <div className="err">{error}</div>;
  if (!policy) return <div className="card">Loading…</div>;

  const suggested = generatedTerms(
    Number(form.freeUntil) || 0,
    Number(form.lateFee) || 0,
    Number(form.noShowFee) || 0,
  );

  return (
    <section className="card">
      <h2>Cancellation policy</h2>
      <p className="sub">
        The default for new activities — each activity can override it.
      </p>

      {error && <div className="err">{error}</div>}

      {complex && (
        <div className="alert warn" role="note">
          This policy has more steps than these four boxes can show — extra
          refund tiers, or studio credit. Saving here replaces it with the
          simpler ladder below.
        </div>
      )}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cpType">Policy type</label>
          <select
            id="cpType"
            value={form.name in POLICY_PRESETS ? form.name : 'Custom'}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {Object.keys(POLICY_PRESETS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="Custom">Custom</option>
          </select>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cpFree">Free cancellation until (hours before)</label>
          <input
            id="cpFree"
            type="number"
            min={0}
            max={8760}
            value={form.freeUntil}
            onChange={(e) => setForm({ ...form, freeUntil: e.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="cpLate">Late cancellation fee (%)</label>
          <input
            id="cpLate"
            type="number"
            min={0}
            max={100}
            value={form.lateFee}
            onChange={(e) => setForm({ ...form, lateFee: e.target.value })}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="cpNoShow">No-show fee (%)</label>
          <input
            id="cpNoShow"
            type="number"
            min={0}
            max={100}
            value={form.noShowFee}
            onChange={(e) => setForm({ ...form, noShowFee: e.target.value })}
          />
        </div>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="cpText">Policy text shown to guests</label>
        <textarea
          id="cpText"
          rows={3}
          maxLength={1000}
          value={form.description}
          placeholder={suggested}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {/*
          The generated sentence is the placeholder, so an empty box gives
          prose that cannot contradict the numbers. When a studio writes their
          own, the figures above are still what gets enforced — worth saying,
          because free text is free to disagree with them.
        */}
        <p className="tiny muted">
          Leave this empty and guests are shown the sentence above. Whatever
          you write here is what they read; the figures are what is applied.
        </p>
      </div>

      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={() => void save()}>
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
