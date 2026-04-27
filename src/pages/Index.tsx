import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import CharmScheduler, { type Profile } from "@/components/CharmScheduler";

export default function Index() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Subscribe FIRST (avoids missed events), then check current session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        // Defer DB calls to avoid deadlocks inside the auth callback
        setTimeout(() => loadUser(s.user.id), 0);
      } else {
        setProfile(null);
        setIsAdmin(false);
        setLoading(false);
        navigate("/auth", { replace: true });
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) loadUser(s.user.id);
      else { setLoading(false); navigate("/auth", { replace: true }); }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUser = async (userId: string) => {
    setLoading(true);
    try {
      const [{ data: prof, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, employee_name").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      setProfile(prof || { id: userId, display_name: null, employee_name: null });
      setIsAdmin((roles || []).some(r => r.role === "admin"));
    } catch (e) {
      console.error("loadUser error", e);
      setProfile({ id: userId, display_name: null, employee_name: null });
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading || !session || !profile) {
    return (
      <main className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-display text-primary" style={{ fontSize: 48 }}>Charm</h1>
          <div className="text-xs font-label text-accent mt-2">CARGANDO…</div>
        </div>
      </main>
    );
  }

  return (
    <CharmScheduler session={session} profile={profile} isAdmin={isAdmin} onSignOut={handleSignOut} />
  );
}
