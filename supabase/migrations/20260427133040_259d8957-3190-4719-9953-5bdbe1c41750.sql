
-- Fix search_path on the remaining functions
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;

-- Revoke broad EXECUTE on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM anon, public;
-- has_role still needs to be callable by authenticated (used inside RLS policies)
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO authenticated;
