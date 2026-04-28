
REVOKE EXECUTE ON FUNCTION public.apply_swap_on_approve() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.check_swap_lock_on_insert() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_swap_event() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_appointment_assigned() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_lock_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;
