import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { LoadingRegion, SkeletonCard } from '../components/states';
import { PageHead } from '../components/layout';

/**
 * Website & Widget.
 *
 * Everything a studio owner needs to make the public booking page look like
 * their studio and get it onto their own site. Four sections behind a
 * sub-navigation, deliberately the same shape as Settings so the muscle
 * memory transfers.
 *
 *   Page content   what the owner writes and the customer reads
 *   SEO            what the search engine reads
 *   Branding       reuses Settings → Appearance rather than duplicating it,
 *                  because two colour pickers pointing at one column drift
 *   Widget         the two lines the studio pastes into their own site
 *
 * The page reads and writes ONE endpoint — `GET/PATCH /page` — so a save
 * repaints from the response rather than reloading, and Preview always
 * points at what has actually been saved.
 */

type PageContent = {
  tagline: string | null;
  about: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

type WebsiteResponse = {
  page: PageContent;
  embed: { snippet: string; scriptUrl: string; bookingUrl: string };
};

const SECTIONS = [
  { id: 'page', label: 'Page content' },
  { id: 'seo', label: 'SEO' },
  { id: 'branding', label: 'Branding' },
  { id: 'widget', label: 'Widget' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * The five (well, six) bounds the server enforces. Restated on the client so
 * a character counter is available before the request goes out, but the
 * server is what asserts them — this is a helpful nudge, not a security
 * check.
 */
const LIMITS = {
  tagline: 160,
  about: 2000,
  contactEmail: 254,
  contactPhone: 40,
  seoTitle: 70,
  seoDescription: 200,
} as const;

export default function Website() {
  const base = useOrgBase();
  const org = useActiveOrg();
  const [section, setSection] = useState<SectionId>('page');
  const [data, setData] = useState<WebsiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = org?.role === 'OWNER' || org?.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const res = await api.get<WebsiteResponse>(`${base}/page`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your website.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="Website &amp; widget"
        lede="What your customers see, and the two lines you paste into your own site."
      />

      <div className="settings-wrap">
        <nav className="settings-nav" aria-label="Website sections">
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
          {!data && !error && (
            <LoadingRegion label="Loading your website">
              <SkeletonCard lines={4} />
            </LoadingRegion>
          )}

          {error && (
            <div className="alert danger" role="alert">
              {error}
            </div>
          )}

          {data && section === 'page' && (
            <PageContentSection
              data={data}
              canEdit={canEdit}
              onSaved={(res) => setData(res)}
            />
          )}
          {data && section === 'seo' && (
            <SeoSection
              data={data}
              canEdit={canEdit}
              onSaved={(res) => setData(res)}
            />
          )}
          {data && section === 'branding' && <BrandingSection />}
          {data && section === 'widget' && <WidgetSection embed={data.embed} />}
        </div>
      </div>
    </>
  );
}

// --- Page content ---------------------------------------------------------

function PageContentSection({
  data,
  canEdit,
  onSaved,
}: {
  data: WebsiteResponse;
  canEdit: boolean;
  onSaved: (data: WebsiteResponse) => void;
}) {
  const base = useOrgBase();
  const [tagline, setTagline] = useState(data.page.tagline ?? '');
  const [about, setAbout] = useState(data.page.about ?? '');
  const [contactEmail, setContactEmail] = useState(data.page.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(data.page.contactPhone ?? '');

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Whether anything actually changed. Comparing against `data.page` rather
    than initial state means the button re-arms after a save without leaving
    a "Save" flashing at somebody who hasn't touched anything.
  */
  const dirty = useMemo(
    () =>
      (tagline || null) !== data.page.tagline ||
      (about || null) !== data.page.about ||
      (contactEmail || null) !== data.page.contactEmail ||
      (contactPhone || null) !== data.page.contactPhone,
    [
      tagline,
      about,
      contactEmail,
      contactPhone,
      data.page.tagline,
      data.page.about,
      data.page.contactEmail,
      data.page.contactPhone,
    ],
  );

  async function save() {
    if (!canEdit || !dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.patch<WebsiteResponse>(`${base}/page`, {
        tagline,
        about,
        contactEmail,
        contactPhone,
      });
      onSaved(res);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Page content</h2>
      <p className="sub">
        What your customers see when they land on your booking page. Empty
        fields fall back to a generic prompt — an untouched studio still gets a
        working page.
      </p>

      <div className="setting setting-stack">
        <label htmlFor="tagline">Tagline</label>
        <input
          id="tagline"
          type="text"
          value={tagline}
          maxLength={LIMITS.tagline}
          disabled={!canEdit || busy}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Choose a class and reserve your place"
        />
        <p className="sub tiny">One line under your studio name. {LIMITS.tagline - tagline.length} characters left.</p>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="about">About</label>
        <textarea
          id="about"
          rows={6}
          value={about}
          maxLength={LIMITS.about}
          disabled={!canEdit || busy}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="A paragraph or two about your studio, your teachers, or what makes a first visit worth it."
        />
        <p className="sub tiny">
          Plain text. Blank lines split paragraphs. {LIMITS.about - about.length} characters left.
        </p>
      </div>

      <hr />

      <div className="setting setting-stack">
        <label htmlFor="contactEmail">Contact email</label>
        <input
          id="contactEmail"
          type="email"
          value={contactEmail}
          maxLength={LIMITS.contactEmail}
          disabled={!canEdit || busy}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="hello@yourstudio.com"
        />
      </div>

      <div className="setting setting-stack">
        <label htmlFor="contactPhone">Contact phone</label>
        <input
          id="contactPhone"
          type="tel"
          value={contactPhone}
          maxLength={LIMITS.contactPhone}
          disabled={!canEdit || busy}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="(555) 123 4567"
        />
        <p className="sub tiny">
          Both are shown in the page footer, and again if you switch off online
          booking. Either or both are fine.
        </p>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div className="alert ok" role="status">
          Saved.{' '}
          <a
            href={data.embed.bookingUrl}
            target="_blank"
            rel="noreferrer"
          >
            View your page →
          </a>
        </div>
      )}

      <div className="page-actions">
        <button
          type="button"
          className="primary"
          disabled={!canEdit || busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {!canEdit && (
        <p className="sub">
          Only an owner or admin can edit your website copy.
        </p>
      )}
    </section>
  );
}

// --- SEO -----------------------------------------------------------------

function SeoSection({
  data,
  canEdit,
  onSaved,
}: {
  data: WebsiteResponse;
  canEdit: boolean;
  onSaved: (data: WebsiteResponse) => void;
}) {
  const base = useOrgBase();
  const org = useActiveOrg();

  const [seoTitle, setSeoTitle] = useState(data.page.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(
    data.page.seoDescription ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    (seoTitle || null) !== data.page.seoTitle ||
    (seoDescription || null) !== data.page.seoDescription;

  const titlePreview =
    seoTitle.trim() || `Book a class at ${org?.organization.name ?? 'your studio'}`;
  const descriptionPreview =
    seoDescription.trim() ||
    `Book online at ${org?.organization.name ?? 'your studio'}.`;

  async function save() {
    if (!canEdit || !dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.patch<WebsiteResponse>(`${base}/page`, {
        seoTitle,
        seoDescription,
      });
      onSaved(res);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Search &amp; social</h2>
      <p className="sub">
        What a search result — and a link shared on Instagram — says about your
        studio. Left blank, we use your studio name and your class list.
      </p>

      <div className="setting setting-stack">
        <label htmlFor="seoTitle">Page title</label>
        <input
          id="seoTitle"
          type="text"
          value={seoTitle}
          maxLength={LIMITS.seoTitle}
          disabled={!canEdit || busy}
          onChange={(e) => setSeoTitle(e.target.value)}
          placeholder={`Book a class at ${org?.organization.name ?? 'your studio'}`}
        />
        <p className="sub tiny">
          Google shows about 60 characters. {LIMITS.seoTitle - seoTitle.length} left.
        </p>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="seoDescription">Meta description</label>
        <textarea
          id="seoDescription"
          rows={3}
          value={seoDescription}
          maxLength={LIMITS.seoDescription}
          disabled={!canEdit || busy}
          onChange={(e) => setSeoDescription(e.target.value)}
          placeholder="A sentence about what you teach and who it's for."
        />
        <p className="sub tiny">
          About 160 characters land on the search result.{' '}
          {LIMITS.seoDescription - seoDescription.length} left.
        </p>
      </div>

      {/*
        The preview is the point of this section. A studio owner writing a
        title has no way to picture the result without seeing it — and seeing
        it after publishing means finding out on their live listing.
      */}
      <div className="seo-preview" aria-label="Search result preview">
        <p className="preview-label">Preview</p>
        <div className="seo-card">
          <p className="seo-url">{data.embed.bookingUrl}</p>
          <p className="seo-title">{titlePreview}</p>
          <p className="seo-desc">{descriptionPreview}</p>
        </div>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div className="alert ok" role="status">
          Saved.
        </div>
      )}

      <div className="page-actions">
        <button
          type="button"
          className="primary"
          disabled={!canEdit || busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}

// --- Branding ------------------------------------------------------------

/**
 * Branding lives on Settings → Appearance and is intentionally NOT duplicated
 * here — two swatch pickers pointing at one column is the shape of thing that
 * quietly drifts.
 */
function BrandingSection() {
  const org = useActiveOrg();

  return (
    <section className="card settings-section">
      <h2>Branding</h2>
      <p className="sub">
        Your studio colour is applied to both your dashboard and your booking
        page, so both look like you. It lives on Settings so it is next to the
        Light/Dark toggle that decides what {org?.organization.name ?? 'you'}{' '}
        see.
      </p>

      <div className="page-actions">
        <a className="button-link primary" href="/settings">
          Edit in Settings → Appearance
        </a>
      </div>
    </section>
  );
}

// --- Widget -------------------------------------------------------------

function WidgetSection({ embed }: { embed: WebsiteResponse['embed'] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(embed.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard may be refused (permissions, http). The textarea is
         selectable so the fallback is a manual copy — nothing to say. */
    }
  }

  return (
    <section className="card settings-section">
      <h2>Widget</h2>
      <p className="sub">
        Paste these two lines onto your own site, wherever you want the booking
        page to appear. It sizes itself to the content and updates whenever you
        save something here.
      </p>

      <div className="setting setting-stack">
        <label htmlFor="snippet">Embed snippet</label>
        <textarea
          id="snippet"
          rows={3}
          readOnly
          spellCheck={false}
          value={embed.snippet}
          onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
        />
        <div className="page-actions">
          <button type="button" className="primary" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy snippet'}
          </button>
          <a
            className="button-link"
            href={embed.bookingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open the booking page
          </a>
        </div>
      </div>

      <hr />

      <div className="setting setting-stack">
        <h3>How it looks</h3>
        <p className="sub">
          A live preview of what your customers see. Bookings placed here count
          as <strong>Embed widget</strong> on the dashboard donut.
        </p>
        <div className="widget-preview">
          <iframe
            src={`${embed.bookingUrl}?embed=1`}
            title="Booking page preview"
            loading="lazy"
            style={{
              width: '100%',
              minHeight: 640,
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
            }}
          />
        </div>
      </div>
    </section>
  );
}

