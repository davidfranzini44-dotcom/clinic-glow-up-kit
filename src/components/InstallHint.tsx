import { useEffect, useState } from "react";
import { X, Share, Download } from "lucide-react";

const DISMISS_KEY = "charm_install_dismissed";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export default function InstallHint() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone;
    if (standalone) return;
    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch { /* ignore */ }

    const ua = navigator.userAgent || "";
    const ios = /iphone|ipad|ipod/i.test(ua);
    const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
    setIsIOS(ios);

    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); setShow(true); };
    window.addEventListener("beforeinstallprompt", onBIP);

    let t: ReturnType<typeof setTimeout> | null = null;
    if (ios) setShow(true);
    else if (mobile) t = setTimeout(() => setShow(true), 2500);

    return () => { window.removeEventListener("beforeinstallprompt", onBIP); if (t) clearTimeout(t); };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  const install = async () => {
    if (!deferred) return;
    try { await deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ }
    dismiss();
  };

  if (!show) return null;

  return (
    <div
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60 }}
      className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 justify-center text-sm flex-wrap"
    >
      <Download size={16} aria-hidden="true" />
      {deferred ? (
        <>
          <span>Instala Charm en tu pantalla de inicio</span>
          <button onClick={install} className="px-3 py-1 bg-card text-primary font-label text-xs">Instalar</button>
        </>
      ) : isIOS ? (
        <span className="flex items-center gap-1 flex-wrap justify-center">
          Para instalar: toca <Share size={14} className="inline" aria-hidden="true" /> y luego “Agregar a inicio”.
        </span>
      ) : (
        <span>Para instalar: abre el menú del navegador y elige “Agregar a pantalla de inicio”.</span>
      )}
      <button onClick={dismiss} className="ml-1 opacity-80 hover:opacity-100" aria-label="Cerrar aviso"><X size={16} /></button>
    </div>
  );
}
