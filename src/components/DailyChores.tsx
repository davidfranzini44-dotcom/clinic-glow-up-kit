import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles, ArrowLeftRight, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Employee, TimeOffMap } from "@/lib/roster";
import { choresForDate, choresForPerson, SLOT_LABEL, type ChoreItem, type DayChores } from "@/lib/chores";

export type ChoreState = {
  columns: Record<string, ChoreItem[]>;
  strip: ChoreItem[];
  isDone: (key: string) => boolean;
  toggle: (item: ChoreItem) => void;
  forPerson: (person: string) => ChoreItem[];
};

export function useDailyChores(
  activeDate: string,
  employees: Employee[],
  timeOff: TimeOffMap,
  meName: string,
): ChoreState {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const mountedRef = useRef(true);

  const day: DayChores = useMemo(
    () => choresForDate(activeDate, employees, timeOff, overrides),
    [activeDate, employees, timeOff, overrides],
  );

  const loadDone = useCallback(async () => {
    if (!activeDate) { setDone({}); return; }
    try {
      const { data, error } = await supabase.from("chore_completions").select("chore_key,done").eq("date", activeDate);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const r of (data as { chore_key: string; done: boolean }[]) || []) map[r.chore_key] = !!r.done;
      if (mountedRef.current) setDone(map);
    } catch (e) { console.error("chores done load error:", e); }
  }, [activeDate]);

  const loadOverrides = useCallback(async () => {
    if (!activeDate) { setOverrides({}); return; }
    try {
      const { data, error } = await supabase.from("chore_overrides").select("chore_key,to_employee").eq("date", activeDate);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data as { chore_key: string; to_employee: string }[]) || []) map[r.chore_key] = r.to_employee;
      if (mountedRef.current) setOverrides(map);
    } catch (e) { console.error("chores overrides load error:", e); }
  }, [activeDate]);

  useEffect(() => { void loadDone(); void loadOverrides(); }, [loadDone, loadOverrides]);

  useEffect(() => {
    mountedRef.current = true;
    const ch = supabase
      .channel("chore-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_completions" }, (payload) => {
        const row = (payload.new || payload.old) as { chore_key: string; done: boolean; date: string } | null;
        if (!row || row.date !== activeDate) return;
        setDone((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[row.chore_key];
          else next[row.chore_key] = !!(payload.new as { done: boolean }).done;
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chore_overrides" }, () => { void loadOverrides(); })
      .subscribe();
    return () => { mountedRef.current = false; supabase.removeChannel(ch); };
  }, [activeDate, loadOverrides]);

  const isDone = useCallback((key: string) => !!done[key], [done]);

  const toggle = useCallback((item: ChoreItem) => {
    const next = !done[item.key];
    setDone((prev) => ({ ...prev, [item.key]: next }));
    void (async () => {
      const { error } = await supabase.from("chore_completions").upsert(
        { chore_key: item.key, date: activeDate, done: next, done_by: next ? meName : null, done_at: new Date().toISOString() },
        { onConflict: "chore_key" },
      );
      if (error) { console.error("chore toggle error:", error); setDone((prev) => ({ ...prev, [item.key]: !next })); }
    })();
  }, [activeDate, done, meName]);

  const forPerson = useCallback((person: string) => choresForPerson(day, person), [day]);

  return { columns: day.columns, strip: day.strip, isDone, toggle, forPerson };
}

function coverNote(item: ChoreItem): string | null {
  if (item.flagged) return `cubrir (${item.originalPerson} no está)`;
  if (item.transferred) return `transferida de ${item.originalPerson}`;
  if (item.covered) return `cubre a ${item.originalPerson}`;
  return null;
}

const checkboxStyle = (d: boolean, w: number, accent?: string) => ({
  width: w, height: w, border: `1.5px solid ${d ? "#3A8769" : (accent || "hsl(var(--muted-foreground))")}`,
  borderRadius: 3, backgroundColor: d ? "#3A8769" : "transparent",
});

// Chips shown inside a technician's stats card on the full agenda.
export function ChoreChips({ items, isDone, toggle, color }: {
  items: ChoreItem[]; isDone: (k: string) => boolean; toggle: (i: ChoreItem) => void; color?: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-border flex flex-col gap-1.5">
      <div className="text-[9px] font-label tracking-wide text-accent">TAREAS</div>
      {items.map((it) => {
        const d = isDone(it.key); const note = coverNote(it);
        return (
          <button key={it.key} onClick={() => toggle(it)} title={it.fullLabel}
            className="w-full text-left flex items-start gap-1.5 px-2 py-1 border transition-colors"
            style={{ borderColor: d ? "#3A8769" : (it.flagged ? "#C53A2D" : "hsl(var(--border))"), backgroundColor: d ? "rgba(58,135,105,0.10)" : "transparent" }}>
            <span className="mt-0.5 flex items-center justify-center shrink-0" style={checkboxStyle(d, 14, color)}>{d && <Check size={10} color="#fff" />}</span>
            <span className="flex-1 leading-tight">
              <span className="text-[11px] block" style={{ textDecoration: d ? "line-through" : "none", color: d ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>{it.shortLabel}</span>
              <span className="text-[9px] text-muted-foreground">{SLOT_LABEL[it.slot]}{note ? ` · ${note}` : ""}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The "Tareas / Recepción" strip for chores that have no technician column.
export function ChoreStrip({ strip, isDone, toggle }: {
  strip: ChoreItem[]; isDone: (k: string) => boolean; toggle: (i: ChoreItem) => void;
}) {
  if (!strip || strip.length === 0) return null;
  return (
    <div className="border border-border bg-card p-3 mb-4">
      <div className="text-[10px] font-label tracking-[0.15em] uppercase text-accent mb-2 flex items-center gap-1.5"><Sparkles size={12} /> Tareas del día · Recepción y cierre</div>
      <div className="flex flex-wrap gap-2">
        {strip.map((it) => {
          const d = isDone(it.key); const note = coverNote(it);
          return (
            <button key={it.key} onClick={() => toggle(it)} title={it.fullLabel}
              className="flex items-center gap-2 px-3 py-2 border transition-colors"
              style={{ borderColor: d ? "#3A8769" : (it.flagged ? "#C53A2D" : "hsl(var(--border))"), backgroundColor: d ? "rgba(58,135,105,0.10)" : "transparent" }}>
              <span className="flex items-center justify-center shrink-0" style={checkboxStyle(d, 16)}>{d && <Check size={11} color="#fff" />}</span>
              <span className="text-left leading-tight">
                <span className="text-xs block" style={{ textDecoration: d ? "line-through" : "none", color: d ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}><strong className="font-medium">{it.person}</strong> · {it.shortLabel}</span>
                <span className="text-[9px] text-muted-foreground">{SLOT_LABEL[it.slot]}{note ? ` · ${note}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A person's own chores on their individual ("Mi agenda") view, with a
// one-day transfer request to a coworker working that day.
export function PersonChores({ items, isDone, toggle, canRequest, date, requesterUid, targets }: {
  items: ChoreItem[];
  isDone: (k: string) => boolean;
  toggle: (i: ChoreItem) => void;
  canRequest: boolean;
  date: string;
  requesterUid: string;
  targets: string[];
}) {
  const [dlg, setDlg] = useState<ChoreItem | null>(null);
  const [target, setTarget] = useState<string>("");
  const [sending, setSending] = useState(false);

  if (!items || items.length === 0) return null;

  const openTransfer = (it: ChoreItem) => { setTarget(targets[0] || ""); setDlg(it); };

  const submit = async () => {
    if (!dlg || !target) return;
    setSending(true);
    try {
      const { error } = await supabase.from("chore_transfer_requests").insert({
        chore_key: dlg.key, chore_date: date, chore_label: dlg.fullLabel,
        from_employee: dlg.person, to_employee: target, requested_by: requesterUid, status: "pending",
      });
      if (error) throw error;
      toast.success(`Solicitud enviada a ${target}`);
      setDlg(null);
    } catch (e) {
      toast.error("No se pudo enviar: " + (e instanceof Error ? e.message : String(e)));
    } finally { setSending(false); }
  };

  return (
    <div className="border border-border bg-card p-4 mb-4">
      <div className="text-[10px] font-label tracking-[0.15em] uppercase text-accent mb-2 flex items-center gap-1.5"><Sparkles size={12} /> Mis tareas de hoy</div>
      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const d = isDone(it.key); const note = coverNote(it);
          return (
            <div key={it.key} className="flex items-center gap-2 px-3 py-2 border" style={{ borderColor: d ? "#3A8769" : (it.flagged ? "#C53A2D" : "hsl(var(--border))"), backgroundColor: d ? "rgba(58,135,105,0.10)" : "transparent" }}>
              <button onClick={() => toggle(it)} className="flex items-center gap-2 flex-1 text-left" title={it.fullLabel}>
                <span className="flex items-center justify-center shrink-0" style={checkboxStyle(d, 18)}>{d && <Check size={12} color="#fff" />}</span>
                <span className="leading-tight">
                  <span className="text-sm block" style={{ textDecoration: d ? "line-through" : "none", color: d ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>{it.shortLabel}</span>
                  <span className="text-[10px] text-muted-foreground">{SLOT_LABEL[it.slot]}{note ? ` · ${note}` : ""}</span>
                </span>
              </button>
              {canRequest && targets.length > 0 && (
                <button onClick={() => openTransfer(it)} className="px-2 py-1 text-[11px] font-label border border-accent text-accent flex items-center gap-1" title="Transferir esta tarea">
                  <ArrowLeftRight size={11} /> Transferir
                </button>
              )}
            </div>
          );
        })}
      </div>

      {dlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setDlg(null)}>
          <div className="bg-card border border-border w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="text-xs font-label text-accent">TRANSFERIR TAREA</div>
              <button onClick={() => !sending && setDlg(null)} className="text-muted-foreground"><X size={16} /></button>
            </div>
            <div className="text-sm text-primary mb-1">{dlg.fullLabel}</div>
            <div className="text-[11px] text-muted-foreground mb-4">{SLOT_LABEL[dlg.slot]} · solo por hoy</div>
            <label className="block text-xs font-label text-accent mb-1">TRANSFERIR A</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground mb-4">
              {targets.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDlg(null)} disabled={sending} className="px-4 py-2 text-xs font-label border border-primary text-primary disabled:opacity-40">Cancelar</button>
              <button onClick={submit} disabled={sending || !target} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground disabled:opacity-40">{sending ? "Enviando…" : "Enviar solicitud"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
