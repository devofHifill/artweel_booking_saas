import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { setBrand, type BrandScheme, type ThemeResponse } from '../lib/brand';
import { useTheme, type Theme } from '../lib/theme';
import { EmptyState, LoadingRegion, SkeletonCard } from '../components/states';
import { PageHead, SegRange, StatusPill } from '../components/layout';

/**
 * Settings.
 *
 * Four sections behind a sub-navigation. Classes & credits is the one that
 * matters most: `makeUpCreditsEnabled` and its five siblings have been in the
 * database since the credits migration, with readers, a shipped workstream, and
 * no way for a studio owner to reach them. The column defaults to false, so
 * until this screen every studio in production had make-up credits switched off
 * and no switch.
 *
 * Two settings under Appearance look alike and are not:
 *
 *   Light/dark   personal, per browser, stored in localStorage. Changing it
 *                affects the person who clicked it and nobody else.
 *   Studio colour  studio-wide, stored in the database, admin-only, and visible
 *                to every customer on the public booking page.
 *
 * They are on one screen because both answer "how does this look", and split
 * apart because a studio owner must never discover by accident that the theme
 * they picked for themselves also repainted their storefront.
 */

/**
 * No `title` on these.
 *
 * A tooltip on a button competes with the button's own text for its accessible
 * name — the accessibility tree read back "Always light, whatever your device
 * says" where it should have read "Light". Three words that explain themselves
 * do not need a tooltip; the sentence beside the control carries the nuance.
 */
const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * The sections, in the order a studio meets them.
 *
 * Studio first because it is the thing with a name on it; Appearance second
 * because it shipped first and people will look for it; the two rule-heavy ones
 * last. The sub-navigation only exists now that there is more than one — a
 * left-hand nav listing a single item reads as a page that failed to load the
 * rest of itself.
 */
const SECTIONS = [
  { id: 'studio', label: 'Studio' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'classes', label: 'Classes & credits' },
  { id: 'cancellation', label: 'Cancellation' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function Settings() {
  const [section, setSection] = useState<SectionId>('studio');

  return (
    <>
      <PageHead
        title="Settings"
        lede="How your studio runs, and how it looks to your customers."
      />

      <div className="settings-wrap">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'on' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === 'studio' && <StudioSection />}
          {section === 'appearance' && <Appearance />}
          {section === 'classes' && <ClassesSection />}
          {section === 'cancellation' && <CancellationSection />}
        </div>
      </div>
    </>
  );
}

function Appearance() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const { theme, setTheme } = useTheme();

  const [state, setState] = useState<ThemeResponse | null>(null);
  const [custom, setCustom] = useState('#a6522c');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  /**
   * Only an owner or admin may restyle the studio.
   *
   * Mirrors `requireAdmin` on the route. The server is what enforces it — this
   * only decides whether to render controls that would be refused, because an
   * instructor clicking a swatch and getting a 403 is a worse answer than not
   * being offered the swatch.
   */
  const canEdit = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const res = await api.get<ThemeResponse>(`${base}/theme`);
      setState(res);
      if (res.accent) setCustom(res.accent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your theme.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Saves, then repaints immediately from the response.
   *
   * The response carries the RESOLVED palette rather than the request, which
   * matters for a custom colour: the server may have darkened it for contrast,
   * and painting what was asked for would show the owner a colour their studio
   * is not actually using.
   */
  async function save(body: { preset: string; accent?: string }) {
    if (!canEdit || !org) return;

    setBusy(true);
    setError(null);
    setNotes([]);

    try {
      const res = await api.patch<{
        preset: string;
        accent: string | null;
        tokens: BrandScheme;
        adjusted: boolean;
        notes: string[];
      }>(`${base}/theme`, body);

      setBrand(org.organizationId, res.tokens);
      setState((prev) =>
        prev ? { ...prev, preset: res.preset, accent: res.accent, tokens: res.tokens } : prev,
      );
      if (res.accent) setCustom(res.accent);
      if (res.adjusted) setNotes(res.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your theme.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Appearance</h2>

      {/* --- personal ---------------------------------------------------- */}

      <div className="setting">
        <div className="setting-label">
          <h3>Theme</h3>
          <p className="sub">
            Light or dark, for you on this device — <em>System</em> follows
            whatever your device is set to. Your customers and the rest of your
            team are not affected.
          </p>
        </div>

        <SegRange
          label="Theme"
          options={THEMES}
          value={theme}
          onChange={setTheme}
        />
      </div>

      <hr />

      {/* --- studio-wide -------------------------------------------------- */}

      <div className="setting setting-stack">
        <div className="setting-label">
          <h3>Studio colour</h3>
          <p className="sub">
            Used across your dashboard <strong>and your public booking page</strong>.
            Everyone at {org?.organization.name ?? 'your studio'} sees this, and so
            do your customers.
          </p>
        </div>

        {!state && !error && (
          <LoadingRegion label="Loading your theme">
            <SkeletonCard lines={2} />
          </LoadingRegion>
        )}

        {state && (
          <>
            <div className="brand-swatches" role="group" aria-label="Studio colour">
              {state.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`brand-swatch ${state.preset === preset.id ? 'on' : ''}`}
                  aria-pressed={state.preset === preset.id}
                  disabled={!canEdit || busy}
                  onClick={() => void save({ preset: preset.id })}
                >
                  <span
                    className="brand-swatch-chip"
                    style={{ background: preset.swatch }}
                    aria-hidden="true"
                  />
                  {preset.name}
                </button>
              ))}
            </div>

            {canEdit && (
              <div className="custom-accent">
                <label htmlFor="accent">Or use your own</label>

                <div className="accent-row">
                  {/*
                    A native colour input alongside the hex field. The picker is
                    how most people choose; the text field is how somebody with a
                    brand book pastes the exact value they were given.
                  */}
                  <input
                    id="accent"
                    type="color"
                    value={custom}
                    disabled={busy}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                  <input
                    type="text"
                    className="hex"
                    value={custom}
                    disabled={busy}
                    spellCheck={false}
                    aria-label="Hex colour"
                    onChange={(e) => setCustom(e.target.value)}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !/^#[0-9a-fA-F]{6}$/.test(custom)}
                    onClick={() => void save({ preset: 'custom', accent: custom })}
                  >
                    Use this colour
                  </button>
                </div>

                {/*
                  Stated up front rather than only after it happens. A colour may
                  come back darker than it went in, and an owner who was not
                  warned reads that as the picker being broken.
                */}
                <p className="sub">
                  Colours are adjusted if needed so white button text stays
                  readable.
                </p>
              </div>
            )}

            {notes.length > 0 && (
              <div className="alert warn" role="status">
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            )}

            {!canEdit && (
              <p className="sub">
                Only an owner or admin can change the studio colour.
              </p>
            )}

            <Preview />
          </>
        )}

        {error && (
          <div className="alert danger" role="alert">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * What the colour actually does.
 *
 * A row of swatches shows the hue and hides the consequence. The three things
 * below are every job the accent has — a solid button with white text on it, the
 * accent as a link, and a tinted panel — so an owner sees the decision rather
 * than the ingredient. It uses the live tokens, so it is the real thing rather
 * than a mock-up of it.
 */
function Preview() {
  return (
    <div className="theme-preview" aria-label="Preview">
      <span className="preview-label">Preview</span>
      <div className="preview-row">
        <button type="button" className="primary" disabled>
          Book a class
        </button>
        <a href="#preview" onClick={(e) => e.preventDefault()}>
          A link
        </a>
        <span className="preview-tint">Tinted panel</span>
      </div>
    </div>
  );
}

// --- Studio -----------------------------------------------------------------

type Organization = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  makeUpCreditsEnabled: boolean;
  makeUpCreditDays: number;
  makeUpRequiresNotice: boolean;
  makeUpNoticeHours: number;
  makeUpCrossCohort: boolean;
  pieceHoldDays: number;
};

/**
 * Loads the organization once per section.
 *
 * Two sections read the same row, and both are one PATCH away from changing it.
 * Sharing a cached copy between them would mean the Classes panel showing a name
 * the Studio panel had already changed — the classic stale-parent bug. A section
 * is opened rarely and the row is tiny; fetching on mount is the honest option.
 */
function useOrganization() {
  const base = useOrgBase();
  const [org, setOrg] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ organization: Organization }>(base);
      setOrg(res.organization);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  return { org, setOrg, error, setError, reload: load, base };
}

/** A common shape for the timezones a US studio actually picks. */
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

function StudioSection() {
  const { org, error, setError, base, reload } = useOrganization();
  const { role } = useActiveOrg() ?? {};
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [form, setForm] = useState({ name: '', timezone: '', currency: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (org) setForm({ name: org.name, timezone: org.timezone, currency: org.currency });
  }, [org]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await api.patch(base, {
        name: form.name.trim(),
        timezone: form.timezone,
        currency: form.currency,
      });
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="err">{error}</div>;
  if (!org) {
    return (
      <LoadingRegion label="Loading studio settings">
        <SkeletonCard lines={3} />
      </LoadingRegion>
    );
  }

  return (
    <section className="card settings-section">
      <h2>Studio</h2>

      <form onSubmit={(e) => void save(e)}>
        <div className="fields">
          <label>
            Studio name
            <input
              value={form.name}
              disabled={!canEdit}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <span className="sub">Customers see this on your booking page.</span>
          </label>

          <label>
            Timezone
            <select
              value={form.timezone}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {/* The stored value may be outside the shortlist — a studio set up
                  by hand, or one that moved. Showing it keeps the select honest
                  rather than silently reassigning them to New York. */}
              {!TIMEZONES.includes(form.timezone) && form.timezone && (
                <option value={form.timezone}>{form.timezone}</option>
              )}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace('_', ' ')}
                </option>
              ))}
            </select>
            <span className="sub">
              Every class time, reminder and report is written in this zone.
            </span>
          </label>

          <label>
            Currency
            <input
              value={form.currency}
              disabled={!canEdit}
              maxLength={3}
              style={{ textTransform: 'uppercase', width: '8ch' }}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase() })
              }
            />
          </label>
        </div>

        {canEdit && (
          <div className="toolbar">
            <button className="primary" disabled={busy}>
              Save
            </button>
            {saved && <span className="saved-note">Saved.</span>}
          </div>
        )}
      </form>
    </section>
  );
}

// --- Classes & credits ------------------------------------------------------

/**
 * The six policy columns.
 *
 * These have been in the database since the credits migration, with readers, a
 * whole workstream built on them, and — until the organization PATCH route — no
 * writer at all. Then a writer with no screen. This is the screen: the first
 * point at which a studio owner can turn make-up credits on without somebody
 * opening psql for them.
 *
 * `makeUpCreditsEnabled` defaults to FALSE, so until now every studio in
 * production had the feature switched off and no switch.
 */
function ClassesSection() {
  const { org, error, setError, base, reload } = useOrganization();
  const { role } = useActiveOrg() ?? {};
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [form, setForm] = useState({
    makeUpCreditsEnabled: false,
    makeUpCreditDays: 90,
    makeUpRequiresNotice: true,
    makeUpNoticeHours: 24,
    makeUpCrossCohort: true,
    pieceHoldDays: 30,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!org) return;
    setForm({
      makeUpCreditsEnabled: org.makeUpCreditsEnabled,
      makeUpCreditDays: org.makeUpCreditDays,
      makeUpRequiresNotice: org.makeUpRequiresNotice,
      makeUpNoticeHours: org.makeUpNoticeHours,
      makeUpCrossCohort: org.makeUpCrossCohort,
      pieceHoldDays: org.pieceHoldDays,
    });
  }, [org]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await api.patch(base, {
        ...form,
        makeUpCreditDays: Number(form.makeUpCreditDays),
        makeUpNoticeHours: Number(form.makeUpNoticeHours),
        pieceHoldDays: Number(form.pieceHoldDays),
      });
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="err">{error}</div>;
  if (!org) {
    return (
      <LoadingRegion label="Loading class settings">
        <SkeletonCard lines={3} />
      </LoadingRegion>
    );
  }

  return (
    <section className="card settings-section">
      <h2>Classes &amp; credits</h2>

      <form onSubmit={(e) => void save(e)}>
        <div className="setting">
          <div className="setting-label">
            <h3>Make-up credits</h3>
            <p className="sub">
              When a student misses a class, give them a credit to use on another
              one. Off by default — a studio that has never offered make-ups
              should not start silently.
            </p>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={form.makeUpCreditsEnabled}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({ ...form, makeUpCreditsEnabled: e.target.checked })
              }
            />
            Offer make-up credits
          </label>
        </div>

        {/*
          The rules only exist if the feature does. Showing four inputs that
          govern something switched off invites somebody to set them carefully
          and wonder later why nothing happened.
        */}
        {form.makeUpCreditsEnabled && (
          <div className="fields indent">
            <label>
              Credits expire after
              <span className="with-unit">
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={form.makeUpCreditDays}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, makeUpCreditDays: Number(e.target.value) })
                  }
                />
                <span>days</span>
              </span>
              <span className="sub">0 means they never expire.</span>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.makeUpRequiresNotice}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm({ ...form, makeUpRequiresNotice: e.target.checked })
                }
              />
              Only if they tell you in advance
            </label>

            {form.makeUpRequiresNotice && (
              <label>
                How much notice
                <span className="with-unit">
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={form.makeUpNoticeHours}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, makeUpNoticeHours: Number(e.target.value) })
                    }
                  />
                  <span>hours</span>
                </span>
              </label>
            )}

            <label className="check">
              <input
                type="checkbox"
                checked={form.makeUpCrossCohort}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm({ ...form, makeUpCrossCohort: e.target.checked })
                }
              />
              Usable on any class, not just their own course
            </label>
          </div>
        )}

        <hr />

        <div className="setting">
          <div className="setting-label">
            <h3>Finished pieces</h3>
            <p className="sub">
              How long a finished piece waits on the shelf before your dashboard
              starts asking about it.
            </p>
          </div>

          <label>
            <span className="with-unit">
              <input
                type="number"
                min={0}
                max={3650}
                value={form.pieceHoldDays}
                disabled={!canEdit}
                onChange={(e) =>
                  setForm({ ...form, pieceHoldDays: Number(e.target.value) })
                }
              />
              <span>days</span>
            </span>
            <span className="sub">0 means never chase.</span>
          </label>
        </div>

        {canEdit ? (
          <div className="toolbar">
            <button className="primary" disabled={busy}>
              Save
            </button>
            {saved && <span className="saved-note">Saved.</span>}
          </div>
        ) : (
          <p className="sub">Only an owner or admin can change these.</p>
        )}
      </form>
    </section>
  );
}

// --- Cancellation -----------------------------------------------------------

type Tier = { hoursBefore: number; refundPercent: number; creditPercent?: number };

/**
 * How much notice a tier covers, in words.
 *
 * The zero tier is the catch-all at the bottom of the ladder — it matches any
 * cancellation that did not qualify for a tier above it. Rendering it literally
 * as "0 hours or more" is technically what the number says and tells an owner
 * nothing about when it applies.
 *
 * And a day is a day: "1 days or more" is the kind of thing that makes a
 * carefully built settings screen look unfinished.
 */
function noticeLabel(hoursBefore: number): string {
  if (hoursBefore === 0) return 'Any later than that';

  if (hoursBefore >= 24) {
    const days = Math.round(hoursBefore / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} or more`;
  }

  return `${hoursBefore} ${hoursBefore === 1 ? 'hour' : 'hours'} or more`;
}

type Policy = {
  id: string;
  name: string;
  tiers: Tier[];
  isDefault: boolean;
  noShowFeeCents: number;
  allowReschedule: boolean;
  rescheduleCutoffHours: number;
};

/**
 * Cancellation policies.
 *
 * Read-only here, deliberately. The tiers are an ordered ladder — "24 hours
 * before: 100% refund; 6 hours: 50% and a credit; after that: nothing" — and an
 * editor for that is a real piece of interface with reordering, validation and
 * a live preview of what a given notice period would pay out. Half-building it
 * would produce something that saves a ladder nobody can reason about, against
 * the one setting in the product that decides who gets their money back.
 *
 * What this does instead is make the current rules VISIBLE, which they have
 * never been outside the database, and say plainly where the gap is.
 */
function CancellationSection() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const currency = org?.organization.currency ?? 'USD';

  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ policies: Policy[] }>(`${base}/cancellation-policies`)
      .then((res) => !cancelled && setPolicies(res.policies))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof Error ? err.message : 'Could not load policies.'),
      );
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (error) return <div className="err">{error}</div>;
  if (!policies) {
    return (
      <LoadingRegion label="Loading cancellation policies">
        <SkeletonCard lines={3} />
      </LoadingRegion>
    );
  }

  return (
    <section className="card settings-section">
      <h2>Cancellation</h2>
      <p className="sub">
        What a customer gets back when they cancel, by how much notice they give.
      </p>

      {policies.length === 0 ? (
        <EmptyState hint="Without one, a cancellation refunds in full.">
          No cancellation policy set.
        </EmptyState>
      ) : (
        <div className="policy-list">
          {policies.map((policy) => (
            <div className="policy" key={policy.id}>
              <div className="policy-head">
                <h3>
                  {policy.name}
                  {policy.isDefault && <StatusPill status="ACTIVE">Default</StatusPill>}
                </h3>
              </div>

              <ol className="tiers">
                {[...policy.tiers]
                  .sort((a, b) => b.hoursBefore - a.hoursBefore)
                  .map((tier) => (
                    <li key={tier.hoursBefore}>
                      <span className="tier-when">{noticeLabel(tier.hoursBefore)}</span>
                      <span className="tier-what">
                        {tier.refundPercent}% refunded
                        {tier.creditPercent
                          ? ` · ${tier.creditPercent}% as credit`
                          : ''}
                      </span>
                    </li>
                  ))}
              </ol>

              <dl className="policy-meta">
                <div>
                  <dt>No-show fee</dt>
                  <dd>
                    {policy.noShowFeeCents > 0
                      ? money(policy.noShowFeeCents, currency)
                      : 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Rescheduling</dt>
                  <dd>
                    {policy.allowReschedule
                      ? `Allowed up to ${policy.rescheduleCutoffHours}h before`
                      : 'Not allowed'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      {/*
        Said out loud rather than left as a missing button. An owner who cannot
        find the edit control should know it does not exist yet, not conclude
        they lack permission.
      */}
      <p className="sub">
        Editing the refund ladder is not built yet — it needs its own screen, with
        a preview of what each notice period actually pays out. Ask and it can be
        changed for you in the meantime.
      </p>
    </section>
  );
}
