import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Guides for platform admins.
 *
 * Served from here rather than bundled with the dashboard like the studio
 * guides, because the client bundle is public: a lazily loaded chunk is still a
 * file anyone can fetch, and these name server paths, environment variables and
 * the platform's support tooling. Behind the platform gate they reach only the
 * people they are written for, and a studio owner's browser never learns they
 * exist.
 *
 * `server/guides/` sits beside `src/` and `dist/` alike, so the same relative
 * path works in development and in the image (the Dockerfile copies it).
 */
const GUIDES_DIR = path.join(__dirname, '..', '..', '..', 'guides');

export type PlatformGuide = {
  slug: string;
  title: string;
  summary: string;
  file: string;
};

export const PLATFORM_GUIDES: PlatformGuide[] = [
  {
    slug: 'stripe',
    title: 'Stripe: platform setup',
    summary:
      'Connect, API key, webhooks, customer portal and server configuration, going live, and helping a studio whose Stripe is stuck.',
    file: 'stripe-platform.md',
  },
];

export function listPlatformGuides() {
  return PLATFORM_GUIDES.map(({ slug, title, summary }) => ({ slug, title, summary }));
}

/** The guide with its Markdown, or null for a slug that is not one. */
export async function getPlatformGuide(slug: string) {
  const guide = PLATFORM_GUIDES.find((g) => g.slug === slug);
  if (!guide) return null;

  const markdown = await readFile(path.join(GUIDES_DIR, guide.file), 'utf8');
  return { slug: guide.slug, title: guide.title, summary: guide.summary, markdown };
}
