import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

type TransferRow = {
  id: string;
  chore_key: string;
  chore_date: string;
  chore_label: string | null;
  from_employee: string;
  to_employee: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
};

const statusLabel: Record<TransferRow["status"], string> = {
  pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", cancelled: "Cancelada",
};
const statusStyle: Record<TransferRow["status"], string> = {
  pending: "bg-secondary text-secondary-foreground",
  approved: "bg-success text-success-foreground",
  rejected: "bg-destructive text-destructive-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const fmtDate = (d: string) => {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("es-DO", { weekday: "short", day: "numeric", month: "short" });
};

export default function ChoreTransfers({ session, isAdmin, myEmployee }: { session: Session; isAdmin: boolean; myEmployee: string }) {
  const uid = session.user.id;
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("chore_transfer_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) { console.error("chore transfers load error:", error); return; }
    setRows((data as TransferRow[]) || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("chore-transfers")
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_transfer_requests" }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const respond = async (req: TransferRow, status: "approved" | "rejected" | "cancelled") => {
    setBusy(req.id);
    try {
      const { error } = await supabase
        .from("chore_transfer_requests")
        .update({ status, reviewed_by: uid, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);
      if (error) throw error;
      if (status === "approved") {
        const { error: e2 } = await supabase.from("chore_overrides").upsert(
          { chore_key: req.chore_key, date: req.chore_date, to_employee: req.to_employee, updated_at: new Date().toISOString() },
          { onConflict: "chore_key" },
        );
        if (e2) throw e2;
      } else {
        // reject/cancel removes any override for that day-chore
        await supabase.from("chore_overrides").delete().eq("chore_key", req.chore_key);
      }
      toast.success(status === "approved" ? "Transferencia aprobada" : status === "rejected" ? "Transferencia rechazada" : "Solicitud cancelada");
      void load();
    } catch (e) {
      toast.error("No se pudo: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(null); }
  };

  const relevant = rows.filter((r) => isAdmin || r.to_employee === myEmployee || r.requested_by === uid);
  if (relevant.length === 0) {
    return (
      <div className="border border-border bg-card p-6 text-sm italic text-muted-foreground">
        No hay solicitudes de transferencia de tareas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-label text-accent flex items-center gap-1.5"><ArrowLeftRight size={12} /> TRANSFERENCIAS DE TAREAS</div>
      {relevant.map((req) => {
        const iAmTarget = req.to_employee === myEmployee;
        const iAmRequester = req.requested_by === uid;
        const canDecide = req.status === "pending" && (iAmTarget || isAdmin);
        const canCancel = req.status === "pending" && iAmRequester && !iAmTarget;
        return (
          <div key={req.id} className="border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm text-primary">{req.chore_label || "Tarea"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <strong className="text-foreground">{req.from_employee}</strong> → <strong className="text-foreground">{req.to_employee}</strong> · {fmtDate(req.chore_date)}
                </div>
              </div>
              <span className={`text-[10px] px-2 py-1 font-label ${statusStyle[req.status]}`}>{statusLabel[req.status].toUpperCase()}</span>
            </div>
            {(canDecide || canCancel) && (
              <div className="flex gap-2 mt-3">
                {canDecide && (
                  <>
                    <button disabled={busy === req.id} onClick={() => respond(req, "approved")}
                      className="px-3 py-1.5 text-[11px] font-label bg-primary text-primary-foreground flex items-center gap-1 disabled:opacity-40"><Check size={12} /> Aprobar</button>
                    <button disabled={busy === req.id} onClick={() => respond(req, "rejected")}
                      className="px-3 py-1.5 text-[11px] font-label border border-destructive text-destructive flex items-center gap-1 disabled:opacity-40"><X size={12} /> Rechazar</button>
                  </>
                )}
                {canCancel && (
                  <button disabled={busy === req.id} onClick={() => respond(req, "cancelled")}
                    className="px-3 py-1.5 text-[11px] font-label border border-primary text-primary disabled:opacity-40">Cancelar solicitud</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
