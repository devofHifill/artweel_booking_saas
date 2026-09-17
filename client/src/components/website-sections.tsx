import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DataTable, Modal, StatusPill } from './layout';
import { EmptyState, LoadingRegion, SkeletonCard } from './states';
import { Icon } from './Icon';

/**
 * The Website screen's newer sections: Overview, Pages, Navigation, Preview.
 *
 * WHAT IS DELIBERATELY MISSING, so nobody adds it back from the mockup:
 *
 * There are no page-view counts, no conversion rate, no custom-domain or SSL
 * rows, and no "Published" status for the site as a whole. Nothing in this
 * product counts a visit, there is no custom-domain support, and site content
 * saves live rather than being staged. Every one of those tiles would have to
 * be invented, and a dashboard that reports 30,846 page views when nothing
 * counts views is worse than an absent tile — it is a number somebody will
 * make a decision on.
 *
 * Everything below is derived from something the product actually knows.
 */

export type SitePage = {
  id: string;
  path: string;
  title: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  showInNav: boolean;
  navOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

type PageContent = {
  tagline: string | null;
  about: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

// --- Overview ---------------------------------------------------------------

export function OverviewSection({
  base,
  data,
  onGo,
}: {
  base: string;
  data: { page: PageContent; embed: { bookingUrl: string } };
  onGo: (section: string) => void;
}) {
  const [pages, setPages] = useState<SitePage[] | null>(null);

  useEffect(() => {
    /* Best effort. The preview is the point of this screen, so a failure here
       dims one checklist row rather than replacing the page with an error. */
    api
      .get<{ pages: SitePage[] }>(`${base}/site/pages`)
      .then((res) => setPages(res.pages))
      .catch(() => setPages([]));
  }, [base]);

  return (
    <>
      <section className="card">
        <h2>Your booking site</h2>
        <p className="sub">
          This is what a customer sees. It is live now — there is nothing to
          publish.
        </p>

        <SitePreviewFrame url={data.embed.bookingUrl} height={360} />

        <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
          <a
            className="button-link primary"
            href={data.embed.bookingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open the live site
          </a>
          <span className="tiny muted">
            Opens in a new tab — book something and watch it appear in your
            dashboard.
          </span>
        </div>
      </section>

      <Checklist page={data.page} pages={pages} onGo={onGo} />
    </>
  );
}

/**
 * What is left to do, built only from things that can actually be checked.
 *
 * No custom domain, SSL or analytics rows: none of those exist as features, so
 * a tick or a clock beside them would be a claim about nothing.
 */
function Checklist({
  page,
  pages,
  onGo,
}: {
  page: PageContent;
  pages: SitePage[] | null;
  onGo: (section: string) => void;
}) {
  const items = [
    {
      done: Boolean(page.tagline?.trim()),
      label: 'Tagline written',
      go: 'page',
    },
    {
      done: Boolean(page.about?.trim()),
      label: 'About your studio written',
      go: 'page',
    },
    {
      done: Boolean(page.seoTitle?.trim() && page.seoDescription?.trim()),
      label: 'Search engine title and description set',
      go: 'seo',
    },
    {
      done: (pages ?? []).some((p) => p.status === 'PUBLISHED'),
      label: 'At least one page published',
      go: 'pages',
    },
  ];

  return (
    <section className="card">
      <h2>Checklist</h2>
      <ul className="site-checklist">
        {items.map((item) => (
          <li key={item.label} className={item.done ? 'done' : ''}>
            <span className="check-mark" aria-hidden="true">
              {item.done ? '✓' : '○'}
            </span>
            <button type="button" className="link" onClick={() => onGo(item.go)}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="tiny muted">
        Payments, calendars and text messaging are checked on the Integrations
        screen, which is where they are connected.
      </p>
    </section>
  );
}

// --- Preview ----------------------------------------------------------------

const WIDTHS = [
  { id: 'phone', label: 'Phone', width: 390 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'desktop', label: 'Desktop', width: 0 },
] as const;

export function SitePreviewFrame({
  url,
  height = 520,
}: {
  url: string;
  height?: number;
}) {
  return (
    <div className="site-frame">
      <div className="site-frame-bar">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="site-frame-url">{url.replace(/^https?:\/\//, '')}</span>
      </div>
      {/*
        Sandboxed, and same-origin is NOT granted. The page is the studio's own
        content but it is still a document being framed inside the dashboard;
        allow-scripts alone lets the booking flow run without handing it access
        to the parent's storage or session.
      */}
      <iframe
        src={url}
        title="Your booking site"
        style={{ height }}
        sandbox="allow-scripts allow-forms allow-popups"
        loading="lazy"
      />
    </div>
  );
}

export function PreviewSection({ bookingUrl }: { bookingUrl: string }) {
  const [width, setWidth] = useState<string>('desktop');
  const chosen = WIDTHS.find((w) => w.id === width)!;

  return (
    <section className="card">
      <h2>Preview</h2>
      <p className="sub">
        Your live site, at three widths. Most customers arrive on a phone.
      </p>

      <div className="seg" role="group" aria-label="Preview width">
        {WIDTHS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={width === w.id ? 'on' : ''}
            onClick={() => setWidth(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 'var(--space-4)',
          maxWidth: chosen.width || '100%',
          transition: 'max-width .2s ease',
        }}
      >
        <SitePreviewFrame url={bookingUrl} height={560} />
      </div>
    </section>
  );
}

// --- Pages ------------------------------------------------------------------

const BLANK_PAGE = {
  path: '',
  title: '',
  body: '',
  status: 'DRAFT' as const,
  showInNav: true,
  seoTitle: '',
  seoDescription: '',
};

export function PagesSection({
  base,
  canEdit,
  bookingUrl,
}: {
  base: string;
  canEdit: boolean;
  bookingUrl: string;
}) {
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SitePage | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ pages: SitePage[] }>(`${base}/site/pages`);
      setPages(res.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pages.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePublished(page: SitePage) {
    setBusy(page.id);
    try {
      await api.patch(`${base}/site/pages/${page.id}`, {
        status: page.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(page: SitePage) {
    if (
      !window.confirm(
        `Delete "${page.title}"? Anyone with the link will get a "page not ` +
          'found" from now on. This cannot be undone.',
      )
    ) {
      return;
    }

    setBusy(page.id);
    try {
      await api.del(`${base}/site/pages/${page.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card" style={{ padding: 0 }}>
        <header className="automations-head">
          <h2>Pages</h2>
          {canEdit && (
            <button
              type="button"
              className="primary"
              onClick={() => setEditing('new')}
            >
              <Icon name="plus" /> Add page
            </button>
          )}
        </header>

        {error && <div className="err">{error}</div>}

        {!pages && (
          <LoadingRegion label="Loading pages">
            <SkeletonCard lines={3} />
          </LoadingRegion>
        )}

        {pages && pages.length === 0 && (
          <div style={{ padding: 'var(--space-5)' }}>
            <EmptyState hint="An About or a Contact page is the usual first one.">
              No pages yet. Your booking page is always live on its own.
            </EmptyState>
          </div>
        )}

        {pages && pages.length > 0 && (
          <DataTable
            caption="Your site's pages, their addresses and whether they are live"
            head={
              <tr>
                <th>Page</th>
                <th>Path</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            }
          >
            {pages.map((page) => (
              <tr key={page.id}>
                <td>
                  <b>{page.title}</b>
                  {!page.showInNav && (
                    <div className="tiny muted">Hidden from the menu</div>
                  )}
                </td>
                <td>
                  <code className="path">/p/{page.path}</code>
                </td>
                <td>
                  {page.status === 'PUBLISHED' ? (
                    <StatusPill status="CONFIRMED">Published</StatusPill>
                  ) : (
                    <StatusPill status="DRAFT">Draft</StatusPill>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    {/*
                      A draft has no public URL — it 404s — so previewing one
                      would open a "page not found" and look like a bug. The
                      button is only offered once there is something to see.
                    */}
                    {page.status === 'PUBLISHED' ? (
                      <a
                        className="icon-btn"
                        href={`${bookingUrl}/p/${page.path}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View this page"
                        aria-label={`View ${page.title}`}
                      >
                        <Icon name="eye" size={14} />
                      </a>
                    ) : (
                      <span
                        className="icon-btn is-disabled"
                        title="Publish it first — a draft has no public address"
                        aria-hidden="true"
                      >
                        <Icon name="eye" size={14} />
                      </span>
                    )}
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          title={
                            page.status === 'PUBLISHED'
                              ? 'Unpublish'
                              : 'Publish'
                          }
                          aria-label={`${
                            page.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'
                          } ${page.title}`}
                          disabled={busy === page.id}
                          onClick={() => void togglePublished(page)}
                        >
                          <Icon
                            name={page.status === 'PUBLISHED' ? 'eye-off' : 'site'}
                            size={14}
                          />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Edit"
                          aria-label={`Edit ${page.title}`}
                          onClick={() => setEditing(page)}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Delete"
                          aria-label={`Delete ${page.title}`}
                          disabled={busy === page.id}
                          onClick={() => void remove(page)}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add page' : `Edit ${editing.title}`}
          onClose={() => setEditing(null)}
          size="wide"
        >
          <PageForm
            base={base}
            editing={editing === 'new' ? null : editing}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </>
  );
}

function PageForm({
  base,
  editing,
  onSaved,
  onCancel,
}: {
  base: string;
  editing: SitePage | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(
    editing
      ? {
          path: editing.path,
          title: editing.title,
          body: editing.body,
          status: editing.status,
          showInNav: editing.showInNav,
          seoTitle: editing.seoTitle ?? '',
          seoDescription: editing.seoDescription ?? '',
        }
      : { ...BLANK_PAGE },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The address, suggested from the title while creating.
   *
   * Only while creating, and only until the field is touched: changing the
   * path of a published page breaks every link anyone has to it, so it must
   * never follow a title edit made two months later.
   */
  const [pathTouched, setPathTouched] = useState(Boolean(editing));

  function setTitle(title: string) {
    setForm((f) => ({
      ...f,
      title,
      path: pathTouched
        ? f.path
        : title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = {
      path: form.path,
      title: form.title.trim(),
      body: form.body,
      status: form.status,
      showInNav: form.showInNav,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
    };

    try {
      if (editing) await api.patch(`${base}/site/pages/${editing.id}`, body);
      else await api.post(`${base}/site/pages`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="err">{error}</div>}

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="pfTitle">Title</label>
          <input
            id="pfTitle"
            required
            maxLength={120}
            value={form.title}
            placeholder="About the studio"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="pfPath">Address</label>
          <input
            id="pfPath"
            required
            maxLength={60}
            value={form.path}
            placeholder="about"
            onChange={(e) => {
              setPathTouched(true);
              setForm({ ...form, path: e.target.value });
            }}
          />
          <p className="tiny muted">
            Lives at <code>/p/{form.path || '…'}</code>. Lower-case letters,
            numbers and hyphens.
            {editing && ' Changing it breaks existing links to this page.'}
          </p>
        </div>
      </div>

      <div className="setting setting-stack">
        <label htmlFor="pfBody">Page text</label>
        <textarea
          id="pfBody"
          rows={10}
          maxLength={20000}
          value={form.body}
          placeholder={'Leave a blank line between paragraphs.'}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        {/* Said plainly, because somebody will paste HTML in and needs to know
            why it came out as visible angle brackets rather than formatting. */}
        <p className="tiny muted">
          Plain text. A blank line starts a new paragraph. HTML is shown as
          typed rather than rendered, which keeps your visitors safe.
        </p>
      </div>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="pfSeoTitle">Search engine title</label>
          <input
            id="pfSeoTitle"
            maxLength={70}
            value={form.seoTitle}
            placeholder="Optional"
            onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
          />
        </div>
        <div className="setting setting-stack">
          <label htmlFor="pfSeoDesc">Search engine description</label>
          <input
            id="pfSeoDesc"
            maxLength={200}
            value={form.seoDescription}
            placeholder="Optional"
            onChange={(e) =>
              setForm({ ...form, seoDescription: e.target.value })
            }
          />
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={form.showInNav}
          onChange={(e) => setForm({ ...form, showInNav: e.target.checked })}
        />
        Show in the site menu
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={form.status === 'PUBLISHED'}
          onChange={(e) =>
            setForm({ ...form, status: e.target.checked ? 'PUBLISHED' : 'DRAFT' })
          }
        />
        Published — visible to anyone with the link
      </label>

      <div className="counter-foot">
        <span className="tiny muted">
          {form.status === 'PUBLISHED'
            ? 'Saving puts this live immediately.'
            : 'Drafts are not reachable — the address returns "page not found".'}
        </span>
        <div className="counter-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save page'}
          </button>
        </div>
      </div>
    </form>
  );
}

// --- Navigation -------------------------------------------------------------

export function NavigationSection({
  base,
  canEdit,
}: {
  base: string;
  canEdit: boolean;
}) {
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaTarget, setCtaTarget] = useState('booking');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ pages: SitePage[] }>(`${base}/site/pages`);
      setPages(res.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Moves one item and saves the whole order.
   *
   * The server takes the complete list and rewrites every position in one
   * transaction, rather than accepting "move this one up". Two people
   * reordering at once with relative moves produces an order neither of them
   * chose; sending the whole list means the last save wins, visibly.
   */
  async function move(index: number, delta: number) {
    if (!pages) return;
    const next = [...pages];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;

    [next[index], next[target]] = [next[target]!, next[index]!];
    setPages(next);

    setBusy(true);
    try {
      const res = await api.put<{ pages: SitePage[] }>(
        `${base}/site/navigation/order`,
        { ids: next.map((p) => p.id) },
      );
      setPages(res.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleNav(page: SitePage) {
    setBusy(true);
    try {
      await api.patch(`${base}/site/pages/${page.id}`, {
        showInNav: !page.showInNav,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCta() {
    setBusy(true);
    setSaved(false);
    try {
      await api.put(`${base}/site/navigation/cta`, {
        label: ctaLabel.trim() || null,
        target: ctaTarget,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <header className="automations-head" style={{ padding: 0, border: 0 }}>
        <h2>Navigation</h2>
        <span className="tiny muted">
          The menu across the top of your site
        </span>
      </header>

      {error && <div className="err">{error}</div>}

      {!pages && (
        <LoadingRegion label="Loading navigation">
          <SkeletonCard lines={3} />
        </LoadingRegion>
      )}

      {pages && (
        <ol className="nav-list">
          {/* The booking page is not a row anywhere — it is rendered from your
              services and always exists — so it is shown here fixed, rather
              than being left out and looking like an omission. */}
          <li className="nav-item is-fixed">
            <span className="nav-num">1</span>
            <span className="nav-id">
              <b>Book</b>
              <span className="sub">Your booking page</span>
            </span>
            <span className="tiny muted">Always shown</span>
          </li>

          {pages.map((page, index) => (
            <li key={page.id} className="nav-item">
              <span className="nav-num">{index + 2}</span>
              <span className="nav-id">
                <b>{page.title}</b>
                <span className="sub">/p/{page.path}</span>
                {page.status !== 'PUBLISHED' && (
                  <span className="tiny muted">
                    Draft — not shown until published
                  </span>
                )}
              </span>

              {canEdit && (
                <span className="nav-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Move up"
                    aria-label={`Move ${page.title} up`}
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Move down"
                    aria-label={`Move ${page.title} down`}
                    disabled={busy || index === pages.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={page.showInNav}
                    aria-label={`Show ${page.title} in the menu`}
                    className={`switch${page.showInNav ? ' on' : ''}`}
                    disabled={busy}
                    onClick={() => void toggleNav(page)}
                  >
                    <span className="switch-knob" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <h3 className="form-section">Header call to action</h3>

      <div className="form-row">
        <div className="setting setting-stack">
          <label htmlFor="navCta">Button label</label>
          <input
            id="navCta"
            maxLength={40}
            value={ctaLabel}
            placeholder="Book now"
            disabled={!canEdit}
            onChange={(e) => setCtaLabel(e.target.value)}
          />
        </div>

        <div className="setting setting-stack">
          <label htmlFor="navTarget">Links to</label>
          <select
            id="navTarget"
            value={ctaTarget}
            disabled={!canEdit}
            onChange={(e) => setCtaTarget(e.target.value)}
          >
            <option value="booking">Your booking page</option>
            {(pages ?? [])
              .filter((p) => p.status === 'PUBLISHED')
              .map((p) => (
                <option key={p.id} value={p.path}>
                  {p.title}
                </option>
              ))}
          </select>
          {/* Only published pages are offered: pointing the header button at a
              draft would put a 404 on the one control every visitor sees. */}
          <p className="tiny muted">Published pages only.</p>
        </div>
      </div>

      {canEdit && (
        <div className="toolbar">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void saveCta()}
          >
            {busy ? 'Saving…' : 'Save navigation'}
          </button>
          {saved && (
            <span className="tiny muted" role="status">
              Saved.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
