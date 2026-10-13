import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { renderGuide } from '../lib/markdown';
import { PageHead } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonCard } from '../components/states';

/**
 * Help & Support for platform admins.
 *
 * The guides come from the API, not from the dashboard bundle like the studio
 * guides: they describe the server and the platform's support tooling, and
 * anything in the bundle can be fetched by anyone. Behind `/api/platform` only
 * a live grant can read them.
 */

type GuideSummary = { slug: string; title: string; summary: string };
type Guide = GuideSummary & { markdown: string };

export function PlatformHelp() {
  const [guides, setGuides] = useState<GuideSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<{ guides: GuideSummary[] }>('/api/platform/guides')
      .then((res) => setGuides(res.guides))
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <PageHead
        title="Help &amp; Support"
        lede="Guides for running the platform. Studios have their own, on their Help & Support page."
      />

      {failed ? (
        <div className="err">The guides could not be loaded. Try again in a moment.</div>
      ) : !guides ? (
        <LoadingRegion label="Loading the guides">
          <SkeletonCard />
        </LoadingRegion>
      ) : (
        <section className="card settings-section">
          <h2>Guides</h2>
          <ul className="guide-list">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link to={`/admin/help/guides/${g.slug}`}>
                  <strong>{g.title}</strong>
                  <span className="tiny muted">{g.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function PlatformGuide() {
  const { slug } = useParams();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');

  useEffect(() => {
    setGuide(null);
    setState('loading');
    api
      .get<{ guide: Guide }>(`/api/platform/guides/${encodeURIComponent(slug ?? '')}`)
      .then((res) => {
        setGuide(res.guide);
        setState('ready');
      })
      .catch((err: unknown) =>
        setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'failed'),
      );
  }, [slug]);

  const html = useMemo(() => (guide ? renderGuide(guide.markdown) : ''), [guide]);

  if (state === 'missing') {
    return (
      <>
        <PageHead title="Guide not found" />
        <EmptyState hint="See the guides on Help & Support.">
          <Link to="/admin/help">Back to Help &amp; Support</Link>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={guide?.title ?? 'Guide'}
        lede={guide?.summary}
        actions={
          <Link className="button-link" to="/admin/help">
            All guides
          </Link>
        }
      />
      {state === 'failed' ? (
        <div className="err">This guide could not be loaded. Try again in a moment.</div>
      ) : state === 'loading' ? (
        <LoadingRegion label="Loading the guide">
          <SkeletonCard />
        </LoadingRegion>
      ) : (
        <article className="card guide" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </>
  );
}
