import { useEffect, useState, useRef } from "react";
import { Bell, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { trackSave } from "@/lib/saveSync";
import { toast } from "sonner";

export type Notif = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

type Props = {
  userId: string;
  onLink?: (link: string) => void;
};

const notifSupported = () => typeof window !== "undefined" && "Notification" in window;

// Fire a native OS-level browser notification (works while a tab is open, even in background).
function showBrowserNotif(n: Notif, onLink?: (link: string) => void) {
  try {
    if (!notifSupported() || Notification.permission !== "granted") return;
    const note = new Notification(n.title, { body: n.body || undefined, tag: n.id });
    note.onclick = () => {
      window.focus();
      if (n.link && onLink) onLink(n.link);
      note.close();
    };
  } catch {
    /* ignore */
  }
}

export default function NotificationBell({ userId, onLink }: Props) {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    notifSupported() ? Notification.permission : "unsupported"
  );
  const ref = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  const onLinkRef = useRef(onLink);
  onLinkRef.current = onLink;

  const requestPerm = () => {
    if (!notifSupported() || Notification.permission !== "default") return;
    Notification.requestPermission().then((p) => setPerm(p)).catch(() => {});
  };

  const load = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);
    setItems((data || []) as Notif[]);
    firstLoad.current = false;
  };

  // Ask for browser-notification permission once on mount.
  useEffect(() => {
    requestPerm();
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("notif-" + userId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload: { new: Notif }) => {
          const n = payload.new;
          setItems(prev => [n, ...prev].slice(0, 40));
          if (!firstLoad.current) {
            toast(n.title, { description: n.body || undefined });
            showBrowserNotif(n, onLinkRef.current);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter(n => !n.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter(n => !n.read_at).map(n => n.id);
    if (!ids.length) return;
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() }));
    await trackSave(supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids));
  };

  const markRead = async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await trackSave(supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id));
  };

  const handleClick = (n: Notif) => {
    markRead(n.id);
    if (n.link && onLink) onLink(n.link);
    setOpen(false);
  };

  const handleBell = () => {
    // A click is a user gesture — good moment to (re)request permission if still undecided.
    if (perm === "default") requestPerm();
    setOpen(o => !o);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleBell}
        className="relative p-2 border border-primary text-primary"
        title={perm === "granted" ? "Notificaciones" : "Notificaciones (clic para activar avisos del navegador)"}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 text-[9px] bg-destructive text-destructive-foreground rounded-full inline-flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-card border border-border shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-label text-accent">NOTIFICACIONES</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[10px] font-label text-primary flex items-center gap-1">
                <Check size={11} /> Marcar leídas
              </button>
            )}
          </div>

          {perm === "default" && (
            <button
              onClick={requestPerm}
              className="w-full text-left px-3 py-2 border-b border-border bg-background hover:opacity-80"
            >
              <span className="text-xs text-primary flex items-center gap-2">
                <Bell size={12} /> Activar avisos del navegador
              </span>
            </button>
          )}
          {perm === "denied" && (
            <div className="px-3 py-2 border-b border-border text-[10px] text-muted-foreground">
              Los avisos del navegador están bloqueados. Actívalos en la configuración del sitio para recibir alertas emergentes.
            </div>
          )}

          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs italic text-muted-foreground">
              No hay notificaciones.
            </div>
          )}
          {items.map(n => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className="w-full text-left px-3 py-3 border-b border-border hover:bg-background block"
              style={{ opacity: n.read_at ? 0.6 : 1 }}
            >
              <div className="flex items-start gap-2">
                {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 bg-destructive rounded-full flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-primary">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
                  <div className="text-[10px] font-label text-accent mt-1">
                    {new Date(n.created_at).toLocaleString("es-DO")}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
