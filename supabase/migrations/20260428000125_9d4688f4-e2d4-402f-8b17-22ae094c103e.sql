
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.swap_status AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.appointment_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id text NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL,
  from_employee text NOT NULL,
  to_user_id uuid NOT NULL,
  to_employee text NOT NULL,
  note text,
  status public.swap_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_swap_to_status ON public.appointment_swap_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_from_status ON public.appointment_swap_requests(from_user_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_appointment ON public.appointment_swap_requests(appointment_id);

ALTER TABLE public.appointment_swap_requests ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "View own or addressed swaps"
  ON public.appointment_swap_requests FOR SELECT
  TO authenticated
  USING (
    from_user_id = auth.uid()
    OR to_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Requester creates swap for own appointment"
  ON public.appointment_swap_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND from_user_id <> to_user_id
    AND EXISTS (
      SELECT 1
      FROM public.appointments a
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE a.id = appointment_id
        AND a.employee = p.employee_name
        AND p.employee_name = from_employee
    )
  );

CREATE POLICY "Target or requester or admin updates swap"
  ON public.appointment_swap_requests FOR UPDATE
  TO authenticated
  USING (
    to_user_id = auth.uid()
    OR from_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    to_user_id = auth.uid()
    OR from_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Admin deletes swaps"
  ON public.appointment_swap_requests FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger: when approved, reassign appointment
CREATE OR REPLACE FUNCTION public.apply_swap_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status = 'pending' THEN
    -- Only the target coworker (or admin) may approve
    IF NOT (auth.uid() = NEW.to_user_id OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
      RAISE EXCEPTION 'Only the addressed employee can approve this swap';
    END IF;

    UPDATE public.appointments
       SET employee = NEW.to_employee,
           changed = COALESCE(NULLIF(changed,''),'') || CASE WHEN COALESCE(changed,'') = '' THEN '' ELSE '; ' END || 'swap:' || NEW.from_employee || '→' || NEW.to_employee
     WHERE id = NEW.appointment_id;

    NEW.responded_at := now();
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    IF NOT (auth.uid() = NEW.to_user_id OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
      RAISE EXCEPTION 'Only the addressed employee can reject this swap';
    END IF;
    NEW.responded_at := now();
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status = 'pending' THEN
    IF NOT (auth.uid() = NEW.from_user_id OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
      RAISE EXCEPTION 'Only the requester can cancel this swap';
    END IF;
    NEW.responded_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_swap_on_approve ON public.appointment_swap_requests;
CREATE TRIGGER trg_apply_swap_on_approve
BEFORE UPDATE ON public.appointment_swap_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_swap_on_approve();

-- Realtime
ALTER TABLE public.appointment_swap_requests REPLICA IDENTITY FULL;
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_swap_requests';
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments';
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
