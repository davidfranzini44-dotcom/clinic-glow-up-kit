import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BNA3FmyrynuTDqmXew9w9UMxWZ1iBLLul6weQPQiQFvk6GABZTeTnDn1lSK4yu6CT-_3g7BRgvzd2-QZyipN_gY";

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export const pushSupported = (): boolean =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Register the SW and store this device's push subscription. Safe to call repeatedly. */
export const ensurePushSubscription = async (userId: string): Promise<boolean> => {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: "endpoint" }
    );
    return !error;
  } catch (e) {
    console.error("push subscribe failed:", e);
    return false;
  }
};
