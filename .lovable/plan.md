# Shift Swap Requests

Allow an employee to request that a coworker take one of their assigned appointments. The target coworker sees the request and can **approve** (the appointment is reassigned to them) or **reject** (nothing changes). Both parties see live status updates.

## User flow

1. In the **Individual / Mi agenda** view, each appointment assigned to the logged-in employee gets a new **"Solicitar cambio"** button.
2. Clicking it opens a dialog:
   - Shows the appointment (client, date, time).
   - Dropdown: pick a coworker (other active employees: Yaira, Belkis, Cielo, Lisa — excluding self).
   - Optional note (e.g. "¿Me cambias este 3PM por tu 4PM?").
   - Submit → creates a pending swap request.
3. A new **"Solicitudes"** tab appears in the nav with a badge showing pending count addressed to me.
4. In **Solicitudes** the employee sees two lists:
   - **Recibidas** (pending, from coworkers) → buttons **Aprobar** / **Rechazar**.
   - **Enviadas** (mine) → status (pendiente / aprobada / rechazada / cancelada) + **Cancelar** while pending.
5. On **Aprobar**: the appointment's `employee` is updated to the approver, request marked `approved`. The original requester sees it disappear from their agenda in real time; approver sees it appear.
6. On **Rechazar**: request marked `rejected`, appointment unchanged.
7. Toast notifications on all state changes. Admins can see all swap requests in the same tab (read-only overview).

## Data model

New table `appointment_swap_requests`:

| column | type | notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| appointment_id | text | FK-style ref to `appointments.id` |
| from_user_id | uuid | requester (auth.uid) |
| from_employee | text | snapshot of requester's employee name |
| to_user_id | uuid | target coworker's user id |
| to_employee | text | snapshot of target's employee name |
| note | text nullable | |
| status | text | `pending` \| `approved` \| `rejected` \| `cancelled` |
| created_at | timestamptz | now() |
| responded_at | timestamptz nullable | |

Indexes on `(to_user_id, status)` and `(from_user_id, status)`.

### RLS policies

- **SELECT**: requester OR target OR admin.
- **INSERT**: authenticated user where `from_user_id = auth.uid()` AND requester is the current employee assigned to the appointment (validated in trigger too).
- **UPDATE**:
  - Target may move `pending → approved | rejected` (only their own row).
  - Requester may move `pending → cancelled`.
  - Admin can do anything.
- **DELETE**: admin only.

### Approval side-effect (DB trigger)

A `BEFORE UPDATE` trigger on `appointment_swap_requests`: when status changes to `approved`, update `appointments.employee = NEW.to_employee` for `appointment_id`, and set `responded_at = now()`. This keeps the swap atomic and avoids needing the approver to also have row-level update permission on someone else's appointment via the client.

The existing appointments RLS ("Admin or assigned employee updates") stays intact; the trigger runs as `SECURITY DEFINER` so the swap update succeeds regardless.

### Realtime

Enable realtime publication for `appointment_swap_requests` (and confirm `appointments` is on it) so both parties see updates without refresh.

## UI / code changes

- **`src/components/CharmScheduler.tsx`**
  - Extend `view` union to include `"swaps"`.
  - Add a "Solicitar cambio" button on each appointment row in the individual view (only when `appt.employee === myEmployee` and not cancelled / past).
  - Add `<TabBtn>` for "Solicitudes" with pending-count badge for both admins and employees.
  - Subscribe to `appointment_swap_requests` realtime; refetch counts and lists.
- **`src/components/SwapRequestDialog.tsx`** (new) — dialog to create a request (coworker select + note).
- **`src/components/SwapRequestsView.tsx`** (new) — Recibidas / Enviadas lists with Aprobar / Rechazar / Cancelar actions and status badges. Admin sees an additional "Todas" list.
- Toasts via existing `use-toast`.
- Styling reuses cocoa/crema palette and existing card / button components.

## Migration

One SQL migration creates the enum (or text+check), the table, indexes, RLS policies, the `apply_swap_on_approve()` SECURITY DEFINER trigger, and adds the table to `supabase_realtime`.

## Out of scope

- Email / push notifications (in-app + realtime only for now).
- Swapping two specific appointments at once (this version reassigns one appointment; if both employees want a true 1-for-1 trade they create two requests).
- History export of swaps (can be added to Reportes later).
