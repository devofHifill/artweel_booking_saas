import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api';
import { useOrgBase } from './auth';

/**
 * The numbers and warnings the chrome renders.
 *
 * Refetched on navigation rather than polled. A badge is a claim that something
 * needs doing, so it has to be right just after the user did it — confirming a
 * booking and watching the "2" beside Bookings sit there is worse than having no
 * badge, because it says the action did not land. Navigation is when people look
 * at the sidebar, and it costs one cheap query.
 *
 * A timer was the alternative and is worse in both directions: stale between
 * ticks, and still running for somebody who left the tab open over lunch.
 */

export type ShellAlert = {
  id: 'payments' | 'notifications' | 'calendars';
  level: 'warn' | 'danger';
  message: string;
};

/** Somebody from Artweel is inside this studio right now. See S7. */
export type SupportPresence = {
  id: string;
  by: string;
  reason: string;
  readOnly: boolean;
  expiresAt: string;
};

export type ShellSummary = {
  counts: { today: number; pendingBookings: number };
  alerts: ShellAlert[];
  /** Optional so an older server that does not send it renders no banner. */
  support?: SupportPresence[];
};

const EMPTY: ShellSummary = {
  counts: { today: 0, pendingBookings: 0 },
  alerts: [],
  support: [],
};

export function useShellSummary(): ShellSummary {
  const base = useOrgBase();
  const location = useLocation();
  const [summary, setSummary] = useState<ShellSummary>(EMPTY);

  const load = useCallback(async () => {
    try {
      setSummary(await api.get<ShellSummary>(`${base}/shell/summary`));
    } catch {
      /*
        Silent, and left showing whatever it showed before.

        This decorates the frame around the page. If it fails, the page itself
        is still perfectly usable, and an error banner across the top of a
        working dashboard because a badge count could not be fetched is a worse
        outcome than a slightly stale badge.
      */
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  return summary;
}
