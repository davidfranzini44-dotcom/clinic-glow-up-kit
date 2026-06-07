import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription } from "@/lib/push";
import { invalidateRoster } from "@/lib/roster";
import { toast } from "sonner";
import { Save, KeyRound, Mail, Palette, CalendarOff, Camera, Trash2, Check, Clock } from "lucide-react";

const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e ?? "");
};

export const COLOR_OPTIONS = [
  "#C2566E", "#8A5A6E", "#C58A3A", "#8A4A2E", "#3E8E8E", "#7E5AA6",
  "#2F6B4F", "#B5485D", "#4A6FA5", "#9C6B30", "#5B8C5A", "#A35A9E",
];

const KIND_LABEL: Record<string, string> = {
  day_off: "Día libre",
  vacation: "Vacaciones",
  late_entry: "Entrada tarde",
  sick: "Enferma / Cita médica",
};
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "#C58A3A" },
  approved: { label: "Aprobada", color: "#3A8769" },
  rejected: { label: "Rechazada", color: "#C53A2D" },
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const toMin = (s: string): number | null => {
  if (!s) return null;
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  if (isNaN(h)) return null;
  return h * 60 + (m || 0);
};

type RequestRow = {
  id: string; kind: string; date: string; end_date: string | null;
  new_start_min: number | null; info: string | null; attachment_path: string | null;
  status: string; created_at: string;
};

export default function ProfileModule({ session, onRosterChanged }: { session: Session; onRosterChanged?: () => void }) {
  const userId = session.user.id;
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [vac, setVac] = useState<{ allowance: number; used: number } | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const activateNotifs = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === "granted") {
      await ensurePushSubscription(session.user.id);
      toast.success("Notificaciones activadas en este dispositivo");
    }
  };
  useEffect(() => {
    if (!employeeName) { setVac(null); return; }
    (async () => {
      try {
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const [es, vu] = await Promise.all([
          supabase.from("employee_settings").select("vacation_days").eq("name", employeeName).maybeSingle(),
          supabase.from("employee_time_off").select("id", { count: "exact", head: true })
            .eq("employee_name", employeeName).eq("reason", "vacation").gte("date", yearStart),
        ]);
        setVac({ allowance: (es.data as { vacation_days?: number } | null)?.vacation_days ?? 14, used: vu.count || 0 });
      } catch { /* ignore */ }
    })();
  }, [employeeName]);
  const [email, setEmail] = useState(session.user.email || "");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [colors, setColors] = useState<{ name: string; color: string | null }[]>([]);
  const [myColor, setMyColor] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [reqKind, setReqKind] = useState("day_off");
  const [reqDate, setReqDate] = useState(todayISO());
  const [reqEndDate, setReqEndDate] = useState("");
  const [reqTime, setReqTime] = useState("11:00");
  const [reqInfo, setReqInfo] = useState("");
  const [reqFile, setReqFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: prof }, { data: emps }, { data: reqs }] = await Promise.all([
      supabase.from("profiles").select("display_name, phone, employee_name").eq("id", userId).maybeSingle(),
      supabase.from("employee_settings").select("name,color").eq("active", true),
      supabase.from("employee_requests").select("id,kind,date,end_date,new_start_min,info,attachment_path,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(25),
    ]);
    if (prof) {
      setDisplayName(prof.display_name || "");
      setPhone(prof.phone || "");
      setEmployeeName(prof.employee_name);
      const mine = (emps || []).find((e) => e.name === prof.employee_name);
      setMyColor(mine?.color || null);
    }
    setColors((emps || []) as { name: string; color: string | null }[]);
    setRequests((reqs || []) as RequestRow[]);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const saveProfile = async () => {
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() || null, phone: phone.trim() || null }).eq("id", userId);
    if (error) toast.error(error.message);
    else toast.success("Datos guardados");
  };

  const updateEmail = async () => {
    if (!email.trim() || email === session.user.email) { toast("Escribe un correo nuevo."); return; }
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    if (error) toast.error(error.message);
    else toast.success("Revisa tu correo para confirmar el cambio.");
  };

  const updatePassword = async () => {
    if (newPass.length < 6) { toast("La contraseña debe tener al menos 6 caracteres."); return; }
    if (newPass !== newPass2) { toast.error("Las contraseñas no coinciden."); return; }
    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) toast.error(error.message);
    else { toast.success("Contraseña actualizada"); setNewPass(""); setNewPass2(""); }
  };

  const pickColor = async (c: string) => {
    const { error } = await supabase.rpc("set_my_color", { new_color: c });
    if (error) { toast.error(error.message); return; }
    setMyColor(c);
    invalidateRoster();
    onRosterChanged?.();
    toast.success("Color actualizado");
  };

  const submitRequest = async () => {
    if (!reqDate) { toast("Elige la fecha."); return; }
    if (reqKind === "vacation" && (!reqEndDate || reqEndDate < reqDate)) { toast("Elige el último día de vacaciones."); return; }
    if (reqKind === "sick" && !reqFile && !reqInfo.trim()) { toast("Agrega información o el justificante médico."); return; }
    setBusy(true);
    try {
      let attachment_path: string | null = null;
      if (reqFile) {
        const safe = reqFile.name.replace(/[^\w.\-]/g, "_");
        attachment_path = `${userId}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage.from("request-files").upload(attachment_path, reqFile);
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from("employee_requests").insert({
        user_id: userId,
        employee_name: employeeName,
        kind: reqKind,
        date: reqDate,
        end_date: reqKind === "vacation" ? reqEndDate : null,
        new_start_min: reqKind === "late_entry" ? toMin(reqTime) : null,
        info: reqInfo.trim() || null,
        attachment_path,
      });
      if (error) throw error;
      toast.success("Solicitud enviada");
      setReqInfo(""); setReqFile(null); setReqEndDate("");
      await load();
    } catch (e) {
      toast.error((errMsg(e)) || "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (id: string) => {
    const { error } = await supabase.from("employee_requests").delete().eq("id", id);
    if (error) toast.error(error.message);
    else setRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const takenColors = new Set(colors.filter((c) => c.name !== employeeName).map((c) => (c.color || "").toUpperCase()));

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Datos personales */}
      <div>
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 500 }}>Mi perfil</h2>
        <div className="border border-border bg-card p-4 space-y-3">
          <label className="block text-xs">
            <span className="font-label text-accent">Nombre</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
          </label>
          <label className="block text-xs">
            <span className="font-label text-accent">Teléfono</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="809-555-1234"
              className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
          </label>
          <button onClick={saveProfile} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-2"><Save size={13} /> Guardar datos</button>
        </div>
      </div>

      {/* Cuenta */}
      <div>
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 24, fontWeight: 500 }}>Cuenta</h2>
        <div className="border border-border bg-card p-4 space-y-4">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="block text-xs flex-1 min-w-[220px]">
              <span className="font-label text-accent">Correo</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
            </label>
            <button onClick={updateEmail} className="px-3 py-2 text-xs font-label border border-primary text-primary flex items-center gap-2"><Mail size={13} /> Actualizar correo</button>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="block text-xs flex-1 min-w-[160px]">
              <span className="font-label text-accent">Nueva contraseña</span>
              <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
            </label>
            <label className="block text-xs flex-1 min-w-[160px]">
              <span className="font-label text-accent">Repetir contraseña</span>
              <input type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
            </label>
            <button onClick={updatePassword} className="px-3 py-2 text-xs font-label border border-primary text-primary flex items-center gap-2"><KeyRound size={13} /> Cambiar</button>
          </div>
        </div>
      </div>

      {/* Color */}
      {employeeName && (
        <div>
          <h2 className="font-display text-primary mb-4" style={{ fontSize: 24, fontWeight: 500 }}>
            <Palette size={18} className="inline mr-2" />Mi color en la agenda
          </h2>
          <div className="border border-border bg-card p-4">
            <div className="grid grid-cols-6 gap-3 max-w-sm">
              {COLOR_OPTIONS.map((c) => {
                const taken = takenColors.has(c.toUpperCase());
                const mine = (myColor || "").toUpperCase() === c.toUpperCase();
                return (
                  <button key={c} onClick={() => !taken && !mine && pickColor(c)} disabled={taken}
                    title={taken ? "En uso por otra empleada" : "Elegir este color"}
                    className="aspect-square w-full rounded-full border-2 inline-flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95"
                    style={{
                      backgroundColor: c,
                      borderColor: mine ? "hsl(var(--primary))" : "transparent",
                      boxShadow: mine ? "0 0 0 3px hsl(var(--background)), 0 0 0 5px " + c : undefined,
                      opacity: taken ? 0.2 : 1,
                      transform: mine ? "scale(1.12)" : undefined,
                      cursor: taken ? "not-allowed" : "pointer",
                    }}>
                    {mine && <Check size={16} color="white" />}
                  </button>
                );
              })}
            </div>
            {myColor && (
              <div className="mt-4 border border-border bg-background p-3 flex items-center gap-3" style={{ borderLeft: `4px solid ${myColor}` }}>
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: myColor }} />
                <span className="text-sm text-foreground">{employeeName}</span>
                <span className="text-xs text-muted-foreground">· así te verás en la agenda</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">Toca un color para elegirlo. Los apagados ya están en uso por otra empleada.</p>
          </div>
        </div>
      )}

      {/* Solicitudes */}
      <div>
        {notifPerm !== "unsupported" && (
          <div className="border border-border bg-card p-4 mb-6 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <div className="font-label text-accent text-xs mb-1">NOTIFICACIONES EN ESTE DISPOSITIVO</div>
              <div className="text-sm text-muted-foreground">
                {notifPerm === "granted" ? "Activadas — recibirás avisos de llegadas y solicitudes." :
                 notifPerm === "denied" ? "Bloqueadas — actívalas en los ajustes del navegador (Permisos → Notificaciones)." :
                 "Aún no activadas en este dispositivo."}
              </div>
            </div>
            {notifPerm === "default" && (
              <button onClick={() => void activateNotifs()} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground">
                Activar notificaciones
              </button>
            )}
            {notifPerm === "granted" && (
              <button onClick={() => void ensurePushSubscription(session.user.id).then((ok) => toast[ok ? "success" : "error"](ok ? "Este dispositivo está registrado" : "No se pudo registrar"))}
                className="px-4 py-2 text-xs font-label border border-border text-muted-foreground">
                Probar registro
              </button>
            )}
          </div>
        )}
        {vac && (
          <div className="border border-border bg-card p-4 mb-6 flex items-center gap-4">
            <div className="font-display text-accent" style={{ fontSize: 34, fontWeight: 500 }}>{Math.max(0, vac.allowance - vac.used)}</div>
            <div>
              <div className="font-label text-accent text-xs">DÍAS DE VACACIONES DISPONIBLES · {new Date().getFullYear()}</div>
              <div className="text-sm text-muted-foreground mt-1">{vac.used} usados de {vac.allowance} al año</div>
            </div>
          </div>
        )}
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 24, fontWeight: 500 }}>
          <CalendarOff size={18} className="inline mr-2" />Mis solicitudes
        </h2>
        <div className="border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="font-label text-accent">Tipo</span>
              <select value={reqKind} onChange={(e) => setReqKind(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground">
                <option value="day_off">Día libre</option>
                <option value="vacation">Vacaciones</option>
                <option value="late_entry">Entrada tarde</option>
                <option value="sick">Enferma / Cita médica</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="font-label text-accent">{reqKind === "vacation" ? "Desde" : "Fecha"}</span>
              <input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
            </label>
            {reqKind === "vacation" && (
              <label className="block text-xs">
                <span className="font-label text-accent">Hasta</span>
                <input type="date" value={reqEndDate} onChange={(e) => setReqEndDate(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
              </label>
            )}
            {reqKind === "late_entry" && (
              <label className="block text-xs">
                <span className="font-label text-accent"><Clock size={11} className="inline mr-1" />Hora a la que llegarías</span>
                <input type="time" value={reqTime} onChange={(e) => setReqTime(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
              </label>
            )}
          </div>
          <label className="block text-xs">
            <span className="font-label text-accent">Información {reqKind === "sick" ? "(motivo, síntomas, médico…)" : "(opcional)"}</span>
            <textarea value={reqInfo} onChange={(e) => setReqInfo(e.target.value)} rows={2}
              className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground" />
          </label>
          {reqKind === "sick" && (
            <label className="block text-xs">
              <span className="font-label text-accent"><Camera size={11} className="inline mr-1" />Justificante médico (foto o PDF — puedes usar la cámara)</span>
              <input type="file" accept="image/*,.pdf" capture="environment"
                onChange={(e) => setReqFile(e.target.files?.[0] || null)}
                className="mt-1 w-full text-xs" />
              {reqFile && <span className="text-[11px] text-success">Adjunto: {reqFile.name}</span>}
            </label>
          )}
          <button onClick={submitRequest} disabled={busy}
            className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground disabled:opacity-50">
            {busy ? "Enviando…" : "Enviar solicitud"}
          </button>
        </div>

        <div className="border border-border bg-card mt-3 divide-y divide-border">
          {requests.length === 0 && <div className="p-4 text-xs italic text-muted-foreground">Sin solicitudes todavía.</div>}
          {requests.map((r) => {
            const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
            return (
              <div key={r.id} className="p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm text-primary">
                    {KIND_LABEL[r.kind] || r.kind} — {r.date}{r.end_date ? ` → ${r.end_date}` : ""}
                    {r.kind === "late_entry" && r.new_start_min != null && ` (llega ${String(Math.floor(r.new_start_min / 60)).padStart(2, "0")}:${String(r.new_start_min % 60).padStart(2, "0")})`}
                  </div>
                  {r.info && <div className="text-xs text-muted-foreground truncate">{r.info}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-label px-2 py-0.5 rounded-full" style={{ backgroundColor: `${st.color}22`, color: st.color }}>{st.label}</span>
                  {r.status === "pending" && (
                    <button onClick={() => cancelRequest(r.id)} className="p-1 opacity-50 hover:opacity-100" title="Cancelar solicitud">
                      <Trash2 size={13} className="text-destructive" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
