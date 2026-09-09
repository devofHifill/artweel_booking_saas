/** Shapes the platform API returns. Kept together so screens agree on them. */

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELED';

export type PlanId = 'SOLO' | 'STUDIO' | 'PRO';

export type StudioCounts = {
  staff: number;
  customers: number;
  bookings: number;
  lastBookingAt: string | null;
};

export type StudioRow = {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
  onboardingDoneAt: string | null;
  onboardingComplete: boolean;
  stripeChargesEnabled: boolean;
  signupSource: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string } | null;
  counts: StudioCounts;
};

export type StudioList = {
  total: number;
  limit: number;
  offset: number;
  sortedBy: string;
  direction: 'asc' | 'desc';
  sortFellBack: boolean;
  studios: StudioRow[];
};

export type StudioWarning = { code: string; message: string };

export type StudioDetailResponse = {
  studio: StudioRow & {
    timezone: string;
    currency: string;
    compedAt: string | null;
    suspendedByPlatformAt: string | null;
    suspendedReason: string | null;
    billingSubscriptionId: string | null;
    stripeAccountId: string | null;
    stripePayoutsEnabled: boolean;
    planDefinition: { id: PlanId; name: string; priceCentsMonthly: number };
  };
  warnings: StudioWarning[];
  members: {
    id: string;
    role: string;
    createdAt: string;
    user: {
      id: string;
      name: string;
      email: string;
      emailVerifiedAt: string | null;
    };
  }[];
  onboarding: {
    complete: boolean;
    readyToPublish: boolean;
    bookingUrl: string;
    steps: {
      id: string;
      title: string;
      done: boolean;
      optional: boolean;
    }[];
  };
};

export type Metrics = {
  studios: {
    total: number;
    byStatus: Record<SubscriptionStatus, number>;
    byPlan: Record<PlanId, number>;
    stalledInOnboarding: number;
    idle30Days: number;
  };
  trials: {
    expiringWithin7Days: number;
    lapsedWithoutConverting: number;
    conversionRate: number | null;
  };
  subscriptionRevenue: {
    mrrCents: number;
    payingStudios: number;
    currency: string;
  };
  studioBookingVolume: {
    last30DaysCents: number;
    payments: number;
    note: string;
  };
  /**
   * The flow metrics over the selected window. Only these carry a delta —
   * a null delta means the prior window was empty, so there is no percentage
   * to show and the card says "new" instead.
   */
  window: {
    days: number;
    gmvCents: number;
    gmvDeltaPct: number | null;
    bookings: number;
    bookingsAcrossStudios: number;
    bookingsDeltaPct: number | null;
    studiosNew: number;
    studiosDeltaPct: number | null;
    platformPaymentsCents: number;
  };
  signups: {
    byWeek: { week: string; count: number }[];
    bySource: { source: string; count: number }[];
  };
};

export type WorkerHealth = {
  name: string;
  state: 'ok' | 'late' | 'never-run' | 'failing';
  expectedIntervalMs: number;
  lastFinishedAt: string | null;
  secondsSinceLastRun: number | null;
  runs: number;
  failures: number;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type QueueHealth = {
  pending: number;
  /**
   * The number that matters. `pending` counts reminders deliberately scheduled
   * days ahead, so a big pending figure is a healthy queue; only a job whose
   * moment has passed and is still unsent means the drain has stopped.
   */
  overdue: number;
  failed: number;
  /** Informational — a future date here means nothing is late. */
  nextScheduledFor: string | null;
};

/**
 * One row on the health panel. There is no uptime percentage because nothing
 * measures one; `latencyMs` is present only where it was actually timed.
 */
export type HealthComponent = {
  key: string;
  label: string;
  status: 'ok' | 'degraded' | 'down' | 'not-configured';
  detail: string;
  latencyMs: number | null;
};

export type MrrPoint = {
  date: string;
  mrrCents: number;
  activeStudios: number;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
};

export type MrrHistory = {
  days: number;
  points: MrrPoint[];
  hasHistory: boolean;
  firstDate: string | null;
  lastDate: string | null;
};

export type GrowthMonth = {
  month: string;
  newStudios: number;
  activated: number;
  /** null means the month was never measured, which is not the same as zero. */
  churned: number | null;
};

export type PlatformGrowth = {
  months: GrowthMonth[];
  churnMeasuredFrom: string | null;
};

export type BookingVolume = {
  months: { month: string; bookings: number }[];
  thisMonth: number;
};

export type Health = {
  checkedAt: string;
  degraded: boolean;
  components: HealthComponent[];
  workers: WorkerHealth[];
  queues: {
    notifications: QueueHealth;
    calendar: QueueHealth;
  };
  unswept: {
    waitlistOffersHeld: number;
    waitlistOffersOverdue: number;
    expiredHoldsStillOpen: number;
  };
};

export type AuditEntry = {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  reason: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
};

// --- Shared formatting ----------------------------------------------------

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function shortDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function dateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 6 days" / "3 days ago", for dates whose distance is the point. */
export function relativeDays(value: string | null): string {
  if (!value) return '—';
  const days = Math.round(
    (new Date(value).getTime() - Date.now()) / 86_400_000,
  );
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} ago`;
}
