import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonCard } from '../components/states';
import { findGuide, guidesFor } from '../guides';
import { renderGuide } from '../lib/markdown';

/**
 * One user guide, rendered from the Markdown that ships with the dashboard.
 * See `lib/markdown` for why setting its HTML directly is safe.
 */

export default function GuidePage() {
  const { slug } = useParams();
  const org = useActiveOrg();
  const base = useOrgBase();
  const guide = findGuide(slug);
  const allowed = guide && guidesFor(org?.role).includes(guide);

  /* The studio's real booking address in place of the guides' placeholder —
     the domain differs between live and staging, so it is read, not assumed. */
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ bookingUrl: string }>(`${base}/onboarding`)
      .then((res) => setBookingUrl(res.bookingUrl))
      .catch(() => {
        /* The placeholder stays; the guide still reads fine. */
      });
  }, [base]);

  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!guide) return;
    guide.load().then(setSource, () => setFailed(true));
  }, [guide]);

  const html = useMemo(() => {
    if (!source) return '';
    let text = source;
    if (bookingUrl) {
      const origin = new URL(bookingUrl).origin;
      text = text.replaceAll('https://bookaihub.com', origin);
    }
    if (org?.organization.slug) {
      text = text
        .replaceAll('<your-studio-slug>', org.organization.slug)
        .replaceAll('your-studio-slug', org.organization.slug);
    }
    return renderGuide(text);
  }, [source, bookingUrl, org?.organization.slug]);

  if (!guide || !allowed) {
    return (
      <>
        <PageHead title="Guide not found" />
        <EmptyState hint="See the guides on Help & Support.">
          <Link to="/help">Back to Help &amp; Support</Link>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={guide.title}
        lede={guide.summary}
        actions={
          <Link className="button-link" to="/help">
            All guides
          </Link>
        }
      />
      {failed ? (
        <div className="err">This guide could not be loaded. Try again in a moment.</div>
      ) : !source ? (
        <LoadingRegion label="Loading the guide">
          <SkeletonCard />
        </LoadingRegion>
      ) : (
        <article className="card guide" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </>
  );
}
