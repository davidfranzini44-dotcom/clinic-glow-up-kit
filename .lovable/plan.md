# Plan: Separate history from active agenda

## Goal
Re-import the full agenda history (start → April 26, 2026) but make sure historical days **never appear** as selectable date tabs in the main agenda. The main agenda tab strip should only show the current operational week (Mon–Sat, from April 27, 2026 onward). History stays accessible from a new "Historial" view (calendar-driven) and from the client profile modal as it does today.

## Confirm before implementing
You said the date cutoff is "April 27th and on" for the main agenda. I'll treat **2026-04-27** as the first visible date on the main scheduler and anything `<= 2026-04-26` as history.

## Changes

### 1. Re-import history (database)
- Please re-upload the same `Appointmentv1s.csv` (or updated version). I'll re-run the import:
  - `DELETE FROM appointments WHERE date <= '2026-04-26'` (so we don't double-insert from the prior import).
  - Bulk-insert all rows with `id` prefixed `hist-` so they're easy to identify.
- No schema changes required. The existing `appointments` table already holds them.

### 2. Hide history from main scheduler tabs (`src/components/CharmScheduler.tsx`)
- Add a constant `HISTORY_CUTOFF = "2026-04-26"`.
- Change `sortedDates` (line 478) to filter: only dates `> HISTORY_CUTOFF` show up in the date-tab strip and in the export/copy flows triggered from the main agenda.
- Update the initial `setActiveDate` logic (lines 299–303) so it only auto-selects from the visible (non-history) dates. If "today" isn't in the visible set, pick the first visible date.
- Realtime insert handler (lines 317–322) stays unchanged — historical rows arriving from realtime simply won't render in the tab strip because of the filter.
- Existing scheduling, swap, walk-in, and save logic is **not touched**. The full `days` map still contains everything so nothing breaks; only the rendered tab strip is filtered.

### 3. New "Historial" view
- Add a new value to the `view` state union: `"history"`.
- Add a tab button "Historial" in the admin nav (next to "Agenda").
- Build a small `HistoryView` section inside `CharmScheduler.tsx` (or a new `src/components/HistoryView.tsx` if cleaner) that renders:
  - A **shadcn Calendar** (`src/components/ui/calendar.tsx`) limited to dates `<= 2026-04-26` (use the `disabled` prop to grey out future dates).
  - When a date is picked, show a read-only list of that day's appointments (client, time, employee, status, the `changed`/notes field). Reuse the existing `Apt` rendering style but without edit/toggle controls.
  - Clicking a client name opens the existing `ClientProfileModal` (already wired).
- Data source: reuse the in-memory `days` map already loaded — no extra query needed.

### 4. Client profile modal — unchanged
The modal already queries all appointments by client name, so the imported history continues to surface there automatically. No code change needed.

## Out of scope / preserved
- No changes to the schema, RLS, or any active scheduling/swap logic.
- The "Mi agenda" (individual employee) view continues to use the same filtered `sortedDates`, so historical dates won't appear there either.
- Sales, Inventory, Reports, Swaps untouched.

## Technical summary
- File edits: `src/components/CharmScheduler.tsx` (filter `sortedDates`, add `view === "history"` branch, add tab button).
- New optional file: `src/components/HistoryView.tsx` (calendar + day list).
- Migration: one `DELETE` + bulk insert from re-uploaded CSV.
- No edits to: `client.ts`, `types.ts`, `ClientProfileModal.tsx`, RLS policies.

## What I need from you
1. Approve this plan.
2. Re-upload the history CSV in the next message so I can run the import.
