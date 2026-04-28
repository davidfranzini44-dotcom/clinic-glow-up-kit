
-- 1. Swap request enhancements
ALTER TABLE public.appointment_swap_requests
  ADD COLUMN IF NOT EXISTS target_appointment_id text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'one_way';

ALTER TABLE public.appointment_swap_requests
  DROP CONSTRAINT IF EXISTS swap_kind_check;
ALTER TABLE public.appointment_swap_requests
  ADD CONSTRAINT swap_kind_check CHECK (kind IN ('one_way','trade'));

-- 2. Per-appointment lock
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS swap_locked boolean NOT NULL DEFAULT false;

-- 3. App settings (singleton)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY DEFAULT 1,
  swaps_locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads settings" ON public.app_settings;
CREATE POLICY "Anyone reads settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins update settings" ON public.app_settings;
CREATE POLICY "Admins update settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- 4. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own notifications" ON public.notifications;
CREATE POLICY "Read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Update own notifications" ON public.notifications;
CREATE POLICY "Update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin deletes notifications" ON public.notifications;
CREATE POLICY "Admin deletes notifications" ON public.notifications
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

-- 5. Updated swap trigger: handles trades + locks
CREATE OR REPLACE FUNCTION public.apply_swap_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  global_locked boolean;
  src_locked boolean;
  tgt_locked boolean;
BEGIN
  SELECT swaps_locked INTO global_locked FROM public.app_settings WHERE id = 1;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status = 'pending' THEN
    IF NOT (auth.uid() = NEW.to_user_id OR is_admin) THEN
      RAISE EXCEPTION 'Only the addressed employee can approve this swap';
    END IF;
    IF global_locked AND NOT is_admin THEN
      RAISE EXCEPTION 'Swaps are currently locked by admin';
    END IF;

    SELECT swap_locked INTO src_locked FROM public.appointments WHERE id = NEW.appointment_id;
    IF src_locked AND NOT is_admin THEN
      RAISE EXCEPTION 'This appointment is locked by admin';
    END IF;

    IF NEW.kind = 'trade' AND NEW.target_appointment_id IS NOT NULL THEN
      SELECT swap_locked INTO tgt_locked FROM public.appointments WHERE id = NEW.target_appointment_id;
      IF tgt_locked AND NOT is_admin THEN
        RAISE EXCEPTION 'Target appointment is locked by admin';
      END IF;

      UPDATE public.appointments
         SET employee = NEW.to_employee,
             changed = COALESCE(NULLIF(changed,''),'') ||
                       CASE WHEN COALESCE(changed,'') = '' THEN '' ELSE '; ' END ||
                       'swap-trade:' || NEW.from_employee || '↔' || NEW.to_employee
       WHERE id = NEW.appointment_id;

      UPDATE public.appointments
         SET employee = NEW.from_employee,
             changed = COALESCE(NULLIF(changed,''),'') ||
                       CASE WHEN COALESCE(changed,'') = '' THEN '' ELSE '; ' END ||
                       'swap-trade:' || NEW.to_employee || '↔' || NEW.from_employee
       WHERE id = NEW.target_appointment_id;
    ELSE
      UPDATE public.appointments
         SET employee = NEW.to_employee,
             changed = COALESCE(NULLIF(changed,''),'') ||
                       CASE WHEN COALESCE(changed,'') = '' THEN '' ELSE '; ' END ||
                       'swap:' || NEW.from_employee || '→' || NEW.to_employee
       WHERE id = NEW.appointment_id;
    END IF;

    NEW.responded_at := now();

  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    IF NOT (auth.uid() = NEW.to_user_id OR is_admin) THEN
      RAISE EXCEPTION 'Only the addressed employee can reject this swap';
    END IF;
    NEW.responded_at := now();

  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'pending' THEN
    IF NOT (auth.uid() = NEW.from_user_id OR is_admin) THEN
      RAISE EXCEPTION 'Only the requester can cancel this swap';
    END IF;
    NEW.responded_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apply_swap_on_approve ON public.appointment_swap_requests;
CREATE TRIGGER trg_apply_swap_on_approve
  BEFORE UPDATE ON public.appointment_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.apply_swap_on_approve();

-- 6. Block insert if locked
CREATE OR REPLACE FUNCTION public.check_swap_lock_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  global_locked boolean;
  src_locked boolean;
  tgt_locked boolean;
BEGIN
  SELECT swaps_locked INTO global_locked FROM public.app_settings WHERE id = 1;
  IF global_locked AND NOT is_admin THEN
    RAISE EXCEPTION 'Swaps are currently locked by admin';
  END IF;
  SELECT swap_locked INTO src_locked FROM public.appointments WHERE id = NEW.appointment_id;
  IF src_locked AND NOT is_admin THEN
    RAISE EXCEPTION 'This appointment is locked by admin';
  END IF;
  IF NEW.target_appointment_id IS NOT NULL THEN
    SELECT swap_locked INTO tgt_locked FROM public.appointments WHERE id = NEW.target_appointment_id;
    IF tgt_locked AND NOT is_admin THEN
      RAISE EXCEPTION 'Target appointment is locked by admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_swap_lock_on_insert ON public.appointment_swap_requests;
CREATE TRIGGER trg_check_swap_lock_on_insert
  BEFORE INSERT ON public.appointment_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.check_swap_lock_on_insert();

-- 7. Notification triggers
CREATE OR REPLACE FUNCTION public.notify_swap_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (NEW.to_user_id, 'swap_requested',
            'Nueva solicitud de cambio',
            NEW.from_employee || ' te pidió un cambio',
            'swaps');
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF NEW.status = 'approved' THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link)
      VALUES (NEW.from_user_id, 'swap_approved',
              'Cambio aprobado',
              NEW.to_employee || ' aprobó tu cambio',
              'swaps');
    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link)
      VALUES (NEW.from_user_id, 'swap_rejected',
              'Cambio rechazado',
              NEW.to_employee || ' rechazó tu cambio',
              'swaps');
    ELSIF NEW.status = 'cancelled' THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link)
      VALUES (NEW.to_user_id, 'swap_cancelled',
              'Cambio cancelado',
              NEW.from_employee || ' canceló su solicitud',
              'swaps');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_swap_event ON public.appointment_swap_requests;
CREATE TRIGGER trg_notify_swap_event
  AFTER INSERT OR UPDATE ON public.appointment_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_swap_event();

CREATE OR REPLACE FUNCTION public.notify_appointment_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_uid uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.employee IS DISTINCT FROM OLD.employee AND NEW.employee IS NOT NULL THEN
    SELECT id INTO target_uid FROM public.profiles WHERE employee_name = NEW.employee LIMIT 1;
    IF target_uid IS NOT NULL AND target_uid <> auth.uid() THEN
      INSERT INTO public.notifications (user_id, kind, title, body, link)
      VALUES (target_uid, 'appointment_assigned',
              'Nueva cita asignada',
              NEW.client || ' a las ' || NEW.time || ' (' || NEW.date || ')',
              'date:' || NEW.date::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_appointment_assigned ON public.appointments;
CREATE TRIGGER trg_notify_appointment_assigned
  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_appointment_assigned();

CREATE OR REPLACE FUNCTION public.notify_lock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.swaps_locked IS DISTINCT FROM OLD.swaps_locked THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    SELECT p.id, 'swap_lock_changed',
           CASE WHEN NEW.swaps_locked THEN 'Cambios bloqueados' ELSE 'Cambios desbloqueados' END,
           CASE WHEN NEW.swaps_locked
                THEN 'El admin bloqueó las solicitudes de cambio'
                ELSE 'El admin desbloqueó las solicitudes de cambio' END,
           'swaps'
      FROM public.profiles p
     WHERE p.id <> auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_lock_change ON public.app_settings;
CREATE TRIGGER trg_notify_lock_change
  AFTER UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.notify_lock_change();

-- 8. Realtime
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;
ALTER TABLE public.appointment_swap_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_swap_requests; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
