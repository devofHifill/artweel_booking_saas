import { prisma } from '../../lib/prisma';

/**
 * Studio growth and booking volume, by month.
 *
 * Most of this is genuinely historical, unlike MRR: a studio's signup and a
 * booking's creation are both dated on the row, so these series can be computed
 * backwards over any range without having needed to snapshot anything.
 *
 * CHURN IS THE EXCEPTION, and the whole reason this file is careful. Nothing
 * records when a studio stopped paying — there is no `canceledAt`, and
 * `suspendedByPlatformAt` means something else (a platform-initiated
 * suspension, not a customer leaving). So churn is derived from the daily MRR
 * snapshot, which only knows about days it has actually recorded.
 *
 * Months before the first snapshot therefore report `null`, not `0`. Zero would
 * be a claim — "nobody churned in March" — about a month nobody measured, and
 * it is the kind of claim that gets repeated in a board deck.
 */

/** `YYYY-MM` for a date, in UTC, matching how the buckets are grouped. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every month key from `months` ago through this one, oldest first. */
function monthRange(months: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    keys.push(
      monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))),
    );
  }
  return keys;
}

type MonthCount = { month: Date; count: bigint };

function tally(rows: MonthCount[]): Map<string, number> {
  return new Map(rows.map((r) => [monthKey(r.month), Number(r.count)]));
}

export type GrowthMonth = {
  month: string;
  newStudios: number;
  /**
   * Signed up AND finished setting up. `onboardingDoneAt` is the only
   * activation moment the schema actually dates — becoming a paying subscriber
   * has no timestamp of its own, the same gap that makes churn unmeasurable
   * before the snapshot.
   */
  activated: number;
  /** null means "not measured that month", never "none". */
  churned: number | null;
};

export type BookingVolumeMonth = { month: string; bookings: number };

export async function getPlatformGrowth(months = 12, now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );

  const [signups, activations, snapshotRows, firstSnapshot] = await Promise.all([
    prisma.$queryRaw<MonthCount[]>`
      SELECT date_trunc('month', created_at) AS month, count(*) AS count
      FROM organizations
      WHERE created_at >= ${start}
      GROUP BY 1
    `,
    prisma.$queryRaw<MonthCount[]>`
      SELECT date_trunc('month', onboarding_done_at) AS month, count(*) AS count
      FROM organizations
      WHERE onboarding_done_at IS NOT NULL AND onboarding_done_at >= ${start}
      GROUP BY 1
    `,
    /* Every recorded (day, studio) pair, to diff adjacent days into departures.
       Small: one row per paying studio per day. */
    prisma.mrrDailyStudio.findMany({
      where: { date: { gte: start } },
      orderBy: { date: 'asc' },
      select: { date: true, organizationId: true },
    }),
    prisma.mrrDailyStudio.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    }),
  ]);

  const newByMonth = tally(signups);
  const activatedByMonth = tally(activations);

  /*
    Churn events, counted by diffing adjacent RECORDED days. A studio that has a
    row one day and none the next has stopped paying.

    Adjacent recorded days, not adjacent calendar days: if the worker missed a
    day the comparison simply spans the gap, which is coarser but still true. A
    missing day is not evidence that everyone churned.
  */
  const byDay = new Map<string, Set<string>>();
  for (const row of snapshotRows) {
    const key = row.date.toISOString().slice(0, 10);
    let day = byDay.get(key);
    if (!day) {
      day = new Set();
      byDay.set(key, day);
    }
    day.add(row.organizationId);
  }

  const churnedByMonth = new Map<string, number>();
  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (let i = 1; i < days.length; i++) {
    const [dayKey, today] = days[i]!;
    const [, yesterday] = days[i - 1]!;

    let gone = 0;
    for (const orgId of yesterday) if (!today.has(orgId)) gone++;

    if (gone > 0) {
      const key = dayKey.slice(0, 7);
      churnedByMonth.set(key, (churnedByMonth.get(key) ?? 0) + gone);
    }
  }

  /* Churn is only claimable for months the snapshot actually covers. The first
     recorded month is excluded too: with no prior day inside it to diff the
     start against, a partial month would understate. */
  const measuredFrom = firstSnapshot
    ? monthKey(
        new Date(
          Date.UTC(
            firstSnapshot.date.getUTCFullYear(),
            firstSnapshot.date.getUTCMonth(),
            1,
          ),
        ),
      )
    : null;

  const growth: GrowthMonth[] = monthRange(months, now).map((month) => ({
    month,
    newStudios: newByMonth.get(month) ?? 0,
    activated: activatedByMonth.get(month) ?? 0,
    churned:
      measuredFrom !== null && month >= measuredFrom
        ? (churnedByMonth.get(month) ?? 0)
        : null,
  }));

  return {
    months: growth,
    /** So the screen can say where the churn line starts, and why. */
    churnMeasuredFrom: measuredFrom,
  };
}

/**
 * Bookings created per month, across every studio.
 *
 * CANCELLED excluded, matching the Bookings card above it — a booking that was
 * made and then cancelled is not one the platform carried, and the two numbers
 * disagreeing on the same screen would be worse than either rule alone.
 */
export async function getBookingVolume(months = 12, now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );

  const rows = await prisma.$queryRaw<MonthCount[]>`
    SELECT date_trunc('month', created_at) AS month, count(*) AS count
    FROM bookings
    WHERE created_at >= ${start} AND status <> 'CANCELLED'
    GROUP BY 1
  `;

  const byMonth = tally(rows);
  const keys = monthRange(months, now);

  const volume: BookingVolumeMonth[] = keys.map((month) => ({
    month,
    bookings: byMonth.get(month) ?? 0,
  }));

  return {
    months: volume,
    thisMonth: byMonth.get(keys[keys.length - 1]!) ?? 0,
  };
}
