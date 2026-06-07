import { useEffect, useState } from "react";
import { X, Share, SquarePlus, Bell, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription } from "@/lib/push";

const NOTIF_KEY = "charm_notif_prompt_dismissed_at";
const INSTALL_KEY = "charm_install_prompt_dismissed_at";
const NOTIF_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;   // re-ask after 3 days
const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // re-ask after 7 days

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const snoozed = (key: string, ms: number): boolean => {
  try {
    const v = localStorage.getItem(key);
    if (!v) return false;
    return Date.now() - parseInt(v) < ms;
  } catch { return false; }
};
const snooze = (key: string) => {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
};

export default function InstallHint() {
  const [card, setCard] = useState<"none" | "notif" | "install">("none");
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

    // iOS in the browser can't do notifications: installing comes first there.
    let next: "none" | "notif" | "install" = "none";
    if (ios && wantInstall) next = "install";
    else if (wantNotif) next = "notif";
    else if (wantInstall) next = "install";

    const t = setTimeout(() => setCard(next), 1800);
    return () => { window.removeEventListener("beforeinstallprompt", onBIP); clearTimeout(t); };
  }, []);

  const dismiss = () => {
    snooze(card === "notif" ? NOTIF_KEY : INSTALL_KEY);
    setCard("none");
  };

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
      } else if (p === "denied") {
        toast("Las notificaciones quedaron bloqueadas. Puedes activarlas en los ajustes del navegador.");
      }
    } catch { /* ignore */ }
    setBusy(false);
    snooze(NOTIF_KEY);
    setCard("none");
  };

  const installNow = async () => {
    if (!deferred) return;
    try { await deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ }
    snooze(INSTALL_KEY);
    setCard("none");
  };

  if (card === "none") return null;

  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60 }} className="p-3 sm:p-4 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-card border border-accent shadow-lg p-4 relative">
        <button onClick={dismiss} className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground" aria-label="Cerrar aviso">
          <X size={16} />
        </button>

        {card === "notif" && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Bell size={16} className="text-accent" />
              <span className="font-label text-accent text-xs">NOTIFICACIONES</span>
            </div>
            <div className="font-display text-primary mb-1" style={{ fontSize: 20, fontWeight: 500 }}>
              Entérate al momento
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Recibe un aviso cuando tu cliente llegue, cuando respondan tus solicitudes y el resumen del día — incluso con la app cerrada.
            </p>
            <div className="flex gap-2">
              <button onClick={() => void enableNotifications()} disabled={busy}
                className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground">
                {busy ? "Activando…" : "Activar notificaciones"}
              </button>
              <button onClick={dismiss} className="px-4 py-2 text-xs font-label border border-border text-muted-foreground">
                Ahora no
              </button>
            </div>
          </div>
        )}

        {card === "install" && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Download size={16} className="text-accent" />
              <span className="font-label text-accent text-xs">INSTALAR CHARM</span>
            </div>
            <div className="font-display text-primary mb-1" style={{ fontSize: 20, fontWeight: 500 }}>
              Lleva Charm en tu pantalla de inicio
            </div>
            {isIOS ? (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Instálala para abrirla como una app y poder recibir notificaciones. Hazlo desde <b>Safari</b>:
                </p>
                <ol className="space-y-2 text-sm text-foreground mb-2">
                  <li className="flex items-center gap-2">
                    <span className="font-display text-accent" style={{ fontSize: 18 }}>1.</span>
                    Toca el botón <Share size={15} className="inline text-primary" aria-label="Compartir" /> <b>Compartir</b> abajo en Safari
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="font-display text-accent" style={{ fontSize: 18 }}>2.</span>
                    Baja y elige <SquarePlus size={15} className="inline text-primary" aria-label="Añadir" /> <b>“Añadir a pantalla de inicio”</b>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="font-display text-accent" style={{ fontSize: 18 }}>3.</span>
                    Toca <b>Añadir</b> y abre Charm desde el ícono nuevo
                  </li>
                </ol>
                <button onClick={dismiss} className="px-4 py-2 text-xs font-label border border-border text-muted-foreground">Entendido</button>
              </div>
            ) : deferred ? (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Ábrela como una app, a un toque, con notificaciones incluidas.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => void installNow()} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground">Instalar</button>
                  <button onClick={dismiss} className="px-4 py-2 text-xs font-label border border-border text-muted-foreground">Ahora no</button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Abre el menú del navegador (⋮) y elige <b>“Agregar a pantalla de inicio”</b>.
                </p>
                <button onClick={dismiss} className="px-4 py-2 text-xs font-label border border-border text-muted-foreground">Entendido</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
