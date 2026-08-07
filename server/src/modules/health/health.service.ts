import { prisma } from '../../lib/prisma';

export type HealthReport = {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: {
    database: 'ok' | 'error';
    postgis: 'ok' | 'missing' | 'error';
    btreeGist: 'ok' | 'missing' | 'error';
  };
};

/**
 * Health is not just "is the process alive". It asserts that the two
 * extensions the concurrency model depends on are actually installed —
 * a Postgres without btree_gist would silently accept the schema minus its
 * most important constraint, so we check rather than assume.
 */
export async function getHealth(): Promise<HealthReport> {
  const checks: HealthReport['checks'] = {
    database: 'error',
    postgis: 'error',
    btreeGist: 'error',
  };

  try {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'btree_gist')
    `;
    checks.database = 'ok';

    const names = new Set(rows.map((r) => r.extname));
    checks.postgis = names.has('postgis') ? 'ok' : 'missing';
    checks.btreeGist = names.has('btree_gist') ? 'ok' : 'missing';
  } catch {
    // Leave the checks at 'error'.
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  return {
    status: allOk ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  };
}
