import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { Apt } from "./CharmScheduler";

interface Props {
  days: Record<string, Apt[]>;
  cutoff: string; // inclusive last historical date, e.g. "2026-04-26"
  onClientClick: (name: string) => void;
}

const dateLabelES = (d: Date) =>
  d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function HistoryView({ days, cutoff, onClientClick }: Props) {
  const [selected, setSelected] = useState<Date | undefined>(undefined);

  const cutoffDate = useMemo(() => new Date(cutoff + "T23:59:59"), [cutoff]);

  // Set of historical dates that have appointments (for highlighting)
  const historyDates = useMemo(() => {
    const set = new Set<string>();
    Object.keys(days).forEach(d => {
      if (d <= cutoff) set.add(d);
    });
    return set;
  }, [days, cutoff]);

  const selectedKey = selected
    ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
    : null;

  const dayAppts = selectedKey ? [...(days[selectedKey] || [])].sort((a, b) => a.timeMins - b.timeMins) : [];

  const minDate = useMemo(() => {
    const all = Array.from(historyDates).sort();
    return all[0] ? new Date(all[0] + "T12:00:00") : new Date("2020-01-01");
  }, [historyDates]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-label text-accent">HISTORIAL DE AGENDA</div>
        <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
          Citas hasta el {cutoff}
        </h2>
      </div>

      <div className="grid md:grid-cols-[auto,1fr] gap-6">
        <div className="border border-border bg-card p-2 inline-block">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            disabled={(date) => date > cutoffDate || date < minDate}
            modifiers={{
              hasAppts: (date) => {
                const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                return historyDates.has(k);
              },
            }}
            modifiersClassNames={{
              hasAppts: "bg-accent/30 text-accent-foreground font-semibold",
            }}
            defaultMonth={cutoffDate}
            className={cn("p-3 pointer-events-auto")}
          />
        </div>

        <div className="min-w-0">
          {!selected && (
            <div className="text-sm text-muted-foreground border border-dashed border-border p-6">
              Selecciona una fecha del calendario para ver las citas históricas.
            </div>
          )}
          {selected && (
            <>
              <div className="text-xs font-label text-accent mb-2">{dayAppts.length} CITAS</div>
              <h3 className="font-display text-primary text-2xl mb-4 capitalize">{dateLabelES(selected)}</h3>
              {dayAppts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No hay citas registradas en esta fecha.</div>
              ) : (
                <div className="space-y-2">
                  {dayAppts.map(a => (
                    <div key={a.id} className="border border-border bg-card p-3 flex items-start gap-3 flex-wrap">
                      <div className="font-mono text-sm text-primary min-w-[60px]">{a.time}</div>
                      <button
                        onClick={() => onClientClick(a.client)}
                        className="text-left font-medium text-foreground hover:text-primary underline-offset-2 hover:underline flex-1 min-w-[180px]"
                      >
                        {a.client}
                      </button>
                      <div className="text-xs text-muted-foreground min-w-[80px]">{a.employee || "—"}</div>
                      <div className="flex gap-1 flex-wrap">
                        {a.cancelled && <span className="text-[10px] font-label px-2 py-0.5 bg-accent/20 text-accent">CANCELÓ</span>}
                        {a.noShow && <span className="text-[10px] font-label px-2 py-0.5 bg-destructive/20 text-destructive">NO ASISTIÓ</span>}
                        {a.walkIn && <span className="text-[10px] font-label px-2 py-0.5 bg-primary/10 text-primary">WALK-IN</span>}
                      </div>
                      {a.changed && (
                        <div className="text-xs text-muted-foreground basis-full pl-[60px] italic">{a.changed}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
