import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Check, X, Send, Inbox, Clock, Lock, Unlock, AlertTriangle, ArrowLeftRight, Gift } from "lucide-react";
import { toast } from "sonner";

type EmpKey = string;

export type SwapRequest = {
  id: string;
  appointment_id: string;
  target_appointment_id: string | null;
  kind: "one_way" | "trade";
  from_user_id: string;
  from_employee: string;
  to_user_id: string;
  to_employee: string;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  responded_at: string | null;
};

type AptInfo = {
  id: string;
  client: string;
  date: string;
  time: string;
  time_mins: number;
  employee: string | null;
  swap_locked: boolean;
};

type Props = {
  session: Session;
  isAdmin: boolean;
  myEmployee: EmpKey;
  onChanged?: () => void;
};

const statusLabel: Record<SwapRequest["status"], string> = {
  pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", cancelled: "Cancelada",
};
const statusStyle: Record<SwapRequest["status"], string> = {
  pending: "bg-chip-walkin-bg text-chip-walkin-fg",
  approved: "bg-success text-success-foreground",
  rejected: "bg-destructive text-destructive-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export default function SwapRequests({ session, isAdmin, onChanged }: Props) {
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [appts, setAppts] = useState<Record<string, AptInfo>>({});
  const [tab, setTab] = useState<"received" | "sent" | "all">("received");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [globalLocked, setGlobalLocked] = useState(false);

  const myId = session.user.id;

  const loadAppts = async (ids: string[]) => {
    if (!ids.length) return;
    const missing = Array.from(new Set(ids.filter(id => id && !appts[id])));
    if (!missing.length) return;
    const { data } = await supabase
      .from("appointments")
      .select("id,client,date,time,time_mins,employee,swap_locked")
      .in("id", missing);
    if (data) {
      setAppts(prev => {
        const out = { ...prev };
        data.forEach((a) => { out[a.id] = a as AptInfo; });
        return out;
      });
    }
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("appointment_swap_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
    } else {
      const rows = (data || []) as SwapRequest[];
      setRequests(rows);
      const ids: string[] = [];
      rows.forEach(r => { ids.push(r.appointment_id); if (r.target_appointment_id) ids.push(r.target_appointment_id); });
      await loadAppts(ids);
    }
    setLoading(false);
  };

  const loadLock = async () => {
    const { data } = await supabase.from("app_settings").select("swaps_locked").eq("id", 1).maybeSingle();
    setGlobalLocked(!!data?.swaps_locked);
  };

  useEffect(() => {
    load();
    loadLock();
    const ch = supabase
      .channel("swap-requests-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_swap_requests" }, () => {
        load(); onChanged?.();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, loadLock)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const received = useMemo(() => requests.filter(r => r.to_user_id === myId), [requests, myId]);
  const sent = useMemo(() => requests.filter(r => r.from_user_id === myId), [requests, myId]);

  const respond = async (req: SwapRequest, status: "approved" | "rejected" | "cancelled") => {
    const { error } = await supabase
      .from("appointment_swap_requests")
      .update({ status })
      .eq("id", req.id);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(status === "approved" ? "Cambio aprobado" : status === "rejected" ? "Cambio rechazado" : "Solicitud cancelada");
    onChanged?.();
  };

  const toggleGlobalLock = async () => {
    const { error } = await supabase
      .from("app_settings")
      .update({ swaps_locked: !globalLocked, updated_by: myId, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) { toast.error(error.message); return; }
    setGlobalLocked(v => !v);
    toast.success(!globalLocked ? "Cambios bloqueados" : "Cambios desbloqueados");
  };

  const list = tab === "received" ? received : tab === "sent" ? sent : requests;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-label text-accent">SOLICITUDES DE CAMBIO</div>
          <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
            Cambios de turno
          </h2>
        </div>
        {isAdmin && (
          <button
            onClick={toggleGlobalLock}
            className="px-4 py-2 text-xs font-label border flex items-center gap-2"
            style={{
              borderColor: globalLocked ? "hsl(var(--destructive))" : "hsl(var(--primary))",
              backgroundColor: globalLocked ? "hsl(var(--destructive))" : "transparent",
              color: globalLocked ? "hsl(var(--destructive-foreground))" : "hsl(var(--primary))",
            }}
          >
            {globalLocked ? <><Lock size={13} /> Desbloquear cambios</> : <><Unlock size={13} /> Bloquear cambios</>}
          </button>
        )}
      </div>

      {globalLocked && !isAdmin && (
        <div className="mb-4 p-3 border border-destructive bg-destructive/10 text-sm text-destructive flex items-center gap-2">
          <Lock size={14} /> El admin bloqueó las solicitudes de cambio.
        </div>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        <PillBtn active={tab === "received"} onClick={() => setTab("received")}>
          <Inbox size={13} /> Recibidas
          {received.filter(r => r.status === "pending").length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-destructive text-destructive-foreground rounded-full">
              {received.filter(r => r.status === "pending").length}
            </span>
          )}
        </PillBtn>
        <PillBtn active={tab === "sent"} onClick={() => setTab("sent")}>
          <Send size={13} /> Enviadas
        </PillBtn>
        {isAdmin && (
          <PillBtn active={tab === "all"} onClick={() => setTab("all")}>
            <Clock size={13} /> Todas
          </PillBtn>
        )}
      </div>

      {err && <div className="text-sm text-destructive mb-4">{err}</div>}
      {loading && <div className="text-sm italic text-muted-foreground">Cargando…</div>}

      {!loading && list.length === 0 && (
        <div className="border border-border bg-card p-8 text-center text-sm italic text-muted-foreground">
          No hay solicitudes en esta lista.
        </div>
      )}

      <div className="space-y-3">
        {list.map(req => {
          const apt = appts[req.appointment_id];
          const targetApt = req.target_appointment_id ? appts[req.target_appointment_id] : null;
          const iAmTarget = req.to_user_id === myId;
          const iAmRequester = req.from_user_id === myId;
          const isTrade = req.kind === "trade" && targetApt;
          return (
            <div key={req.id} className="border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-primary flex items-center gap-2 flex-wrap">
                    {isTrade ? <ArrowLeftRight size={13} className="text-accent" /> : <Gift size={13} className="text-accent" />}
                    <span className="font-medium">{req.from_employee}</span>
                    {isTrade ? "propone intercambio con" : "le pide a"}
                    <span className="font-medium">{req.to_employee}</span>
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <AptCard label={isTrade ? `Cita de ${req.from_employee}` : "Cita ofrecida"} apt={apt} />
                    {isTrade && <AptCard label={`Cita de ${req.to_employee}`} apt={targetApt!} />}
                  </div>

                  {req.note && (
                    <div className="text-xs italic mt-2 text-muted-foreground">"{req.note}"</div>
                  )}
                  <div className="text-[10px] font-label text-accent mt-2">
                    {new Date(req.created_at).toLocaleString("es-DO")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] px-2 py-1 font-label ${statusStyle[req.status]}`}>
                    {statusLabel[req.status].toUpperCase()}
                  </span>
                  {req.status === "pending" && (iAmTarget || isAdmin) && (
                    <div className="flex gap-2">
                      <button
                        disabled={globalLocked && !isAdmin}
                        onClick={() => respond(req, "approved")}
                        className="px-3 py-1.5 text-[11px] font-label bg-success text-success-foreground flex items-center gap-1 disabled:opacity-40">
                        <Check size={12} /> Aprobar
                      </button>
                      <button
                        disabled={globalLocked && !isAdmin}
                        onClick={() => respond(req, "rejected")}
                        className="px-3 py-1.5 text-[11px] font-label bg-destructive text-destructive-foreground flex items-center gap-1 disabled:opacity-40">
                        <X size={12} /> Rechazar
                      </button>
                    </div>
                  )}
                  {req.status === "pending" && iAmRequester && !iAmTarget && (
                    <button
                      onClick={() => respond(req, "cancelled")}
                      className="px-3 py-1.5 text-[11px] font-label border border-primary text-primary">
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AptCard({ label, apt }: { label: string; apt: AptInfo | undefined }) {
  if (!apt) return (
    <div className="border border-border p-2 text-xs italic text-muted-foreground">{label}: cita no disponible</div>
  );
  return (
    <div className="border border-border p-2">
      <div className="text-[10px] font-label text-accent">{label.toUpperCase()}</div>
      <div className="text-sm text-primary font-medium">{apt.client}</div>
      <div className="text-xs text-muted-foreground">{apt.date} · {apt.time}</div>
      {apt.swap_locked && (
        <div className="text-[10px] text-destructive flex items-center gap-1 mt-1"><Lock size={10} /> Bloqueada</div>
      )}
    </div>
  );
}

function PillBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 text-xs font-label border flex items-center gap-1 transition-colors"
      style={{
        borderColor: "hsl(var(--primary))",
        backgroundColor: active ? "hsl(var(--primary))" : "transparent",
        color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
      }}>
      {children}
    </button>
  );
}

// ─── Dialog: smart trade-aware swap creation ─────────────────────────────
export function SwapRequestDialog({
  open, onClose, appointment, myEmployee, myUserId, employees,
}: {
  open: boolean;
  onClose: () => void;
  appointment: { id: string; client: string; time: string; date: string; time_mins?: number } | null;
  myEmployee: EmpKey;
  myUserId: string;
  employees: EmpKey[];
}) {
  const others = employees.filter(e => e !== myEmployee);
  const [target, setTarget] = useState<EmpKey>(others[0]);
  const [mode, setMode] = useState<"one_way" | "trade">("one_way");
  const [targetAptId, setTargetAptId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [targetAppts, setTargetAppts] = useState<AptInfo[]>([]);
  const [globalLocked, setGlobalLocked] = useState(false);
  const [myAptLocked, setMyAptLocked] = useState(false);

  useEffect(() => {
    if (open) {
      setTarget(others[0]);
      setMode("one_way");
      setTargetAptId("");
      setNote("");
      setErr("");
      setTargetAppts([]);
      (async () => {
        const { data } = await supabase.from("app_settings").select("swaps_locked").eq("id", 1).maybeSingle();
        setGlobalLocked(!!data?.swaps_locked);
      })();
      if (appointment) {
        (async () => {
          const { data } = await supabase.from("appointments").select("swap_locked").eq("id", appointment.id).maybeSingle();
          setMyAptLocked(!!data?.swap_locked);
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load coworker's same-day appointments when target/mode changes
  useEffect(() => {
    if (!open || !appointment || mode !== "trade") return;
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id,client,date,time,time_mins,employee,swap_locked")
        .eq("date", appointment.date)
        .eq("employee", target)
        .eq("cancelled", false)
        .order("time_mins", { ascending: true });
      setTargetAppts((data || []) as AptInfo[]);
      setTargetAptId("");
    })();
  }, [open, target, mode, appointment]);

  if (!open || !appointment) return null;

  const selectedTargetApt = targetAppts.find(a => a.id === targetAptId);
  const conflict = mode === "trade" && selectedTargetApt && appointment.time_mins != null
    ? Math.abs(selectedTargetApt.time_mins - appointment.time_mins) === 0
      ? "Ambas citas son a la misma hora — uno trabajará doble."
      : null
    : null;

  const submit = async () => {
    setSubmitting(true);
    setErr("");
    try {
      if (myAptLocked) throw new Error("Esta cita fue bloqueada por el admin.");
      if (globalLocked) throw new Error("El admin bloqueó las solicitudes de cambio.");
      if (mode === "trade" && !targetAptId) throw new Error("Elige cuál cita te gustaría tomar.");

      const { data: prof, error: pErr } = await supabase
        .from("profiles").select("id,employee_name").eq("employee_name", target).maybeSingle();
      if (pErr) throw pErr;
      if (!prof) throw new Error(`${target} aún no tiene cuenta. Pídele que se registre primero.`);

      const { error } = await supabase.from("appointment_swap_requests").insert({
        appointment_id: appointment.id,
        target_appointment_id: mode === "trade" ? targetAptId : null,
        kind: mode,
        from_user_id: myUserId,
        from_employee: myEmployee,
        to_user_id: prof.id,
        to_employee: target,
        note: note.trim() || null,
      });
      if (error) throw error;
      toast.success("Solicitud enviada");
      onClose();
    } catch (e) {
      setErr((e instanceof Error ? e.message : "") || "No se pudo enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="bg-card border border-border max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs font-label text-accent">SOLICITAR CAMBIO</div>
        <h3 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 400 }}>
          ¿Cómo quieres el cambio?
        </h3>

        {(globalLocked || myAptLocked) && (
          <div className="mb-3 p-2 border border-destructive bg-destructive/10 text-xs text-destructive flex items-center gap-2">
            <Lock size={12} /> {myAptLocked ? "Esta cita fue bloqueada por el admin." : "El admin bloqueó las solicitudes."}
          </div>
        )}

        <div className="border border-border p-3 mb-4 text-sm text-primary">
          <div className="text-[10px] font-label text-accent">TU CITA</div>
          <div className="font-medium">{appointment.client}</div>
          <div className="text-muted-foreground text-xs mt-1">{appointment.date} · {appointment.time}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setMode("one_way")}
            className="px-3 py-2 text-xs font-label border flex items-center justify-center gap-1"
            style={{
              borderColor: "hsl(var(--primary))",
              backgroundColor: mode === "one_way" ? "hsl(var(--primary))" : "transparent",
              color: mode === "one_way" ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
            }}
          >
            <Gift size={12} /> Solo cederla
          </button>
          <button
            onClick={() => setMode("trade")}
            className="px-3 py-2 text-xs font-label border flex items-center justify-center gap-1"
            style={{
              borderColor: "hsl(var(--primary))",
              backgroundColor: mode === "trade" ? "hsl(var(--primary))" : "transparent",
              color: mode === "trade" ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
            }}
          >
            <ArrowLeftRight size={12} /> Intercambiar
          </button>
        </div>

        <label className="block text-xs font-label text-accent mb-1">COMPAÑERA</label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as EmpKey)}
          className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-4">
          {others.map(e => <option key={e} value={e}>{e}</option>)}
        </select>

        {mode === "trade" && (
          <>
            <label className="block text-xs font-label text-accent mb-1">CITA QUE QUIERES TOMAR DE {target.toUpperCase()}</label>
            {targetAppts.length === 0 ? (
              <div className="text-xs italic text-muted-foreground mb-4 p-3 border border-border">
                {target} no tiene citas activas ese día.
              </div>
            ) : (
              <select
                value={targetAptId}
                onChange={(e) => setTargetAptId(e.target.value)}
                className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-2">
                <option value="">— Elegir —</option>
                {targetAppts.map(a => (
                  <option key={a.id} value={a.id} disabled={a.swap_locked}>
                    {a.time} · {a.client}{a.swap_locked ? " (bloqueada)" : ""}
                  </option>
                ))}
              </select>
            )}
            {conflict && (
              <div className="mb-3 p-2 border border-accent bg-accent/10 text-xs text-accent flex items-start gap-2">
                <AlertTriangle size={12} className="mt-0.5" /> {conflict}
              </div>
            )}
          </>
        )}

        <label className="block text-xs font-label text-accent mb-1">NOTA (opcional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={mode === "trade" ? "ej. ¿Me cambias este 3PM por tu 4PM?" : "ej. Tengo una emergencia"}
          className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-4" />
        {err && <div className="text-sm text-destructive mb-3">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-label border border-primary text-primary">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting || globalLocked || myAptLocked}
            className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground disabled:opacity-50">
            {submitting ? "Enviando…" : "Enviar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
