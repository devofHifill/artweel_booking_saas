# Add staff in steps: plan

Status: **Phase 1 deployed 2026-11-11** (PR #62): adding in steps, with the login invite on Review, ticked by default. **Phase 2 built 2026-11-11** (branch `feat/edit-staff-steps`): Edit opens the same steps, all reachable, "Save changes" on each; details, activities and locations saved in one PATCH; the Hours step shows their week and offers "Save and open Hours" rather than re-asking it.

## Why

Today, **Add staff** is one long form on the Staff & Guides page. It saves a
person, but not someone who can be booked yet. Three things live elsewhere:

- **What they teach.** These are chips on their card, saved afterwards.
- **Their working hours.** These are set in a separate Hours panel.
  - Until hours are set, the person shows **"No hours set"**, and no customer
    can book them.
  - Only the first instructor gets hours from onboarding. Everyone added later
    starts with none.
- **A login.** Invitations exist on the server (`POST /:orgId/invitations`,
  role INSTRUCTOR). When the invite is accepted, the login is linked to the
  staff record by email. Nothing on this page offers it.

Create activity already works in short steps (What › When and where › … ›
Review). Add staff should feel the same, and end with someone who can actually
be booked.

## The steps

| # | Step | Asks | Notes |
|---|------|------|-------|
| 1 | **Who** | Name, email, phone (optional), role ("Wheel instructor") | Check the plan limit *before* step 1. A Solo studio already at one active instructor sees the upgrade message, not a form it cannot save. |
| 2 | **What they teach** | Activity chips; **Works at** location chips | Both lists come from data already loaded on the page. Skip it if there's nothing to pick: say "You can choose this later". |
| 3 | **Hours** | Days + start/end time; timezone ("Same as the studio") | Default to the same Tue–Sat 10:00–18:00 as the Hours panel. Allow "Set hours later", with the warning that they can't be booked until hours are set. Days off stay in the Hours panel. |
| 4 | **Profile** | Photo + description (ImagePicker), short bio, calendar colour, "Show on the booking page" | Adds **bio**: the server already accepts it (`bio`, up to 4000 chars), but no screen sets it. Max bookings a day goes under "More options". |
| 5 | **Review** | A summary card like the one on the booking page, plus a **Send them a login invite** tick box | "Add" saves. If the invite is ticked, it's sent afterwards and the invite link is shown, so the owner can pass it on by hand. |

There's Back / Next at the bottom. The step names along the top can be clicked
once a step has been reached. This is the same pattern and the same CSS as
`CreateActivity.tsx`.

## Saving: one request, no half-made instructors

Today a new person takes several calls: `POST /staff`, then
`PUT /staff/:id/services`, then hours rules one by one. If a later call fails,
you're left with a person who has no hours and no activities.

**Server.** Extend `createStaff` (`server/src/modules/staff/staff.service.ts`)
and its schema (`staff.route.ts`) to accept two more fields, and save them in
one transaction:

- `serviceTypeIds?: string[]`. Each must belong to this studio, the same check
  `PUT /staff/:id/services` makes.
- `weeklyHours?: { days: ('MO'…'SU')[], start: 'HH:MM', end: 'HH:MM' }`. Turn
  it into the same rules `POST /schedules/:staffId/rules` creates. Reuse that
  service function; don't copy it.

The old form keeps working (both fields are optional), so the change can ship
before the client uses it.

**Invite.** It's sent only after the person is saved, as its own call. If it
fails, the new person is still added. The Review step shows "Added — the
invite didn't send" with a Retry.

## Editing

**Phase 1** builds the steps for **adding** only. Edit stays the current form,
plus a **Bio** field so bio can be changed afterwards.

**Phase 2 (optional)** is editing in the same steps, any of them reachable
straight away. This is how editing an activity already works
(`6913770 Edit a Class or Event in the steps it was made in`).

## Files

- `client/src/components/AddStaff.tsx` (new). The step dialog uses the
  `Modal` from `layout`, like CreateActivity.
- `client/src/pages/Staff.tsx`: "Add staff" opens the dialog. The inline form
  is kept for Edit and gains Bio.
- `server/src/modules/staff/staff.route.ts` and `staff.service.ts`: the two
  new optional fields.
- `client/src/guides/staff.md`: the guide describes the new flow.
- `docs/CLIENT-FEEDBACK.md`: add a row.

## Tests

The server tests go in `server/tests/admin/` (next to `staff-links`,
`staff-delete` and `setup-instructor`). They cover:

- creating someone with activities and hours in one call, after which their
  availability is AVAILABLE, not NO_HOURS;
- an activity id from another studio being refused, with nothing saved;
- bad hours (end before start, no days) being refused, with nothing saved;
- the plan limit still applying;
- the old body (without the new fields) still working.

Check the client in the browser locally:

- add someone through every step;
- skip hours;
- hit the Solo limit;
- check it at phone width.

## Decisions for Suren

1. **Invite step.** Should step 5 offer the login invite, or leave invites
   where they are?
2. **Editing in steps.** Is Phase 2 wanted, or is Phase 1 (adding only)
   enough?
