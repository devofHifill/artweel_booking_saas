/**
 * URL-safe slugs, scoped per organization.
 *
 * Service slugs appear in the public booking URL, so they must be stable and
 * readable. Uniqueness is per studio, never global — two studios both offering
 * "Beginner Wheel Throwing" is the normal case, not a collision.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Finds a free slug by suffixing, given a predicate that reports whether a
 * candidate is already taken within the tenant.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  fallback = 'item',
): Promise<string> {
  const root = slugify(base) || fallback;

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  return `${root}-${Date.now().toString(36)}`;
}
