/**
 * One status vocabulary for activities (FB-14).
 *
 * The same states were called four things: an unfinished draft was a
 * "draft", a saved activity off the booking page was "Inactive" on its card,
 * "Hidden" in Create activity, "Draft" in the older editor's status menu and
 * "Switched off" on the tiles, and one on the page was "Active". An owner who
 * had "published" something and then saw "Inactive" could not tell what had
 * happened. Every screen now uses these three words, from here.
 */
export const ACTIVITY_STATUS = {
  DRAFT: {
    label: 'Draft',
    /** The `.tag.X` colour, from the existing StatusPill palette. */
    tone: 'PENDING',
    hint: 'Not finished yet, so not saved as an activity. Continue it to publish.',
  },
  HIDDEN: {
    label: 'Hidden',
    tone: 'DRAFT', // the muted grey pill
    hint: 'Saved, but not on your booking page. Customers cannot book it.',
  },
  PUBLISHED: {
    label: 'Published',
    tone: 'PUBLISHED',
    hint: 'On your booking page. Customers can book it.',
  },
} as const;

export type ActivityStatus = (typeof ACTIVITY_STATUS)[keyof typeof ACTIVITY_STATUS];

/** A saved activity's status. Unfinished drafts are listed separately. */
export function activityStatus(svc: { isActive?: boolean | null }): ActivityStatus {
  return svc.isActive === false ? ACTIVITY_STATUS.HIDDEN : ACTIVITY_STATUS.PUBLISHED;
}
