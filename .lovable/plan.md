# Plan: Smart Swaps + Notifications + Search + Admin Lock + Save Button

Five connected upgrades. The save button addresses a real bug discovered while exploring: autosave is silently failing in some cases.

---

## 0. Why "things aren't being saved" (root cause)

`updateApt()` calls `saveApt()` which does `supabase.from("appointments").upsert(...)`. This **silently fails** when:

- The logged-in user's `profiles.employee_name` is `null` (your account, Lisa/Fiordaliza, currently has `employee_name = null` — confirmed in network logs). RLS requires `profiles.employee_name = appointments.employee` to update.
- An employee tries to edit an appointment assigned to a coworker.
- Network drops mid-save.

The current toast just flashes "saving → saved/error" briefly with no detail and no retry. Local state still updates, so the UI looks fine until refresh — at which point changes are gone.

### Fix

1. **Backfill `employee_name` on profiles** — add a small admin tool (in admin Reportes/header dropdown) to set each user's `employee_name` (Yaira / Belkis / Cielo / Lisa). Show a banner when the logged-in user has no `employee_name` set: "Tu cuenta no está vinculada a una empleada. Pide al admin que te asigne."
2. **Pending-changes queue + Save button** — autosave still runs, but failed/in-flight saves go into a `pendingChanges` set. A persistent **Guardar (N)** button appears in the top bar whenever `pendingChanges.size > 0`, showing the count and last error. Click → retries all pending upserts and shows a clear toast on success or per-row failure.
3. **Hard error toast on failure** — replace the silent `saveStatus = "error"` flash with a sonner error toast that includes the actual Postgres message (e.g. "permission denied for table appointments").
4. **Reload-on-mount sanity check** — after saving, refetch the affected rows from the DB and reconcile local state; if any didn't persist, push them into `pendingChanges`.
5. **Beforeunload guard** — if `pendingChanges.size > 0` and the user closes the tab, browser asks "Hay cambios sin guardar, ¿salir?".

---

## 1. Smarter swap requests (with conflict detection)

Lisa picks coworker → sees Yaira's same-day appointments → optionally picks one back to propose a real **trade**. One-way "gift" swap still possible.

### Data model

Add to `appointment_swap_requests`:

| column | type |
|---|---|
| `target_appointment_id` | text nullable |
| `kind` | text default `'one_way'` (`'one_way'` or `'trade'`) |

`apply_swap_on_approve()` updated: when `kind = 'trade'` and approved, swap `employee` on both appointments atomically; log `swap-trade:Lisa↔Yaira` in `changed`.

### Conflict warning

Before submit and on approver's view, query both employees' appointments for that date. Yellow banner if reassigning would double-book either employee (e.g. "⚠ Yaira ya tiene cita a las 3 PM con María"). Advisory only.

---

## 2. Admin lock on swaps

- **Global lock**: `app_settings` row `swaps_locked = true/false`. Admin toggle in Solicitudes header. When on, employees can't request, approve, or cancel — admin can.
- **Per-appointment lock**: new column `appointments.swap_locked`. Admin gets a small lock icon on each appointment. DB triggers reject employee swap actions on locked rows.
- Admin always overrides locks.

---

## 3. In-app notifications

Bell icon in top bar with unread badge → dropdown panel → click row jumps to view + marks read.

### Triggers (in-app + realtime, no email)

- Swap requested / approved / rejected / cancelled (notify the other party).
- Appointment newly assigned to you, or your appointment cancelled / no-show toggled.
- Swap lock toggled (admin → all employees).
- **Save failed** for someone editing your appointment (optional, low priority).

### Data model

`notifications` table: `id, user_id, kind, title, body, link, read_at, created_at`. RLS: SELECT/UPDATE own only; INSERT only via `SECURITY DEFINER` triggers. Added to realtime; sonner toast fires on each new row while app is open.

---

## 4. Global search bar

Top-bar search box + `⌘K` / `Ctrl+K` opens a `<CommandDialog>` (existing `cmdk`). Searches:

- **Clients** — name across appointments → opens that day's agenda scrolled to the row.
- **Employees** — Yaira / Belkis / Cielo / Lisa → individual view filtered.
- **Dates** — `2026-04-30` or `30/04` → opens that day.
- **Swap requests** — by client or coworker → opens Solicitudes.
- **Quick actions** — "Subir Excel", "Nueva cita", "Cerrar sesión", admin-only "Bloquear/Desbloquear cambios", "Guardar pendientes".

Data fetched on open (last 6 months of appointments + active swaps, capped 1000), filtered client-side.

---

## Files touched

- `supabase/migrations/<new>.sql` — swap columns + trigger update; `notifications` table + RLS + triggers; `app_settings` table + RLS; `appointments.swap_locked` column; realtime publications.
- `src/components/CharmScheduler.tsx` — pending-changes queue, **Guardar (N)** button, beforeunload guard, employee-name banner, top bar gets bell + search, admin lock toggle UI, per-appointment lock icon, sonner error toasts.
- `src/components/SwapRequests.tsx` — step-2 picker, conflict banner, trade rendering, lock-aware UI.
- `src/components/NotificationBell.tsx` (new).
- `src/components/GlobalSearch.tsx` (new).
- `src/integrations/supabase/types.ts` — regenerated automatically.

---

## Out of scope

- Email/push notifications.
- Hard-blocking conflicting swaps (warn only).
- Searching inside report exports.
- Per-employee swap lock (only global + per-appointment).
