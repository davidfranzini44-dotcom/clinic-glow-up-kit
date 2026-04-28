import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Check, X, Send, Inbox, Clock } from "lucide-react";

type EmpKey = "Yaira" | "Belkis" | "Cielo" | "Lisa";

export type SwapRequest = {
  id: string;
  appointment_id: string;
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
  employee: string | null;
};

type Props = {
  session: Session;
  isAdmin: boolean;
  myEmployee: EmpKey;
  onChanged?: () => void;
};

const statusLabel: Record<SwapRequest["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
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

  const myId = session.user.id;

  const loadAppts = async (ids: string[]) => {
    if (!ids.length) return;
    const missing = ids.filter(id => !appts[id]);
    if (!missing.length) return;
    const { data } = await supabase
      .from("appointments")
      .select("id,client,date,time,employee")
      .in("id", missing);
    if (data) {
      setAppts(prev => {
        const out = { ...prev };
        data.forEach((a: any) => { out[a.id] = a; });
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
      setRequests((data || []) as SwapRequest[]);
      await loadAppts((data || []).map((r: any) => r.appointment_id));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("swap-requests-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_swap_requests" }, () => {
        load();
        onChanged?.();
      })
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
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    onChanged?.();
  };

  const list =
    tab === "received" ? received :
    tab === "sent" ? sent :
    requests;

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs font-label text-accent">SOLICITUDES DE CAMBIO</div>
        <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
          Cambios de turno
        </h2>
      </div>

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
          const iAmTarget = req.to_user_id === myId;
          const iAmRequester = req.from_user_id === myId;
          return (
            <div key={req.id} className="border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm text-primary">
                    <span className="font-medium">{req.from_employee}</span>{" "}
                    pide a <span className="font-medium">{req.to_employee}</span> tomar la cita
                  </div>
                  {apt ? (
                    <div className="text-sm mt-1 text-primary">
                      <span className="font-display" style={{ fontWeight: 500 }}>{apt.client}</span>
                      <span className="text-muted-foreground"> · {apt.date} · {apt.time}</span>
                    </div>
                  ) : (
                    <div className="text-xs italic text-muted-foreground mt-1">Cita no disponible</div>
                  )}
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
                  {req.status === "pending" && iAmTarget && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => respond(req, "approved")}
                        className="px-3 py-1.5 text-[11px] font-label bg-success text-success-foreground flex items-center gap-1">
                        <Check size={12} /> Aprobar
                      </button>
                      <button
                        onClick={() => respond(req, "rejected")}
                        className="px-3 py-1.5 text-[11px] font-label bg-destructive text-destructive-foreground flex items-center gap-1">
                        <X size={12} /> Rechazar
                      </button>
                    </div>
                  )}
                  {req.status === "pending" && iAmRequester && (
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

// ─── Inline dialog used by the agenda to create a new request ─────────────
export function SwapRequestDialog({
  open, onClose, appointment, myEmployee, myUserId, employees,
}: {
  open: boolean;
  onClose: () => void;
  appointment: { id: string; client: string; time: string; date: string } | null;
  myEmployee: EmpKey;
  myUserId: string;
  employees: EmpKey[];
}) {
  const others = employees.filter(e => e !== myEmployee);
  const [target, setTarget] = useState<EmpKey>(others[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setTarget(others[0]);
      setNote("");
      setErr("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !appointment) return null;

  const submit = async () => {
    setSubmitting(true);
    setErr("");
    try {
      // Resolve target user_id from profiles by employee_name
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("id,employee_name")
        .eq("employee_name", target)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prof) throw new Error(`${target} aún no tiene cuenta. Pídele que se registre primero.`);

      const { error } = await supabase
        .from("appointment_swap_requests")
        .insert({
          appointment_id: appointment.id,
          from_user_id: myUserId,
          from_employee: myEmployee,
          to_user_id: prof.id,
          to_employee: target,
          note: note.trim() || null,
        });
      if (error) throw error;
      onClose();
    } catch (e: any) {
      setErr(e.message || "No se pudo enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="bg-card border border-border max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs font-label text-accent">SOLICITAR CAMBIO</div>
        <h3 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 400 }}>
          ¿Quién toma esta cita?
        </h3>
        <div className="border border-border p-3 mb-4 text-sm text-primary">
          <div className="font-medium">{appointment.client}</div>
          <div className="text-muted-foreground text-xs mt-1">{appointment.date} · {appointment.time}</div>
        </div>
        <label className="block text-xs font-label text-accent mb-1">COMPAÑERA</label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as EmpKey)}
          className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-4">
          {others.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="block text-xs font-label text-accent mb-1">NOTA (opcional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="ej. ¿Me cambias este 3PM por tu 4PM?"
          className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-4" />
        {err && <div className="text-sm text-destructive mb-3">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-label border border-primary text-primary">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground disabled:opacity-50">
            {submitting ? "Enviando…" : "Enviar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
