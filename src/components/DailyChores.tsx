import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Employee, TimeOffMap } from "@/lib/roster";
import { choresForDate, SLOT_LABEL, type ChoreItem } from "@/lib/chores";

export type ChoreState = {
  columns: Record<string, ChoreItem[]>;
  strip: ChoreItem[];
  isDone: (key: string) => boolean;
  toggle: (item: ChoreItem) => void;
};

export function useDailyChores(
  activeDate: string,
  employees: Employee[],
  timeOff: TimeOffMap,
  meName: string,
): ChoreState {
  const { columns, strip } = useMemo(
    () => choresForDate(activeDate, employees, timeOff),
    [activeDate, employees, timeOff],
  );

  const [done, setDone] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!activeDate) { setDone({}); return; }
    try {
      const { data, error } = await supabase
        .from("chore_completions")
        .select("chore_key,done")
        .eq("date", activeDate);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const r of (data as { chore_key: string; done: boolean }[]) || []) map[r.chore_key] = !!r.done;
      if (mountedRef.current) setDone(map);
    } catch (e) {
      console.error("chores load error:", e);
    }
  }, [activeDate]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    const ch = supabase
      .channel("chore-completions")
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
      .subscribe();
    return () => { mountedRef.current = false; supabase.removeChannel(ch); };
  }, [activeDate]);

  const isDone = useCallback((key: string) => !!done[key], [done]);

  const toggle = useCallback((item: ChoreItem) => {
    const next = !done[item.key];
    setDone((prev) => ({ ...prev, [item.key]: next })); // optimistic
    void (async () => {
      const { error } = await supabase.from("chore_completions").upsert(
        {
          chore_key: item.key,
          date: activeDate,
          done: next,
          done_by: next ? meName : null,
          done_at: new Date().toISOString(),
        },
        { onConflict: "chore_key" },
      );
      if (error) {
        console.error("chore toggle error:", error);
        setDone((prev) => ({ ...prev, [item.key]: !next })); // revert
      }
    })();
  }, [activeDate, done, meName]);

  return { columns, strip, isDone, toggle };
}

function coverNote(item: ChoreItem): string | null {
  if (item.flagged) return `cubrir (${item.originalPerson} no está)`;
  if (item.covered) return `cubre a ${item.originalPerson}`;
  return null;
}

// Chips shown inside a technician's stats card.
export function ChoreChips({ items, isDone, toggle, color }: {
  items: ChoreItem[];
  isDone: (key: string) => boolean;
  toggle: (item: ChoreItem) => void;
  color?: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-border flex flex-col gap-1.5">
      <div className="text-[9px] font-label tracking-wide text-accent">TAREAS</div>
      {items.map((it) => {
        const d = isDone(it.key);
        const note = coverNote(it);
        return (
          <button
            key={it.key}
            onClick={() => toggle(it)}
            className="w-full text-left flex items-start gap-1.5 px-2 py-1 border transition-colors"
            style={{
              borderColor: d ? "#3A8769" : (it.flagged ? "#C53A2D" : "hsl(var(--border))"),
              backgroundColor: d ? "rgba(58,135,105,0.10)" : "transparent",
            }}
            title={it.fullLabel}
          >
            <span
              className="mt-0.5 flex items-center justify-center shrink-0"
              style={{ width: 14, height: 14, border: `1.5px solid ${d ? "#3A8769" : (color || "hsl(var(--muted-foreground))")}`, borderRadius: 3, backgroundColor: d ? "#3A8769" : "transparent" }}
            >
              {d && <Check size={10} color="#fff" />}
            </span>
            <span className="flex-1 leading-tight">
              <span className="text-[11px] block" style={{ textDecoration: d ? "line-through" : "none", color: d ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
                {it.shortLabel}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {SLOT_LABEL[it.slot]}{note ? ` · ${note}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The "Tareas / Recepción" strip for chores that have no technician column.
export function ChoreStrip({ strip, isDone, toggle }: {
  strip: ChoreItem[];
  isDone: (key: string) => boolean;
  toggle: (item: ChoreItem) => void;
}) {
  if (!strip || strip.length === 0) return null;
  return (
    <div className="border border-border bg-card p-3 mb-4">
      <div className="text-[10px] font-label tracking-[0.15em] uppercase text-accent mb-2 flex items-center gap-1.5">
        <Sparkles size={12} /> Tareas del día · Recepción y cierre
      </div>
      <div className="flex flex-wrap gap-2">
        {strip.map((it) => {
          const d = isDone(it.key);
          const note = coverNote(it);
          return (
            <button
              key={it.key}
              onClick={() => toggle(it)}
              className="flex items-center gap-2 px-3 py-2 border transition-colors"
              style={{
                borderColor: d ? "#3A8769" : (it.flagged ? "#C53A2D" : "hsl(var(--border))"),
                backgroundColor: d ? "rgba(58,135,105,0.10)" : "transparent",
              }}
              title={it.fullLabel}
            >
              <span
                className="flex items-center justify-center shrink-0"
                style={{ width: 16, height: 16, border: `1.5px solid ${d ? "#3A8769" : "hsl(var(--muted-foreground))"}`, borderRadius: 3, backgroundColor: d ? "#3A8769" : "transparent" }}
              >
                {d && <Check size={11} color="#fff" />}
              </span>
              <span className="text-left leading-tight">
                <span className="text-xs block" style={{ textDecoration: d ? "line-through" : "none", color: d ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
                  <strong className="font-medium">{it.person}</strong> · {it.shortLabel}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {SLOT_LABEL[it.slot]}{note ? ` · ${note}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
