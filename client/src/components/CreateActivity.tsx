import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, plusDays, todayIn } from '../lib/api';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  clockTime,
  planClassDates,
  shortDate,
  type Weekday,
} from '../lib/class-dates';
import { Modal } from './layout';
import { Icon } from './Icon';
import { EMOJI, GRADS } from './ServiceForm';

/**
 * Create activity: one choice, Class or Event, then a few short steps
 * (CLASS-EVENT-PLAN.md, Stages 2 and 3).
 *
 * Replaces the six-section form for CREATING. Editing a published activity
 * still uses ServiceForm, on one page — nobody wants to click through five
 * steps to fix a price.
 *
 * Every step after the choice saves a draft on the server, so closing the tab
 * halfway loses nothing; publishing deletes it. A draft is only answers, never
 * dates — dates would hold the instructor's time and clash with real bookings.
 */

export type ActivityKind = 'CLASS' | 'EVENT';

/** Everything the steps collect. Also exactly what a draft stores. */
export type ActivityAnswers = {
  name: string;
  shortDescription: string;
  // Event
  date: string;
  // Class
  startDate: string;
  weekdays: Weekday[];
  sessionCount: number;
  skipDates: string[];
  // Both
  startTime: string;
  endTime: string;
  locationId: string;
  staffId: string;
  seats: number;
  price: string;
  /*
    The rest of what an activity carries, asked on a Class's later steps.
    All optional; the Event steps do not ask them yet (CLASS-EVENT-PLAN.md).
  */
  description: string;
  categoryId: string;
  meetingPoint: string;
  /** Per child place for the whole class, as typed. Blank or 0: adults only. */
  childPrice: string;
  minGuests: number;
  depositType: 'none' | 'percent' | 'fixed';
  /** A percent, or an amount as typed, by depositType. */
  depositValue: string;
  emoji: string;
  /** Blank: the studio's default colour. */
  color: string;
  colorAccent: string;
  cancellationPolicyId: string;
  minNoticeMinutes: number;
  /** As typed. Blank: booking opens as soon as it is published. */
  maxHorizonDays: string;
  highlights: string;
  preparationNotes: string;
  bookingInstructions: string;
  /** false publishes it Hidden: made, but not on the booking page. */
  isActive: boolean;
};

export type ResumableDraft = {
  /** Empty for a duplicate: it has no draft until its first step is saved. */
  id: string;
  kind: ActivityKind;
  /** `reached`: the furthest step that may be jumped to from the progress bar. */
  data: Partial<ActivityAnswers> & { step?: number; reached?: number };
};

/** "18:00" and "TU" for an instant, on the studio's clock. */
function wallClock(iso: string, timezone: string): { time: string; weekday: Weekday } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday').slice(0, 2).toUpperCase() as Weekday;
  return { time: `${get('hour')}:${get('minute')}`, weekday };
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h! * 60 + m! + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Duplicate: a published Class or Event as a new one, opened at its dates
 * step (CLASS-EVENT-PLAN.md, Stage 5). Everything but the dates is copied —
 * running "Beginner Wheel" again next term is picking new dates and pressing
 * Publish. The later steps can be jumped to straight from the progress bar.
 */
export function duplicateOf(
  activity: {
    kind: ActivityKind;
    name: string;
    shortDescription?: string | null;
    capacityMax: number;
    priceCents?: number;
    durationMinutes: number;
    firstStartsAt?: string | null;
    serviceLocations?: { locationId: string }[];
    staffServices?: { staffId: string }[];
    description?: string | null;
    categoryId?: string | null;
    meetingPoint?: string | null;
    childPriceCents?: number;
    capacityMin?: number;
    depositType?: string;
    depositValue?: number;
    emoji?: string | null;
    color?: string | null;
    colorAccent?: string | null;
    cancellationPolicyId?: string | null;
    minNoticeMinutes?: number;
    maxHorizonDays?: number;
    highlights?: string | null;
    preparationNotes?: string | null;
    bookingInstructions?: string | null;
  },
  timezone: string,
  sessionCount?: number,
): ResumableDraft {
  const clock = activity.firstStartsAt ? wallClock(activity.firstStartsAt, timezone) : null;
  const startTime = clock?.time ?? '18:00';
  return {
    id: '',
    kind: activity.kind,
    data: {
      name: activity.name,
      shortDescription: activity.shortDescription ?? '',
      seats: activity.capacityMax,
      price: ((activity.priceCents ?? 0) / 100).toFixed(2),
      startTime,
      endTime: addMinutes(startTime, activity.durationMinutes),
      locationId: activity.serviceLocations?.[0]?.locationId ?? '',
      staffId: activity.staffServices?.[0]?.staffId ?? '',
      ...(activity.kind === 'CLASS'
        ? {
            weekdays: clock ? [clock.weekday] : [],
            ...(sessionCount ? { sessionCount } : {}),
            description: activity.description ?? '',
            categoryId: activity.categoryId ?? '',
            meetingPoint: activity.meetingPoint ?? '',
            childPrice: activity.childPriceCents
              ? (activity.childPriceCents / 100).toFixed(2)
              : '',
            minGuests: activity.capacityMin ?? 1,
            depositType: (['none', 'percent', 'fixed'].includes(activity.depositType ?? '')
              ? activity.depositType
              : 'none') as ActivityAnswers['depositType'],
            depositValue:
              activity.depositType === 'percent'
                ? String(activity.depositValue ?? '')
                : activity.depositType === 'fixed'
                  ? ((activity.depositValue ?? 0) / 100).toFixed(2)
                  : '',
            emoji: activity.emoji ?? '',
            color: activity.color ?? '',
            colorAccent: activity.colorAccent ?? '',
            cancellationPolicyId: activity.cancellationPolicyId ?? '',
            minNoticeMinutes: activity.minNoticeMinutes ?? 0,
            // Not copied: the old one was set for the old dates.
            maxHorizonDays: '',
            highlights: activity.highlights ?? '',
            preparationNotes: activity.preparationNotes ?? '',
            bookingInstructions: activity.bookingInstructions ?? '',
          }
        : {}),
      step: 1,
      reached: STEPS[activity.kind].length - 1,
    },
  };
}

type Location = { id: string; name: string; locationType?: string };
type Staff = { id: string; name: string };

const STEPS: Record<ActivityKind, string[]> = {
  EVENT: ['What', 'When and where', 'Seats and price', 'Review'],
  CLASS: [
    'What',
    'Schedule',
    'Where and who',
    'Seats and price',
    'Look',
    'Policies',
    'For customers',
    'Review',
  ],
};

type Category = { id: string; name: string };
type Policy = { id: string; name: string; isDefault: boolean };

/** "2 hours", "1 hour 30 min", for a start and end on the same day. */
function durationText(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  if (!(minutes > 0)) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  return [hours, m ? `${m} min` : ''].filter(Boolean).join(' ') + ` (${minutes} minutes)`;
}

/** When booking opens, in words, for the "Bookable up to" field. */
function horizonHint(days: string, firstDate: string | undefined, timezone: string): string {
  if (!days.trim()) return 'Blank: booking opens as soon as you publish.';
  const n = Number(days);
  if (!firstDate || !Number.isInteger(n) || n < 1) return 'Booking opens this many days before the first session.';
  const opens = plusDays(firstDate, -n);
  return opens <= todayIn(timezone)
    ? 'Booking opens as soon as you publish.'
    : `Booking opens on ${shortDate(opens)}, ${n} days before the first session.`;
}

/** Cents for a typed amount; blank counts as 0. Null when it is not a number. */
function optionalCents(value: string): number | null {
  return value.trim() === '' ? 0 : priceCents(value);
}

function defaults(timezone: string): ActivityAnswers {
  const nextWeek = plusDays(todayIn(timezone), 7);
  return {
    name: '',
    shortDescription: '',
    date: nextWeek,
    startDate: nextWeek,
    weekdays: [],
    sessionCount: 6,
    skipDates: [],
    startTime: '18:00',
    endTime: '20:00',
    locationId: '',
    staffId: '',
    seats: 8,
    price: '',
    description: '',
    categoryId: '',
    meetingPoint: '',
    childPrice: '',
    minGuests: 1,
    depositType: 'none',
    depositValue: '',
    emoji: '',
    color: '',
    colorAccent: '',
    cancellationPolicyId: '',
    minNoticeMinutes: 0,
    maxHorizonDays: '',
    highlights: '',
    preparationNotes: '',
    bookingInstructions: '',
    isActive: true,
  };
}

function priceCents(price: string): number | null {
  if (price.trim() === '') return null;
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

type Errors = Partial<Record<keyof ActivityAnswers | 'clashes', string>>;

/** What already happens at a date, from the server's preview (Stage 4). */
type Clash = { kind: 'STAFF' | 'LOCATION'; message: string };

/**
 * The steps where a clash can be SEEN and fixed, so Next waits there. A Class
 * learns its instructor a step after its dates, so its clashes can surface on
 * either; the list says which dates and what to change.
 */
const CLASH_STEPS = ['When and where', 'Seats and price', 'Schedule', 'Where and who'];

export function CreateActivity({
  base,
  timezone,
  currency,
  resume,
  onCreated,
  onClose,
}: {
  base: string;
  timezone: string;
  currency: string;
  resume?: ResumableDraft;
  onCreated: (message: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ActivityKind | null>(resume?.kind ?? null);
  const [step, setStep] = useState(resume?.data.step ?? 0);
  /** The furthest step reached; steps up to it can be clicked in the progress bar. */
  const [reached, setReached] = useState(resume?.data.reached ?? resume?.data.step ?? 0);
  const [answers, setAnswers] = useState<ActivityAnswers>(() => {
    const { step: _step, reached: _reached, ...saved } = resume?.data ?? {};
    return { ...defaults(timezone), ...saved };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const draftId = useRef<string | null>(resume?.id || null);

  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  /** The studio-wide deposit switch. Off: every booking pays in full. */
  const [depositsEnabled, setDepositsEnabled] = useState<boolean | null>(null);
  /**
   * The plan's limit on Classes running at once (Solo: 1), and how many are
   * running. Null until known; the server enforces it on publish regardless.
   */
  const [classLimit, setClassLimit] = useState<{
    running: number;
    max: number | null;
    planName: string;
    upgradeTo: string | null;
  } | null>(null);
  const classesFull = classLimit !== null && classLimit.max !== null && classLimit.running >= classLimit.max;

  /* Each picker loads on its own and fails quietly: a list that cannot load
     leaves its field offering "none", and the rest of the flow still works. */
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ locations: Location[] }>(`${base}/locations`);
        const found = res.locations ?? [];
        setLocations(found);
        /* The one place a class can be held is chosen for them: the only
           location, or the only building when the other is a mobile service
           area. Two buildings is a real question, so it is asked. */
        const fixed = found.filter((l) => !l.locationType || l.locationType === 'FIXED');
        const only = found.length === 1 ? found[0] : fixed.length === 1 ? fixed[0] : null;
        if (only) setAnswers((a) => (a.locationId ? a : { ...a, locationId: only.id }));
      } catch {
        setLocations([]);
      }
    })();
    void (async () => {
      try {
        const res = await api.get<{ staff: Staff[] }>(`${base}/staff`);
        setStaff(res.staff);
        if (res.staff.length === 1) {
          setAnswers((a) => (a.staffId ? a : { ...a, staffId: res.staff[0]!.id }));
        }
      } catch {
        setStaff([]);
      }
    })();
    void (async () => {
      try {
        const res = await api.get<{
          billing: {
            plan: string;
            planName: string;
            usage: { classes?: number };
            limits: { maxClasses?: number | null };
          };
          plans: { id: string; name: string; maxClasses?: number | null }[];
        }>(`${base}/billing`);
        setClassLimit({
          running: res.billing.usage.classes ?? 0,
          max: res.billing.limits.maxClasses ?? null,
          planName: res.billing.planName,
          upgradeTo: res.plans.find((p) => p.maxClasses === null)?.name ?? null,
        });
      } catch {
        /* Unknown: offer it, and let the server say so on publish. */
      }
    })();
    void (async () => {
      try {
        const res = await api.get<{ categories: Category[] }>(`${base}/services/categories`);
        setCategories(res.categories ?? []);
      } catch {
        setCategories([]);
      }
    })();
    void (async () => {
      try {
        const res = await api.get<{ policies: Policy[] }>(`${base}/cancellation-policies`);
        setPolicies(res.policies ?? []);
      } catch {
        setPolicies([]);
      }
    })();
    void (async () => {
      try {
        const res = await api.get<{ organization: { depositsEnabled?: boolean } }>(base);
        setDepositsEnabled(res.organization?.depositsEnabled ?? null);
      } catch {
        /* Unknown: the deposit field is still offered, without the note. */
      }
    })();
  }, [base]);

  function set<K extends keyof ActivityAnswers>(key: K, value: ActivityAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  const schedule = useMemo(
    () =>
      kind === 'CLASS'
        ? planClassDates({
            startDate: answers.startDate,
            weekdays: answers.weekdays,
            sessionCount: answers.sessionCount,
            skipDates: answers.skipDates,
          })
        : null,
    [kind, answers.startDate, answers.weekdays, answers.sessionCount, answers.skipDates],
  );

  /*
    The live clash check (CLASS-EVENT-PLAN.md, Stage 4). Asked again a moment
    after anything that decides when, where or who changes; an answer that
    arrives after a newer question is dropped. A failed check shows nothing:
    publishing checks again on the server, so it can never let a clash through.
  */
  const [clashes, setClashes] = useState<Map<string, Clash[]>>(new Map());
  useEffect(() => {
    if (!kind || answers.endTime <= answers.startTime) {
      setClashes(new Map());
      return;
    }
    const where = {
      startTime: answers.startTime,
      endTime: answers.endTime,
      ...(answers.locationId ? { locationId: answers.locationId } : {}),
      ...(answers.staffId ? { staffId: answers.staffId } : {}),
    };
    const body =
      kind === 'EVENT'
        ? answers.date
          ? { kind, date: answers.date, ...where }
          : null
        : schedule
          ? {
              kind,
              startDate: answers.startDate,
              weekdays: answers.weekdays,
              sessionCount: answers.sessionCount,
              ...(answers.skipDates.length ? { skipDates: answers.skipDates } : {}),
              ...where,
            }
          : null;
    if (!body) {
      setClashes(new Map());
      return;
    }

    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.post<{ dates: { localDate: string; clashes: Clash[] }[] }>(
            `${base}/activities/preview`,
            body,
          );
          if (!stale) {
            setClashes(
              new Map(res.dates.filter((d) => d.clashes.length).map((d) => [d.localDate, d.clashes])),
            );
          }
        } catch {
          /* Left as it was; publishing re-checks. */
        }
      })();
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [
    base,
    kind,
    schedule,
    answers.date,
    answers.startDate,
    answers.weekdays,
    answers.sessionCount,
    answers.skipDates,
    answers.startTime,
    answers.endTime,
    answers.locationId,
    answers.staffId,
  ]);

  // Clashes that no longer apply clear the message that pointed at them.
  useEffect(() => {
    if (clashes.size === 0) setErrors((e) => (e.clashes ? { ...e, clashes: undefined } : e));
  }, [clashes]);

  const steps = kind ? STEPS[kind] : [];
  const stepName = steps[step];
  const locationName = locations.find((l) => l.id === answers.locationId)?.name;
  const staffName = staff.find((s) => s.id === answers.staffId)?.name;

  /** What is wrong on the current step. Empty means Next may go on. */
  function validate(name: string | undefined): Errors {
    const e: Errors = {};
    const today = todayIn(timezone);
    if (name === 'What') {
      if (!answers.name.trim()) e.name = 'Give it a name customers will recognise.';
    }
    if (name === 'When and where' || name === 'Schedule') {
      if (answers.endTime <= answers.startTime) e.endTime = 'The end time must be after the start.';
    }
    if (name === 'When and where') {
      if (!answers.date || answers.date < today) e.date = 'Choose a date that has not passed.';
      if (locations.length > 1 && !answers.locationId) e.locationId = 'Choose where it runs.';
    }
    if (name === 'Schedule') {
      if (!answers.startDate || answers.startDate < today) e.startDate = 'Choose a start date that has not passed.';
      if (answers.weekdays.length === 0) e.weekdays = 'Choose at least one day.';
      if (!Number.isInteger(answers.sessionCount) || answers.sessionCount < 1 || answers.sessionCount > 52)
        e.sessionCount = 'Between 1 and 52 sessions.';
      else if (answers.weekdays.length > 0 && !schedule) e.sessionCount = 'Those sessions do not fit. Skip fewer dates.';
    }
    if (name === 'Where and who') {
      if (locations.length > 1 && !answers.locationId) e.locationId = 'Choose where it runs.';
    }
    if (name === 'Seats and price') {
      if (!Number.isInteger(answers.seats) || answers.seats < 1 || answers.seats > 500)
        e.seats = 'Between 1 and 500 seats.';
      if (priceCents(answers.price) === null) e.price = 'Enter a price. Use 0 if it is free.';
      if (kind === 'CLASS') {
        if (optionalCents(answers.childPrice) === null)
          e.childPrice = 'Enter a price, or leave it blank for adults only.';
        if (!Number.isInteger(answers.minGuests) || answers.minGuests < 1)
          e.minGuests = 'At least 1.';
        else if (Number.isInteger(answers.seats) && answers.minGuests > answers.seats)
          e.minGuests = 'Cannot be more than the maximum capacity.';
        if (answers.depositType !== 'none') {
          const value = Number(answers.depositValue);
          if (answers.depositValue.trim() === '' || !Number.isFinite(value) || value <= 0)
            e.depositValue = 'Enter a deposit above zero, or choose Pay in full.';
          else if (answers.depositType === 'percent' && (value > 100 || !Number.isInteger(value)))
            e.depositValue = 'A whole percent, up to 100.';
        }
      }
    }
    if (name === 'Policies') {
      if (!Number.isInteger(answers.minNoticeMinutes) || answers.minNoticeMinutes < 0 || answers.minNoticeMinutes > 525_600)
        e.minNoticeMinutes = 'Between 0 and 525,600 minutes (a year).';
      if (answers.maxHorizonDays.trim() !== '') {
        const days = Number(answers.maxHorizonDays);
        if (!Number.isInteger(days) || days < 1 || days > 730)
          e.maxHorizonDays = 'Between 1 and 730 days, or leave it blank.';
      }
    }
    if (name === 'For customers') {
      if (answers.highlights.trim() && answers.highlights.trim().split('\n').length > 12)
        e.highlights = 'Twelve lines at most.';
    }
    if (name && CLASH_STEPS.includes(name) && clashes.size > 0) {
      e.clashes =
        clashes.size === 1
          ? 'That date clashes. Change the time, the instructor or where it runs'
          : `${clashes.size} dates clash. Change the time, the instructor or where it runs`;
      if (kind === 'CLASS') {
        e.clashes += name === 'Schedule' ? ', or untick those dates' : ', or untick those dates on Schedule';
      }
      e.clashes += '.';
    }
    return e;
  }

  /** Best effort: a draft that fails to save never blocks the next step. */
  async function saveDraft(nextStep: number) {
    if (!kind) return;
    const data = { ...answers, step: nextStep, reached: Math.max(reached, nextStep) };
    try {
      if (draftId.current) {
        await api.put(`${base}/activities/drafts/${draftId.current}`, { data });
      } else {
        const res = await api.post<{ draft: { id: string } }>(`${base}/activities/drafts`, {
          kind,
          data,
        });
        draftId.current = res.draft.id;
      }
    } catch {
      /* Left unsaved; the flow carries on. */
    }
  }

  function next() {
    const e = validate(stepName);
    setErrors(e);
    if (Object.keys(e).length) return;
    const to = step + 1;
    setStep(to);
    setReached((r) => Math.max(r, to));
    void saveDraft(to);
  }

  function back() {
    if (step === 0) {
      // Back from the first step returns to the choice. Nothing is lost.
      setKind(null);
      return;
    }
    setStep(step - 1);
  }

  async function publish() {
    if (!kind) return;
    setBusy(true);
    setServerError(null);

    const common = {
      name: answers.name.trim(),
      ...(answers.shortDescription.trim()
        ? { shortDescription: answers.shortDescription.trim() }
        : {}),
      ...(answers.locationId ? { locationId: answers.locationId } : {}),
      ...(answers.staffId ? { staffId: answers.staffId } : {}),
      seats: answers.seats,
      priceCents: priceCents(answers.price) ?? 0,
      startTime: answers.startTime,
      endTime: answers.endTime,
      ...(draftId.current ? { draftId: draftId.current } : {}),
    };

    try {
      if (kind === 'EVENT') {
        await api.post(`${base}/activities/events`, { ...common, date: answers.date });
        onCreated(`${common.name} is on your booking page for ${shortDate(answers.date)}.`);
      } else {
        const text = (value: string) => (value.trim() ? value.trim() : undefined);
        const depositValue =
          answers.depositType === 'percent'
            ? Math.round(Number(answers.depositValue))
            : answers.depositType === 'fixed'
              ? (priceCents(answers.depositValue) ?? 0)
              : 0;
        await api.post(`${base}/activities/classes`, {
          ...common,
          startDate: answers.startDate,
          weekdays: answers.weekdays,
          sessionCount: answers.sessionCount,
          ...(answers.skipDates.length ? { skipDates: answers.skipDates } : {}),
          description: text(answers.description),
          categoryId: answers.categoryId || undefined,
          meetingPoint: text(answers.meetingPoint),
          childPriceCents: optionalCents(answers.childPrice) ?? 0,
          minGuests: answers.minGuests,
          depositType: answers.depositType,
          depositValue,
          emoji: answers.emoji || undefined,
          color: answers.color || undefined,
          colorAccent: answers.colorAccent || undefined,
          cancellationPolicyId: answers.cancellationPolicyId || undefined,
          minNoticeMinutes: answers.minNoticeMinutes,
          ...(answers.maxHorizonDays.trim() ? { maxHorizonDays: Number(answers.maxHorizonDays) } : {}),
          highlights: text(answers.highlights),
          preparationNotes: text(answers.preparationNotes),
          bookingInstructions: text(answers.bookingInstructions),
          isActive: answers.isActive,
        });
        onCreated(
          answers.isActive
            ? `${common.name} is on your booking page: ${answers.sessionCount} sessions from ${shortDate(
                schedule?.dates[0] ?? answers.startDate,
              )}.`
            : `${common.name} is saved as Hidden. Switch it to Active when you want it on your booking page.`,
        );
      }
    } catch (err) {
      // The server's message is the useful one: it knows about clashes, plans
      // and dates that have passed.
      setServerError(err instanceof Error ? err.message : 'Could not publish.');
      setBusy(false);
    }
  }

  function toggleWeekday(day: Weekday) {
    set(
      'weekdays',
      answers.weekdays.includes(day)
        ? answers.weekdays.filter((d) => d !== day)
        : WEEKDAYS.filter((d) => d === day || answers.weekdays.includes(d)),
    );
  }

  function toggleDate(date: string) {
    set(
      'skipDates',
      answers.skipDates.includes(date)
        ? answers.skipDates.filter((d) => d !== date)
        : [...answers.skipDates, date],
    );
  }

  // --- The choice ------------------------------------------------------------

  if (!kind) {
    return (
      <Modal title="Create activity" subtitle="What are you putting on?" size="wide" onClose={onClose}>
        <div className="kind-cards">
          <button
            type="button"
            className="kind-card"
            disabled={classesFull}
            onClick={() => {
              setKind('CLASS');
              setStep(0);
            }}
          >
            <span className="kind-card-icon" aria-hidden="true">
              <Icon name="calendar" size={22} />
            </span>
            <span className="kind-card-title">Class</span>
            <span className="kind-card-text">
              Runs over several weeks. Customers book once and come to every session.
            </span>
            {classLimit && classLimit.max !== null && (
              <span className="kind-card-note">
                {classesFull
                  ? `Your ${classLimit.planName} plan runs ${classLimit.max} ${
                      classLimit.max === 1 ? 'class' : 'classes'
                    } at a time. Publish the next when this one ends${
                      classLimit.upgradeTo ? `, or upgrade to ${classLimit.upgradeTo}` : ''
                    }.`
                  : `${classLimit.max} ${classLimit.max === 1 ? 'class' : 'classes'} at a time on ${classLimit.planName}.`}
              </span>
            )}
          </button>
          <button
            type="button"
            className="kind-card"
            onClick={() => {
              setKind('EVENT');
              setStep(0);
            }}
          >
            <span className="kind-card-icon" aria-hidden="true">
              <Icon name="today" size={22} />
            </span>
            <span className="kind-card-title">Event</span>
            <span className="kind-card-text">
              One date. A workshop, a date night, a party. Customers book a seat.
            </span>
          </button>
        </div>
      </Modal>
    );
  }

  // --- The steps -------------------------------------------------------------

  const last = step === steps.length - 1;
  const title = kind === 'CLASS' ? 'New class' : 'New event';

  return (
    <Modal
      title={title}
      subtitle={
        /* Spans with list roles, not <ol>: the Modal puts its subtitle in a
           <p>, and a list cannot sit inside a paragraph. */
        <span className="step-bar" role="list" aria-label="Steps">
          {steps.map((label, index) => (
            <span
              role="listitem"
              key={label}
              className={index === step ? 'on' : index <= reached ? 'done' : undefined}
            >
              <button
                type="button"
                disabled={index > reached || index === step}
                aria-current={index === step ? 'step' : undefined}
                onClick={() => setStep(index)}
              >
                {label}
              </button>
            </span>
          ))}
        </span>
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={back} disabled={busy}>
            Back
          </button>
          {last ? (
            <button
              type="button"
              className="primary"
              onClick={() => void publish()}
              disabled={busy || clashes.size > 0}
            >
              {busy ? 'Publishing…' : answers.isActive || kind !== 'CLASS' ? 'Publish' : 'Save as hidden'}
            </button>
          ) : (
            <button type="button" className="primary" onClick={next}>
              Next
            </button>
          )}
        </>
      }
    >
      <form
        className="step-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (last) void publish();
          else next();
        }}
      >
        {/* Enter on a field moves on, as the Next button does. */}
        {/* display:none inline — the global button rule outranks `hidden`. */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />

        {stepName === 'What' && (
          <>
            <Field label="Name" error={errors.name} htmlFor="actName">
              <input
                id="actName"
                autoFocus
                maxLength={120}
                value={answers.name}
                placeholder={kind === 'CLASS' ? 'Beginner wheel' : 'Valentine date night'}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field
              label="Short description"
              hint="One line that sells it on your booking page. Optional."
              htmlFor="actShort"
            >
              <input
                id="actShort"
                maxLength={200}
                value={answers.shortDescription}
                placeholder="Learn to centre, open and pull your first pots"
                onChange={(e) => set('shortDescription', e.target.value)}
              />
            </Field>
            {kind === 'CLASS' && (
              <>
                <Field
                  label="Full description"
                  hint="The longer version, shown when somebody opens it. Optional."
                  htmlFor="actDesc"
                >
                  <textarea
                    id="actDesc"
                    rows={4}
                    maxLength={4000}
                    value={answers.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </Field>
                <div className="form-row">
                  <Field
                    label="Type"
                    hint="Chosen at the start. To make an Event instead, go back and pick it."
                    htmlFor="actType"
                  >
                    <input id="actType" value="Class" readOnly disabled />
                  </Field>
                  <Field
                    label="Category"
                    hint={
                      categories.length
                        ? 'Groups it on your booking page. Optional.'
                        : 'None set up yet. They group activities on your booking page.'
                    }
                    htmlFor="actCategory"
                  >
                    <select
                      id="actCategory"
                      value={answers.categoryId}
                      onChange={(e) => set('categoryId', e.target.value)}
                    >
                      <option value="">Uncategorised</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {stepName === 'When and where' && (
          <>
            <Field label="Date" error={errors.date} htmlFor="actDate">
              <input
                id="actDate"
                type="date"
                min={todayIn(timezone)}
                value={answers.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </Field>
            <TimeFields answers={answers} errors={errors} set={set} />
            <LocationField
              locations={locations}
              value={answers.locationId}
              error={errors.locationId}
              onChange={(v) => set('locationId', v)}
            />
            <ClashList clashes={clashes} error={errors.clashes} />
          </>
        )}

        {stepName === 'Schedule' && (
          <>
            <Field label="Starts on" error={errors.startDate} htmlFor="actStart">
              <input
                id="actStart"
                type="date"
                min={todayIn(timezone)}
                value={answers.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </Field>
            <Field label="Every" error={errors.weekdays}>
              <div className="chip-group" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={answers.weekdays.includes(day) ? 'chip on' : 'chip'}
                    aria-pressed={answers.weekdays.includes(day)}
                    onClick={() => toggleWeekday(day)}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </Field>
            <TimeFields answers={answers} errors={errors} set={set} />
            <Field
              label="Duration"
              hint="Worked out from the times above. Change those to change it."
              htmlFor="actDuration"
            >
              <input
                id="actDuration"
                value={durationText(answers.startTime, answers.endTime)}
                readOnly
                disabled
              />
            </Field>
            <Field label="Sessions" error={errors.sessionCount} htmlFor="actCount" hint="How many times the class meets. The price covers all of them.">
              <input
                id="actCount"
                type="number"
                min={1}
                max={52}
                value={Number.isNaN(answers.sessionCount) ? '' : answers.sessionCount}
                onChange={(e) => set('sessionCount', e.target.valueAsNumber)}
              />
            </Field>

            {schedule && (
              <div className="date-list" aria-live="polite">
                <p className="date-list-head">
                  {answers.sessionCount} sessions ·{' '}
                  {answers.weekdays.map((d) => WEEKDAY_LABELS[d]).join(' & ')}{' '}
                  {clockTime(answers.startTime)}–{clockTime(answers.endTime)} · ends{' '}
                  {shortDate(schedule.endDate)}
                </p>
                <ul>
                  {[...schedule.dates, ...schedule.skipped].sort().map((date) => {
                    const skipped = schedule.skipped.includes(date);
                    const here = skipped ? [] : (clashes.get(date) ?? []);
                    return (
                      <li
                        key={date}
                        className={skipped ? 'skipped' : here.length ? 'clashing' : undefined}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={!skipped}
                            onChange={() => toggleDate(date)}
                          />
                          {shortDate(date)}
                        </label>
                        {here.map((c) => (
                          <span key={c.message} className="date-clash">
                            {c.message}
                          </span>
                        ))}
                      </li>
                    );
                  })}
                </ul>
                <p className="tiny muted">
                  Untick a date to skip it, for a holiday. Another is added at the end, so it
                  stays {answers.sessionCount} sessions.
                </p>
                {errors.clashes && (
                  <p className="field-error" role="alert">
                    {errors.clashes}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {stepName === 'Where and who' && (
          <>
            <LocationField
              locations={locations}
              value={answers.locationId}
              error={errors.locationId}
              onChange={(v) => set('locationId', v)}
            />
            <Field
              label="Meeting point"
              hint="The bit a map cannot give: which door, which room. Optional."
              htmlFor="actMeeting"
            >
              <input
                id="actMeeting"
                maxLength={300}
                value={answers.meetingPoint}
                placeholder="Studio 2, up the stairs on the left"
                onChange={(e) => set('meetingPoint', e.target.value)}
              />
            </Field>
            <StaffField staff={staff} value={answers.staffId} onChange={(v) => set('staffId', v)} />
            <ClashList clashes={clashes} error={errors.clashes} />
          </>
        )}

        {stepName === 'Seats and price' && kind === 'CLASS' && (
          <>
            <div className="form-row">
              <Field label="Adult price" error={errors.price} hint="For the whole class, every session." htmlFor="actPrice">
                <input
                  id="actPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={answers.price}
                  placeholder="0.00"
                  onChange={(e) => set('price', e.target.value)}
                />
              </Field>
              <Field
                label="Child price"
                error={errors.childPrice}
                hint="0 = adults only. Also for the whole class."
                htmlFor="actChildPrice"
              >
                <input
                  id="actChildPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={answers.childPrice}
                  placeholder="0.00"
                  onChange={(e) => set('childPrice', e.target.value)}
                />
              </Field>
              <Field label="Currency" hint="Set for the whole studio, in Settings." htmlFor="actCurrency">
                <input id="actCurrency" value={currency} readOnly disabled />
              </Field>
            </div>
            <div className="form-row">
              <Field
                label="Maximum capacity"
                error={errors.seats}
                hint="Places in the class, adults and children together."
                htmlFor="actSeats"
              >
                <input
                  id="actSeats"
                  type="number"
                  min={1}
                  max={500}
                  value={Number.isNaN(answers.seats) ? '' : answers.seats}
                  onChange={(e) => set('seats', e.target.valueAsNumber)}
                />
              </Field>
              <Field
                label="Minimum guests"
                error={errors.minGuests}
                hint="The smallest party one booking can be. Usually 1."
                htmlFor="actMinGuests"
              >
                <input
                  id="actMinGuests"
                  type="number"
                  min={1}
                  max={500}
                  value={Number.isNaN(answers.minGuests) ? '' : answers.minGuests}
                  onChange={(e) => set('minGuests', e.target.valueAsNumber)}
                />
              </Field>
            </div>
            <div className="form-row">
              <Field
                label="Deposit"
                hint={
                  depositsEnabled === false
                    ? 'Deposits are switched off for your studio, so customers pay in full. Turn them on in Settings.'
                    : 'Taken when they book. The rest is paid on the day.'
                }
                htmlFor="actDepositType"
              >
                <select
                  id="actDepositType"
                  value={answers.depositType}
                  onChange={(e) => set('depositType', e.target.value as ActivityAnswers['depositType'])}
                >
                  <option value="none">Pay in full</option>
                  <option value="percent">Percentage of the price</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </Field>
              {answers.depositType !== 'none' && (
                <Field
                  label={answers.depositType === 'percent' ? 'Percent' : 'Amount per booking'}
                  error={errors.depositValue}
                  htmlFor="actDepositValue"
                >
                  <input
                    id="actDepositValue"
                    type="number"
                    min={answers.depositType === 'percent' ? 1 : 0.01}
                    max={answers.depositType === 'percent' ? 100 : undefined}
                    step={answers.depositType === 'percent' ? 1 : 0.01}
                    value={answers.depositValue}
                    placeholder={answers.depositType === 'percent' ? '25' : '0.00'}
                    onChange={(e) => set('depositValue', e.target.value)}
                  />
                </Field>
              )}
            </div>
          </>
        )}

        {stepName === 'Look' && (
          <>
            <Field label="Icon" hint="Shown on its card. Optional.">
              <div className="chip-group" role="group" aria-label="Icon">
                <button
                  type="button"
                  className={answers.emoji === '' ? 'chip on' : 'chip'}
                  aria-pressed={answers.emoji === ''}
                  onClick={() => set('emoji', '')}
                >
                  None
                </button>
                {EMOJI.map((glyph) => (
                  <button
                    key={glyph}
                    type="button"
                    className={answers.emoji === glyph ? 'chip on' : 'chip'}
                    aria-pressed={answers.emoji === glyph}
                    aria-label={`Icon ${glyph}`}
                    onClick={() => set('emoji', glyph)}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Colour" hint="The card on your booking page, and the block on your calendar.">
              <div className="chip-group" role="group" aria-label="Colour">
                {GRADS.map(([from, to]) => (
                  <button
                    key={from}
                    type="button"
                    className={answers.color === from ? 'chip chip-grad on' : 'chip chip-grad'}
                    aria-pressed={answers.color === from}
                    aria-label={`Colour ${from}`}
                    style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                    onClick={() => {
                      set('color', from);
                      set('colorAccent', to);
                    }}
                  />
                ))}
              </div>
            </Field>
          </>
        )}

        {stepName === 'Policies' && (
          <>
            <Field
              label="Cancellation policy"
              hint={
                policies.length
                  ? 'Shown before they pay, and applied when they cancel.'
                  : 'None set up yet. Add them in Settings.'
              }
              htmlFor="actPolicy"
            >
              <select
                id="actPolicy"
                value={answers.cancellationPolicyId}
                onChange={(e) => set('cancellationPolicyId', e.target.value)}
              >
                <option value="">
                  {policies.some((p) => p.isDefault) ? 'Use the studio default' : 'No policy, free cancellation'}
                </option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-row">
              <Field
                label="Minimum notice (minutes)"
                error={errors.minNoticeMinutes}
                hint="Booking closes this long before the first session. 0: right up to the start."
                htmlFor="actNotice"
              >
                <input
                  id="actNotice"
                  type="number"
                  min={0}
                  max={525_600}
                  value={Number.isNaN(answers.minNoticeMinutes) ? '' : answers.minNoticeMinutes}
                  onChange={(e) => set('minNoticeMinutes', e.target.valueAsNumber)}
                />
              </Field>
              <Field
                label="Bookable up to (days ahead)"
                error={errors.maxHorizonDays}
                hint={horizonHint(answers.maxHorizonDays, schedule?.dates[0], timezone)}
                htmlFor="actHorizon"
              >
                <input
                  id="actHorizon"
                  type="number"
                  min={1}
                  max={730}
                  value={answers.maxHorizonDays}
                  placeholder="Open now"
                  onChange={(e) => set('maxHorizonDays', e.target.value)}
                />
              </Field>
            </div>
          </>
        )}

        {stepName === 'For customers' && (
          <>
            <Field
              label="What is included"
              error={errors.highlights}
              hint="One per line, up to twelve. Shown as a list on your booking page. Optional."
              htmlFor="actHighlights"
            >
              <textarea
                id="actHighlights"
                rows={4}
                maxLength={1200}
                value={answers.highlights}
                placeholder={'Clay, tools and glazes\nFiring for your pieces\nAn apron, if you forget yours'}
                onChange={(e) => set('highlights', e.target.value)}
              />
            </Field>
            <Field
              label="Before you come"
              hint="What to wear or bring. Shown before they book. Optional."
              htmlFor="actPrep"
            >
              <textarea
                id="actPrep"
                rows={3}
                maxLength={2000}
                value={answers.preparationNotes}
                placeholder="Short nails, closed shoes, and clothes you do not mind getting muddy."
                onChange={(e) => set('preparationNotes', e.target.value)}
              />
            </Field>
            <Field
              label="Booking instructions"
              hint="Sent with the confirmation, after they book. Never shown on your booking page. Optional."
              htmlFor="actInstructions"
            >
              <textarea
                id="actInstructions"
                rows={3}
                maxLength={2000}
                value={answers.bookingInstructions}
                placeholder="Park on Kiln Street. If the door is locked, ring the top bell."
                onChange={(e) => set('bookingInstructions', e.target.value)}
              />
            </Field>
          </>
        )}

        {stepName === 'Seats and price' && kind === 'EVENT' && (
          <>
            <div className="form-row">
              <Field label="Seats" error={errors.seats} htmlFor="actSeats">
                <input
                  id="actSeats"
                  type="number"
                  min={1}
                  max={500}
                  value={Number.isNaN(answers.seats) ? '' : answers.seats}
                  onChange={(e) => set('seats', e.target.valueAsNumber)}
                />
              </Field>
              <Field
                label="Price per seat"
                error={errors.price}
                htmlFor="actPrice"
              >
                <input
                  id="actPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={answers.price}
                  placeholder="0.00"
                  onChange={(e) => set('price', e.target.value)}
                />
              </Field>
            </div>
            {kind === 'EVENT' && (
              <>
                <StaffField staff={staff} value={answers.staffId} onChange={(v) => set('staffId', v)} />
                <ClashList clashes={clashes} error={errors.clashes} />
              </>
            )}
          </>
        )}

        {stepName === 'Review' && (
          <>
            <p className="muted">This is how it appears on your booking page.</p>
            <div className="review-card">
              <div className="review-card-kind">{kind === 'CLASS' ? 'Class' : 'Event'}</div>
              <h3>
                {answers.emoji && <span aria-hidden="true">{answers.emoji} </span>}
                {answers.name.trim()}
              </h3>
              {answers.shortDescription.trim() && <p>{answers.shortDescription.trim()}</p>}
              <dl>
                <dt>When</dt>
                <dd>
                  {kind === 'EVENT'
                    ? `${shortDate(answers.date)}, ${clockTime(answers.startTime)}–${clockTime(answers.endTime)}`
                    : schedule
                      ? `${answers.sessionCount} sessions, ${answers.weekdays
                          .map((d) => WEEKDAY_LABELS[d])
                          .join(' & ')} ${clockTime(answers.startTime)}–${clockTime(
                          answers.endTime,
                        )}, ${shortDate(schedule.dates[0]!)} to ${shortDate(schedule.endDate)}`
                      : ''}
                </dd>
                {locationName && (
                  <>
                    <dt>Where</dt>
                    <dd>{locationName}</dd>
                  </>
                )}
                {staffName && (
                  <>
                    <dt>With</dt>
                    <dd>{staffName}</dd>
                  </>
                )}
                <dt>Price</dt>
                <dd>
                  {money(priceCents(answers.price) ?? 0, currency)}
                  {kind === 'CLASS' ? ' for all sessions' : ' per seat'}
                </dd>
                <dt>Seats</dt>
                <dd>{answers.seats}</dd>
                {kind === 'CLASS' && (
                  <ClassReviewRows
                    answers={answers}
                    currency={currency}
                    categoryName={categories.find((c) => c.id === answers.categoryId)?.name}
                    policyName={
                      answers.cancellationPolicyId
                        ? policies.find((p) => p.id === answers.cancellationPolicyId)?.name
                        : policies.find((p) => p.isDefault)?.name
                    }
                  />
                )}
              </dl>
              {kind === 'CLASS' && (
                <p className="tiny muted">
                  Booked once for every session. Missed sessions are not made up.
                </p>
              )}
            </div>
            <ClashList
              clashes={clashes}
              error={
                clashes.size
                  ? 'Fix these before publishing: go back to the step that sets the time, the instructor or where it runs.'
                  : undefined
              }
            />
            {kind === 'CLASS' && (
              <Field
                label="Status"
                hint={
                  answers.isActive
                    ? 'Bookable on your booking page as soon as you publish.'
                    : 'Saved but not on your booking page. Switch it to Active from Activities when you are ready.'
                }
                htmlFor="actStatus"
              >
                <select
                  id="actStatus"
                  value={answers.isActive ? 'active' : 'hidden'}
                  onChange={(e) => set('isActive', e.target.value === 'active')}
                >
                  <option value="active">Active</option>
                  <option value="hidden">Hidden</option>
                </select>
              </Field>
            )}
            {serverError && <div className="err">{serverError}</div>}
          </>
        )}
      </form>
    </Modal>
  );
}

// --- Fields ------------------------------------------------------------------

/** The Class-only answers on Review, each only when it says something. */
function ClassReviewRows({
  answers,
  currency,
  categoryName,
  policyName,
}: {
  answers: ActivityAnswers;
  currency: string;
  categoryName?: string;
  policyName?: string;
}) {
  const child = optionalCents(answers.childPrice) ?? 0;
  const rows: [string, string][] = [];
  rows.push(['Children', child > 0 ? `${money(child, currency)} for all sessions` : 'Adults only']);
  if (answers.minGuests > 1) rows.push(['Smallest booking', `${answers.minGuests} people`]);
  if (answers.depositType === 'percent') rows.push(['Deposit', `${answers.depositValue}% when booking`]);
  if (answers.depositType === 'fixed')
    rows.push(['Deposit', `${money(priceCents(answers.depositValue) ?? 0, currency)} when booking`]);
  if (categoryName) rows.push(['Category', categoryName]);
  if (answers.meetingPoint.trim()) rows.push(['Meeting point', answers.meetingPoint.trim()]);
  rows.push(['Cancellation', policyName ?? 'Free cancellation']);
  rows.push([
    'Booking',
    (answers.maxHorizonDays.trim()
      ? `Opens ${answers.maxHorizonDays} days before the first session`
      : 'Open as soon as it is published') +
      (answers.minNoticeMinutes > 0
        ? `, closes ${answers.minNoticeMinutes} minutes before it`
        : ', closes when it starts'),
  ]);
  return (
    <>
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </>
  );
}

/** Which dates clash and with what, in date order. Nothing when none do. */
function ClashList({ clashes, error }: { clashes: Map<string, Clash[]>; error?: string }) {
  if (clashes.size === 0) return null;
  return (
    <div className="clash-list" role="alert">
      <ul>
        {[...clashes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, list]) =>
            list.map((c) => (
              <li key={`${date}-${c.message}`}>
                <strong>{shortDate(date)}</strong> {c.message}
              </li>
            )),
          )}
      </ul>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting setting-stack step-field">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="step-label">{label}</span>}
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="tiny muted">{hint}</p>
      )}
    </div>
  );
}

function TimeFields({
  answers,
  errors,
  set,
}: {
  answers: ActivityAnswers;
  errors: Errors;
  set: <K extends keyof ActivityAnswers>(key: K, value: ActivityAnswers[K]) => void;
}) {
  return (
    <div className="form-row">
      <Field label="Starts at" htmlFor="actStartTime">
        <input
          id="actStartTime"
          type="time"
          value={answers.startTime}
          onChange={(e) => set('startTime', e.target.value)}
        />
      </Field>
      <Field label="Ends at" error={errors.endTime} htmlFor="actEndTime">
        <input
          id="actEndTime"
          type="time"
          value={answers.endTime}
          onChange={(e) => set('endTime', e.target.value)}
        />
      </Field>
    </div>
  );
}

function LocationField({
  locations,
  value,
  error,
  onChange,
}: {
  locations: Location[];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  if (locations.length === 0) return null;
  return (
    <Field label="Where" error={error} htmlFor="actLocation">
      <select id="actLocation" value={value} onChange={(e) => onChange(e.target.value)}>
        {locations.length > 1 && <option value="">Choose…</option>}
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function StaffField({
  staff,
  value,
  onChange,
}: {
  staff: Staff[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (staff.length === 0) return null;
  return (
    <Field label="Instructor" htmlFor="actStaff" hint="Their time is blocked on every date.">
      <select id="actStaff" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nobody yet</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
