// Sends web push notifications for new rows in public.notifications.
// Called by a database trigger (pg_net) with { record: <notification row> }.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: cfg } = await supabase.from("push_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg) return new Response("push not configured", { status: 500 });
    if (req.headers.get("x-push-secret") !== cfg.webhook_secret) {
      return new Response("forbidden", { status: 403 });
    }

    const body = await req.json();
    const rec = body.record ?? body;
    if (!rec?.user_id || !rec?.title) return new Response("bad payload", { status: 400 });

    webpush.setVapidDetails("mailto:davidfranzini44@gmail.com", cfg.vapid_public, cfg.vapid_private);

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", rec.user_id);
    if (!subs || subs.length === 0) return new Response("no subscriptions", { status: 200 });

    const payload = JSON.stringify({ title: rec.title, body: rec.body ?? "", link: rec.link ?? "" });
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
      )
    );

    let sent = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") { sent++; continue; }
      const code = (r.reason as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subs[i].endpoint);
      }
    }
    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("error: " + (e as Error).message, { status: 500 });
  }
});
