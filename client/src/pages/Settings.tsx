import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { setBrand, type BrandScheme, type ThemeResponse } from '../lib/brand';
import { useTheme, type Theme } from '../lib/theme';
import { LoadingRegion, SkeletonCard } from '../components/states';
import { PageHead, SegRange } from '../components/layout';

/**
 * Settings.
 *
 * One section for now. The sub-navigation TourFlow uses arrives with the rest
 * of the sections rather than ahead of them — a left-hand nav listing a single
 * item reads as a page that failed to load the other twelve.
 *
 * Two settings live here that look alike and are not:
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

export default function Settings() {
  return (
    <>
      <PageHead
        title="Settings"
        lede="How your studio looks, to you and to your customers."
      />

      <Appearance />
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
