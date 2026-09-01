import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth, useOrgBase } from '../lib/auth';
import { PageHead } from '../components/layout';
import { EmptyState, LoadingRegion, SkeletonTable } from '../components/states';
import { WorkingHours } from '../components/working-hours';

/**
 * An instructor's own schedule.
 *
 * `POST /schedules/:staffId/overrides` has been `requireAdminOrSelf` since S13,
 * and its comment said "instructors may mark their own time off" from the day
 * it was written. The guard was made to mean it; the screen that would let
 * anybody use it was never built. Staff & Guides is the only route to the
 * hours panel and its actions are admin-only, so the half of that rule
 * covering "or self" reached nobody.
 *
 * This is that half. Hours stay read-only — `POST /rules` is `requireAdmin`,
 * because when a studio opens is the studio's decision — and the exceptions
 * below are the instructor's own.
 *
 * There is no new endpoint. `GET /staff` is `requireMember` and returns
 * `userId` on every row, so finding your own record is a filter, not a
 * lookup nobody wrote.
 */

type StaffRow = {
  id: string;
  name: string;
  userId: string | null;
  isActive: boolean;
};

export default function MySchedule() {
  const base = useOrgBase();
  const { user } = useAuth();

  const [mine, setMine] = useState<StaffRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const res = await api.get<{ staff: StaffRow[] }>(`${base}/staff`);
      setMine(res.staff.find((s) => s.userId === user.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your schedule.');
    }
  }, [base, user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="My schedule"
        lede="When you teach, and the days you are not available."
      />

      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}

      {mine === undefined && !error && (
        <LoadingRegion label="Loading your schedule">
          <SkeletonTable rows={2} />
        </LoadingRegion>
      )}

      {/*
        Signed in, a member of the studio, and not on its staff list.
        A front-desk account is exactly that and is not a mistake, so this
        explains rather than apologises.
      */}
      {mine === null && (
        <EmptyState hint="An owner or admin can add you on Staff & Guides.">
          You are not on the teaching rota. This page shows the hours of people
          who teach, and your account has no instructor record — so there is
          nothing here to schedule.
        </EmptyState>
      )}

      {/*
        The real name, not "you". The panel heading reads "When {name} works",
        and a pronoun turns that into "When you works".
      */}
      {mine && (
        <WorkingHours
          base={base}
          staff={{ id: mine.id, name: mine.name }}
          canEditHours={false}
          canEditExceptions
          onClose={() => void load()}
        />
      )}
    </>
  );
}
