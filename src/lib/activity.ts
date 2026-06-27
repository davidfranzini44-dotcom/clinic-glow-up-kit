import { supabase } from "@/integrations/supabase/client";

// Lightweight activity logging into public.activity_log.
// The actor is set once after login so call sites don't need to thread it.
let actor: { userId: string; userName: string } | null = null;

export function setActivityActor(userId: string, userName: string) {
  actor = { userId, userName: userName || "Usuario" };
}

/**
 * Record an activity. Fire-and-forget; never throws into the UI.
 * Pass { once: "key" } to log at most once per browser session
 * (used for passive events like opening the app or viewing a section).
 */
export function logActivity(
  action: string,
  table: string,
  summary: string,
  opts?: { once?: string },
): void {
  if (!actor) return;
  if (opts?.once) {
    try {
      const k = "charm_act_" + opts.once;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch { /* sessionStorage unavailable — log anyway */ }
  }
  const row = {
    user_id: actor.userId,
    user_name: actor.userName,
    action,
    table_name: table,
    summary,
  };
  void supabase
    .from("activity_log")
    .insert(row)
    .then(({ error }) => { if (error) console.debug("activity_log:", error.message); });
}

export const VIEW_LABELS: Record<string, string> = {
  schedule: "la Agenda",
  individual: "la agenda individual",
  reports: "Reportes",
  swaps: "Solicitudes",
  clients: "Clientes",
  inventory: "Inventario",
  history: "Historial",
  settings: "Ajustes",
  profile: "su perfil",
  sales: "Ventas",
};
