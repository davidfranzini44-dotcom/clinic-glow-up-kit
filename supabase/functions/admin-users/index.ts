// Admin-only user management: permanently delete a user (auth account + all data).
// Caller must be an authenticated Charm admin; verified server-side.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // identify + authorize the caller
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: caller } = await sb.auth.getUser(jwt);
    if (!caller?.user) return json({ error: "no autenticado" }, 401);
    const { data: adminRow } = await sb.from("user_roles").select("user_id")
      .eq("user_id", caller.user.id).eq("role", "admin").maybeSingle();
    if (!adminRow) return json({ error: "solo administradores" }, 403);

    const { action, user_id, password } = await req.json();

    if (action === "list") {
      const { data: list, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 500 });
      if (error) return json({ error: error.message }, 500);
      return json({
        ok: true,
        users: list.users.map((u) => ({ id: u.id, email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null, created_at: u.created_at })),
      });
    }

    if (action === "set_password") {
      if (!user_id || typeof password !== "string" || password.length < 6) {
        return json({ error: "Contraseña inválida (mínimo 6 caracteres)." }, 400);
      }
      if (user_id !== caller.user.id) {
        const { data: tgtAdmin } = await sb.from("user_roles").select("user_id")
          .eq("user_id", user_id).eq("role", "admin").maybeSingle();
        if (tgtAdmin) return json({ error: "No puedes cambiar la contraseña de otra administradora." }, 400);
      }
      const { error } = await sb.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action !== "delete" || !user_id) return json({ error: "petición inválida" }, 400);
    if (user_id === caller.user.id) return json({ error: "No puedes eliminar tu propia cuenta." }, 400);

    // make sure we never delete another admin by accident
    const { data: targetAdmin } = await sb.from("user_roles").select("user_id")
      .eq("user_id", user_id).eq("role", "admin").maybeSingle();
    if (targetAdmin) return json({ error: "Quítale el rol de admin antes de eliminar esta cuenta." }, 400);

    // remove all data tied to the user
    for (const t of ["notifications", "push_subscriptions", "user_permissions", "employee_requests", "user_roles"]) {
      await sb.from(t).delete().eq("user_id", user_id);
    }
    await sb.from("profiles").delete().eq("id", user_id);

    const { error } = await sb.auth.admin.deleteUser(user_id);
    if (error) return json({ error: "auth: " + error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
