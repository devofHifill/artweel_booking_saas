import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { setBrand, type BrandScheme, type ThemeResponse } from '../lib/brand';
import { useTheme, type Theme } from '../lib/theme';
import { LoadingRegion, SkeletonCard } from '../components/states';
import { PageHead, SegRange } from '../components/layout';
import {
  BookingSettingsSection,
  CurrencySection,
  DangerZoneSection,
  EmailSettingsSection,
  LocalisationSection,
  PaymentSettingsSection,
  RolesTable,
  SmsSettingsSection,
} from '../components/settings-sections';
import { CancellationPolicySection } from '../components/CancellationPolicyForm';

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
  { id: 'studio', label: 'Business Information' },
  { id: 'booking', label: 'Booking Settings' },
  { id: 'payments', label: 'Payment Settings' },
  { id: 'cancellation', label: 'Cancellation Policy' },
  { id: 'email', label: 'Email Settings' },
  { id: 'sms', label: 'SMS Settings' },
  { id: 'team', label: 'Users & Permissions' },
  { id: 'currency', label: 'Currency' },
  { id: 'localisation', label: 'Localisation' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'classes', label: 'Classes & credits' },
  { id: 'danger', label: 'Danger Zone' },
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
          {section === 'booking' && <BookingSettingsSection />}
          {section === 'payments' && <PaymentSettingsSection />}
          {section === 'email' && <EmailSettingsSection />}
          {section === 'sms' && <SmsSettingsSection />}
          {section === 'currency' && <CurrencySection />}
          {section === 'localisation' && <LocalisationSection />}
          {section === 'danger' && <DangerZoneSection />}
          {section === 'team' && (
            <>
              <TeamSection />
              <RolesTable />
            </>
          )}
          {section === 'appearance' && <Appearance />}
          {section === 'classes' && <ClassesSection />}
          {section === 'cancellation' && <CancellationPolicySection />}
        </div>
      </div>
    </>
  );
}

// --- Team -------------------------------------------------------------------

type Member = {
  membershipId: string;
  role: 'OWNER' | 'ADMIN' | 'INSTRUCTOR' | 'FRONT_DESK';
  user: { id: string; name: string; email: string; emailVerified: boolean };
};

type Invitation = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  invitedBy: string | null;
};

const ROLES = [
  {
    value: 'ADMIN',
    label: 'Admin',
    help: 'Everything except billing and removing owners.',
  },
  {
    value: 'INSTRUCTOR',
    label: 'Instructor',
    help: 'Their own classes, the manifest, and taking the register.',
  },
  {
    value: 'FRONT_DESK',
    label: 'Front desk',
    help: 'Bookings, customers and payments. Cannot change how the studio runs.',
  },
] as const;

/**
 * Who works here, and how somebody new gets in.
 *
 * This is the screen the role model was waiting for. `register` only ever
 * creates an OWNER, so until invitations shipped, ADMIN, INSTRUCTOR and
 * FRONT_DESK were enforced on every route and grantable nowhere — the Staff
 * page described people who could not sign in.
 *
 * Note the two lists are different things and are labelled as such: STAFF are
 * people the studio schedules classes for, TEAM are people with a login. They
 * overlap and are not the same, and conflating them is how an instructor ends
 * up on a rota with no way to see it.
 */
function TeamSection() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const canEdit = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [team, invites] = await Promise.all([
        api.get<{ members: Member[] }>(`${base}/members`),
        canEdit
          ? api.get<{ invitations: Invitation[] }>(`${base}/invitations`)
          : Promise.resolve({ invitations: [] as Invitation[] }),
      ]);
      setMembers(team.members);
      setInvitations(invites.invitations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your team.');
    }
  }, [base, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = invitations.filter((i) => i.status === 'PENDING');

  return (
    <section className="card settings-section">
      <h2>Team</h2>
      <p className="sub">
        People who can sign in to {org?.organization.name ?? 'your studio'}.
        Instructors you schedule but who never log in belong on{' '}
        <a href="/staff">Staff &amp; guides</a> instead.
      </p>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      {!members && !error && (
        <LoadingRegion label="Loading your team">
          <SkeletonCard lines={3} />
        </LoadingRegion>
      )}

      {members && (
        <table className="roll">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.membershipId}>
                <td>
                  <span className="roll-name">{member.user.name}</span>
                  <div className="tiny muted">{member.user.email}</div>
                </td>
                <td>
                  <span className="tag">{member.role.toLowerCase().replace('_', ' ')}</span>
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pending.length > 0 && (
        <>
          <hr />
          <h3>Waiting to accept</h3>
          <table className="roll">
            <tbody>
              {pending.map((invitation) => (
                <tr key={invitation.id}>
                  <td>
                    <span className="roll-name">{invitation.name}</span>
                    <div className="tiny muted">{invitation.email}</div>
                  </td>
                  <td>
                    <span className="tag">
                      {invitation.role.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="num">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api
                            .del(`${base}/invitations/${invitation.id}`)
                            .catch(() => {});
                          void load();
                        }}
                      >
                        Withdraw
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {canEdit && (
        <>
          <hr />
          <InviteForm
            base={base}
            onInvited={(url) => {
              setInviteUrl(url);
              void load();
            }}
          />

          {inviteUrl && (
            <div className="alert ok" role="status">
              <p>Invitation sent. If it does not arrive, send them this link:</p>
              {/*
                Shown because studio email lands in spam constantly, and
                without a copyable link that is a support request nobody can
                resolve. It is safe to show: whoever is reading this screen
                already administers the studio.
              */}
              <input
                type="text"
                readOnly
                value={inviteUrl}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              />
            </div>
          )}
        </>
      )}

      {!canEdit && (
        <p className="sub">Only an owner or admin can invite people.</p>
      )}
    </section>
  );
}

function InviteForm({
  base,
  onInvited,
}: {
  base: string;
  onInvited: (inviteUrl: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('INSTRUCTOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await api.post<{ inviteUrl: string }>(`${base}/invitations`, {
        name: name.trim(),
        email: email.trim(),
        role,
      });
      setName('');
      setEmail('');
      onInvited(res.inviteUrl);
    } catch (err) {
      // The server knows why it refused — already a member, already invited —
      // and paraphrasing here would mean two places to keep in agreement.
      setError(err instanceof Error ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  const chosen = ROLES.find((r) => r.value === role);

  return (
    <form onSubmit={submit}>
      <h3>Invite somebody</h3>

      <div className="row">
        <div>
          <label htmlFor="inviteName">Name</label>
          <input
            id="inviteName"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="inviteEmail">Email</label>
          <input
            id="inviteEmail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <label htmlFor="inviteRole">Role</label>
      <select
        id="inviteRole"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      >
        {ROLES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {/*
        The consequence, not just the name. "Front desk" tells somebody nothing
        about what they are handing over, and picking a role is the one moment
        they are thinking about it.
      */}
      <p className="tiny muted">{chosen?.help}</p>

      {/*
        Owner is absent on purpose and it is worth saying why on the screen —
        otherwise its absence reads as an oversight and somebody files a bug.
      */}
      <p className="tiny muted">
        To make somebody an owner, invite them first and change their role once
        they have accepted.
      </p>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      <div className="page-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </form>
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

      /*
        `accent` is only set for a CUSTOM colour — a studio on a preset has
        null, and the field used to keep its hardcoded clay default. So a
        studio on Indigo opened this screen and saw terracotta sitting in a box
        labelled "or use your own", one click from silently restyling
        themselves to a colour they had never chosen.

        With no custom accent, seed it from the active preset's own swatch: the
        field then opens on the colour the studio is actually wearing, which is
        the only sensible starting point for changing it.
      */
      setCustom(
        res.accent ??
          res.presets.find((p) => p.id === res.preset)?.swatch ??
          '#a6522c',
      );
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

  /* Business identity, added 2026-09-07. All nullable — a studio that has
     never opened this screen has none of them. */
  legalName: string | null;
  address: string | null;
  website: string | null;
  businessType: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
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
/**
 * What a studio calls itself.
 *
 * A shortlist, not an enum — nothing branches on this value, it is printed.
 * A studio whose stored value is not on the list keeps it (see the select),
 * so the list can grow without rewriting anybody's record.
 */
const BUSINESS_TYPES = [
  'Pottery studio',
  'Ceramics school',
  'Art studio',
  'Makerspace',
  'Community centre',
  'Tour & activity operator',
  'Other',
];

function StudioSection() {
  const { org, error, setError, base, reload } = useOrganization();
  const { role } = useActiveOrg() ?? {};
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [form, setForm] = useState({
    name: '',
    legalName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    website: '',
    businessType: '',
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!org) return;
    setForm({
      name: org.name,
      legalName: org.legalName ?? '',
      contactEmail: org.contactEmail ?? '',
      contactPhone: org.contactPhone ?? '',
      address: org.address ?? '',
      website: org.website ?? '',
      businessType: org.businessType ?? '',
    });
  }, [org]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      /*
        One request. Contact details also live behind PATCH /page, and an
        earlier draft of this form saved them separately — which meant a
        failure on the second call left the studio looking at an error with
        half their edit already applied.
      */
      await api.patch(base, {
        name: form.name.trim(),
        legalName: form.legalName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
        address: form.address.trim(),
        website: form.website.trim(),
        businessType: form.businessType.trim(),
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
      <h2>Business information</h2>
      <p className="sub">
        Shown on confirmations, receipts and your booking site.
      </p>

      {/*
        Timezone and currency have MOVED, to Localisation and Currency. They
        were here because this was the only settings screen; they are not
        business identity, and a studio changing its trading name should not
        have the control that moves every class time sitting beside it.
      */}
      <form onSubmit={(e) => void save(e)}>
        <div className="form-row">
          <div className="setting setting-stack">
            <label htmlFor="biName">Business name</label>
            <input
              id="biName"
              value={form.name}
              disabled={!canEdit}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="setting setting-stack">
            <label htmlFor="biLegal">Legal name</label>
            <input
              id="biLegal"
              value={form.legalName}
              disabled={!canEdit}
              maxLength={200}
              placeholder={form.name || 'Optional'}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="setting setting-stack">
            <label htmlFor="biEmail">Email</label>
            <input
              id="biEmail"
              type="email"
              value={form.contactEmail}
              disabled={!canEdit}
              maxLength={254}
              onChange={(e) =>
                setForm({ ...form, contactEmail: e.target.value })
              }
            />
          </div>

          <div className="setting setting-stack">
            <label htmlFor="biPhone">Phone</label>
            <input
              id="biPhone"
              value={form.contactPhone}
              disabled={!canEdit}
              maxLength={40}
              onChange={(e) =>
                setForm({ ...form, contactPhone: e.target.value })
              }
            />
          </div>
        </div>

        <div className="setting setting-stack">
          <label htmlFor="biAddress">Address</label>
          <input
            id="biAddress"
            value={form.address}
            disabled={!canEdit}
            maxLength={500}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="setting setting-stack">
            <label htmlFor="biWebsite">Website</label>
            <input
              id="biWebsite"
              value={form.website}
              disabled={!canEdit}
              maxLength={300}
              placeholder="https://"
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </div>

          <div className="setting setting-stack">
            <label htmlFor="biType">Business type</label>
            <select
              id="biType"
              value={form.businessType}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({ ...form, businessType: e.target.value })
              }
            >
              <option value="">Choose…</option>
              {/* A stored value outside the list is kept and shown, the same
                  way the timezone picker used to — a studio set up by hand
                  must not be silently reassigned by opening this page. */}
              {form.businessType &&
                !BUSINESS_TYPES.includes(form.businessType) && (
                  <option value={form.businessType}>{form.businessType}</option>
                )}
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canEdit && (
          <div className="toolbar">
            <button className="primary" disabled={busy}>
              Save changes
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
