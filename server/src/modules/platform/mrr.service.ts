import { prisma } from '../../lib/prisma';
import { PLANS } from '../billing/plan';

/**
 * MRR over time, and the movements that produced it.
 *
 * WHY THIS IS RECORDED RATHER THAN COMPUTED. The headline MRR on the dashboard
 * is derived live — plan prices times the studios that are ACTIVE right now —
 * and that derivation only ever answers for today. `organizations.plan` holds a
 * single current value with no transition log behind it, so there is nothing to
 * ask about last month.
 *
 * The Stripe webhook table is not the missing log either: platform `setPlan`
 * and comping deliberately never touch Stripe, so a webhook-derived series
 * would omit every admin-driven change and disagree with the figure printed
 * above the chart. Snapshotting from the same source as the headline is what
 * keeps the two consistent.
 */

const DAY_MS = 86_400_000;

/**
 * MRR as it stands right now, and who is paying it.
 *
 * Shared rather than re-derived per screen. The plan distribution, the revenue
 * model panel and the daily snapshot all have to agree, and three copies of
 * "price times ACTIVE studios" is three chances for one of them to quietly
 * drift after a pricing or status change.
 */
export async function currentMrr() {
  const activeByPlan = await prisma.organization.groupBy({
    by: ['plan'],
    where: { subscriptionStatus: 'ACTIVE' },
    _count: { _all: true },
  });

  return {
    byPlan: activeByPlan.map((row) => ({
      plan: row.plan,
      studios: row._count._all,
      mrrCents: PLANS[row.plan].priceCentsMonthly * row._count._all,
    })),
    mrrCents: activeByPlan.reduce(
      (total, row) => total + PLANS[row.plan].priceCentsMonthly * row._count._all,
      0,
    ),
    payingStudios: activeByPlan.reduce((n, row) => n + row._count._all, 0),
  };
}

/** Midnight UTC for the day `at` falls in — the shape the DATE column stores. */
function utcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

/**
 * Writes today's row for every ACTIVE studio.
 *
 * Idempotent by construction: the day's rows are replaced wholesale rather than
 * upserted one by one, so a studio that stopped being ACTIVE since the last run
 * today loses its row instead of lingering. That matters because absence is the
 * signal this whole table is built on — a stale row would read as "still
 * paying" tomorrow and swallow a churn event.
 *
 * Runs hourly rather than at a fixed midnight: a daily cron has exactly one
 * chance to fire and a restart at the wrong minute silently loses a day. Every
 * run in the same day writes the same fact.
 */
export async function takeMrrSnapshot(now = new Date()) {
  const date = utcDay(now);

  const active = await prisma.organization.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    select: { id: true, plan: true },
  });

  const rows = active.map((org) => ({
    date,
    organizationId: org.id,
    plan: org.plan,
    /* Resolved here and never recomputed. A later price change must move
       future rows only — recomputing would rewrite every month on the chart. */
    mrrCents: PLANS[org.plan].priceCentsMonthly,
  }));

  await prisma.$transaction([
    prisma.mrrDailyStudio.deleteMany({ where: { date } }),
    ...(rows.length > 0
      ? [prisma.mrrDailyStudio.createMany({ data: rows })]
      : []),
  ]);

  return {
    date,
    studios: rows.length,
    mrrCents: rows.reduce((total, row) => total + row.mrrCents, 0),
  };
}

export type MrrPoint = {
  /** The UTC day, as YYYY-MM-DD. */
  date: string;
  mrrCents: number;
  activeStudios: number;
  /** A studio that had no row the previous day and has one now. */
  newCents: number;
  /** Same studio, larger plan. */
  expansionCents: number;
  /** Same studio, smaller plan. Negative. */
  contractionCents: number;
  /** A studio that had a row the previous day and has none now. Negative. */
  churnedCents: number;
};

/**
 * The series, with each day's movement against the day before it.
 *
 * A KNOWN LIMITATION, stated because the chart cannot state it for itself: a
 * day on which no snapshot ran and a day on which no studio was ACTIVE are
 * indistinguishable here — both are simply absent. Days with no rows are
 * therefore omitted from the series rather than plotted as zero, so a stopped
 * worker leaves a gap instead of drawing a cliff to the floor. Whether the
 * worker is running is a question for the health panel, which answers it
 * directly.
 */
export async function getMrrHistory(days = 365) {
  const start = utcDay(new Date(Date.now() - days * DAY_MS));

  /*
    The last recorded day BEFORE the window, used only as the baseline for the
    first point's movement. Without it the window's first day would diff
    against nothing and report every existing studio as new — a fake spike
    at the left edge that moves every time the range changes.
  */
  const baseline = await prisma.mrrDailyStudio.findFirst({
    where: { date: { lt: start } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  const rows = await prisma.mrrDailyStudio.findMany({
    where: { date: { gte: baseline?.date ?? start } },
    orderBy: { date: 'asc' },
    select: { date: true, organizationId: true, mrrCents: true },
  });

  /* Grouped in memory: one row per active studio per day is small enough that
     a hundred studios over a year is a few tens of thousands of rows. */
  const byDay = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    let day = byDay.get(key);
    if (!day) {
      day = new Map();
      byDay.set(key, day);
    }
    day.set(row.organizationId, row.mrrCents);
  }

  const startKey = start.toISOString().slice(0, 10);
  const points: MrrPoint[] = [];
  let previous: Map<string, number> | null = null;

  for (const [key, day] of [...byDay.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (key >= startKey) {
      let newCents = 0;
      let expansionCents = 0;
      let contractionCents = 0;
      let churnedCents = 0;

      for (const [orgId, cents] of day) {
        const before = previous?.get(orgId);
        if (before === undefined) {
          newCents += cents;
        } else if (cents > before) {
          expansionCents += cents - before;
        } else if (cents < before) {
          contractionCents -= before - cents;
        }
      }

      if (previous) {
        for (const [orgId, cents] of previous) {
          if (!day.has(orgId)) churnedCents -= cents;
        }
      }

      points.push({
        date: key,
        mrrCents: [...day.values()].reduce((a, b) => a + b, 0),
        activeStudios: day.size,
        newCents,
        expansionCents,
        contractionCents,
        churnedCents,
      });
    }

    previous = day;
  }

  return {
    days,
    points,
    /* So the screen can say "collecting" rather than draw an empty box and
       leave the operator wondering whether it is broken. */
    hasHistory: points.length > 0,
    firstDate: points[0]?.date ?? null,
    lastDate: points[points.length - 1]?.date ?? null,
  };
}
