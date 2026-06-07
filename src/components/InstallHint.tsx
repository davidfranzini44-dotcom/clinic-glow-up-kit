import { useEffect, useState } from "react";
import { X, Share, Download, Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription } from "@/lib/push";

const NOTIF_KEY = "charm_notif_prompt_dismissed_at";
const INSTALL_KEY = "charm_install_prompt_dismissed_at";
const NOTIF_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const snoozed = (key: string, ms: number): boolean => {
  try {
    const v = localStorage.getItem(key);
    return !!v && Date.now() - parseInt(v) < ms;
  } catch { return false; }
};
const snooze = (key: string) => {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
};

export default function InstallHint() {
  const [bar, setBar] = useState<"none" | "notif" | "install">("none");
  const [isIOS, setIsIOS] = useState(false);
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || !!nav.standalone;
    const ua = navigator.userAgent || "";
    const ios = /iphone|ipad|ipod/i.test(ua);
    const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
    setIsIOS(ios);

    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", onBIP);

    const notifPossible = "Notification" in window && "serviceWorker" in navigator;
    const wantNotif = notifPossible && Notification.permission === "default" && !snoozed(NOTIF_KEY, NOTIF_SNOOZE_MS);
    const wantInstall = !standalone && mobile && !snoozed(INSTALL_KEY, INSTALL_SNOOZE_MS);

    let next: "none" | "notif" | "install" = "none";
    if (ios && wantInstall) next = "install";          // iOS needs install before notifications
    else if (wantNotif) next = "notif";
    else if (wantInstall) next = "install";

    const t = setTimeout(() => setBar(next), 1500);
    return () => { window.removeEventListener("beforeinstallprompt", onBIP); clearTimeout(t); };
  }, []);

  const dismiss = () => { snooze(bar === "notif" ? NOTIF_KEY : INSTALL_KEY); setBar("none"); };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      if (p === "granted") {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id;
        if (uid) await ensurePushSubscription(uid);
        toast.success("Notificaciones activadas en este dispositivo");
      }
    } catch { /* ignore */ }
    setBusy(false);
    snooze(NOTIF_KEY);
    setBar("none");
  };

  const install = async () => {
    if (!deferred) return;
    try { await deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ }
    snooze(INSTALL_KEY);
    setBar("none");
  };

  if (bar === "none") return null;

  return (
    <div
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60 }}
      className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 justify-center text-sm flex-wrap"
    >
      {bar === "notif" ? (
        <>
          <Bell size={16} aria-hidden="true" />
          <span>Activa las notificaciones para enterarte cuando llegue tu cliente</span>
          <button onClick={() => void enableNotifications()} disabled={busy} className="px-3 py-1 bg-card text-primary font-label text-xs">
            {busy ? "Activando…" : "Activar"}
          </button>
        </>
      ) : (
        <>
          <Download size={16} aria-hidden="true" />
          {deferred ? (
            <>
              <span>Instala Charm en tu pantalla de inicio</span>
              <button onClick={() => void install()} className="px-3 py-1 bg-card text-primary font-label text-xs">Instalar</button>
            </>
          ) : isIOS ? (
            <span className="flex items-center gap-1 flex-wrap justify-center">
              En Safari: toca <Share size={14} className="inline" aria-hidden="true" /> y luego “Añadir a pantalla de inicio” para instalar y recibir notificaciones.
            </span>
          ) : (
            <span>Para instalar: abre el menú del navegador y elige “Agregar a pantalla de inicio”.</span>
          )}
        </>
      )}
      <button onClick={dismiss} className="ml-1 opacity-80 hover:opacity-100" aria-label="Cerrar aviso"><X size={16} /></button>
    </div>
  );
}
