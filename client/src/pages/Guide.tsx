import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Marked } from 'marked';
import { api } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonCard } from '../components/states';
import { findGuide, guidesFor } from '../guides';

/**
 * One user guide, rendered from the Markdown that ships with the dashboard.
 *
 * The HTML is set directly, which is safe only because the input is ours: the
 * guides are files in this repository, bundled at build time, never anything a
 * user typed. Should a guide ever come from somewhere else, this needs a
 * sanitiser before it needs anything else.
 */

/** GitHub's heading ids, so the guides' own "Contents" links keep working. */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${headingId(text)}">${html}</h${depth}>\n`;
    },
  },
});

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
    // The title is the page head's; the Markdown's own first heading would repeat it.
    let text = source.replace(/^# .*\n+/, '');
    if (bookingUrl) {
      const origin = new URL(bookingUrl).origin;
      text = text.replaceAll('https://bookaihub.com', origin);
    }
    if (org?.organization.slug) {
      text = text
        .replaceAll('<your-studio-slug>', org.organization.slug)
        .replaceAll('your-studio-slug', org.organization.slug);
    }
    return markdown.parse(text) as string;
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
