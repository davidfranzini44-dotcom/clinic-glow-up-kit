import { useEffect, useMemo, useState } from "react";
import { Calendar, Download, TrendingUp, Clock, Users, AlertCircle, Activity, Filter, Award } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "./CharmScheduler";
import { useRoster, repHours } from "@/lib/roster";

const TREATMENT_MIN = 20;

const DAYS_ES_SHORT = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const formatDateShort = (dateStr: string) => {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAYS_ES_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
};
const formatHours = (mins: number) => {
  const h = Math.floor(mins / 60); const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const startOfWeekISO = () => {
  const d = new Date(); const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};
const startOfMonthISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; };
const startOfYearISO = () => `${new Date().getFullYear()}-01-01`;

type Apt = {
  id: string; date: string; client: string; time: string; time_mins: number;
  employee: string | null; cabin: number | null;
  cancelled: boolean; no_show: boolean; walk_in: boolean;
};

type EmpStats = {
  total: number; attended: number; noShow: number; cancelled: number; walkIns: number;
  timeWorkedMin: number; timeIdleMin: number; daysWorked: number; utilizationPct: number;
};

const calculateStats = (appointments: Apt[], dateFrom: string, dateTo: string, empList: string[], empInfo: Record<string, { startM: number; endM: number; color: string }>) => {
  const filtered = appointments.filter(a => a.date >= dateFrom && a.date <= dateTo);

  const empDates: Record<string, Set<string>> = {};
  empList.forEach(emp => empDates[emp] = new Set());
  filtered.forEach(a => {
    if (a.employee && empList.includes(a.employee)) empDates[a.employee].add(a.date);
  });

  const stats: Record<string, EmpStats> = {};
  empList.forEach(emp => {
    stats[emp] = { total: 0, attended: 0, noShow: 0, cancelled: 0, walkIns: 0, timeWorkedMin: 0, timeIdleMin: 0, daysWorked: 0, utilizationPct: 0 };
  });

  filtered.forEach(a => {
    if (!a.employee || !empList.includes(a.employee)) return;
    const s = stats[a.employee];
    s.total++;
    if (a.no_show) s.noShow++;
    else if (a.cancelled) s.cancelled++;
    else { s.attended++; if (a.walk_in) s.walkIns++; }
  });

  empList.forEach(emp => {
    const e = empInfo[emp] || { startM: 540, endM: 1080, color: "#999" }; const s = stats[emp];
    s.daysWorked = empDates[emp].size;
    s.timeWorkedMin = s.attended * TREATMENT_MIN;
    const availablePerDay = (e.endM - e.startM) - 60;
    const totalAvailable = availablePerDay * s.daysWorked;
    s.timeIdleMin = Math.max(0, totalAvailable - s.timeWorkedMin);
    s.utilizationPct = totalAvailable > 0 ? Math.round((s.timeWorkedMin / totalAvailable) * 100) : 0;
  });

  const dailyBreakdown: Record<string, Record<string, { attended: number; noShow: number; cancelled: number; walkIns: number }>> = {};
  filtered.forEach(a => {
    if (!a.employee) return;
    if (!dailyBreakdown[a.date]) dailyBreakdown[a.date] = {};
    if (!dailyBreakdown[a.date][a.employee]) dailyBreakdown[a.date][a.employee] = { attended: 0, noShow: 0, cancelled: 0, walkIns: 0 };
    const d = dailyBreakdown[a.date][a.employee];
    if (a.no_show) d.noShow++;
    else if (a.cancelled) d.cancelled++;
    else { d.attended++; if (a.walk_in) d.walkIns++; }
  });

  const totals = {
    appointments: filtered.length,
    attended: Object.values(stats).reduce((s, x) => s + x.attended, 0),
    noShow: Object.values(stats).reduce((s, x) => s + x.noShow, 0),
    cancelled: Object.values(stats).reduce((s, x) => s + x.cancelled, 0),
    walkIns: Object.values(stats).reduce((s, x) => s + x.walkIns, 0),
    timeWorkedMin: Object.values(stats).reduce((s, x) => s + x.timeWorkedMin, 0),
  };

  return { stats, totals, dailyBreakdown, filtered };
};

export default function Dashboard({ profile, isAdmin }: { profile: Profile; isAdmin: boolean }) {
  const { employees } = useRoster();
  const [allAppointments, setAllAppointments] = useState<Apt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(startOfWeekISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [activePreset, setActivePreset] = useState("week");

  const myEmployee = profile?.employee_name || "";

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from("appointments").select("*").order("date", { ascending: true });
        if (error) throw error;
        setAllAppointments((data as Apt[]) || []);
      } catch (e) {
        console.error("Dashboard load error:", e);
      }
      setLoading(false);
    })();
  }, []);

  const empList = useMemo(
    () => Array.from(new Set([...employees.map((e) => e.name), ...(allAppointments.map((a) => a.employee).filter(Boolean) as string[])])),
    [employees, allAppointments]
  );
  const empInfo = useMemo(() => {
    const info: Record<string, { startM: number; endM: number; color: string }> = {};
    for (const e of employees) { const h = repHours(e); info[e.name] = { startM: h.startMin, endM: h.endMin, color: e.color }; }
    for (const n of empList) { if (!info[n]) info[n] = { startM: 540, endM: 1080, color: "#999" }; }
    return info;
  }, [employees, empList]);

  const { stats, totals, dailyBreakdown, filtered } = useMemo(
    () => calculateStats(allAppointments, dateFrom, dateTo, empList, empInfo),
    [allAppointments, dateFrom, dateTo, empList, empInfo]
  );

  const visibleEmployees = isAdmin ? empList : [myEmployee].filter(e => empList.includes(e));

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    if (preset === "today") { setDateFrom(todayISO()); setDateTo(todayISO()); }
    else if (preset === "week") { setDateFrom(startOfWeekISO()); setDateTo(todayISO()); }
    else if (preset === "last7") { setDateFrom(daysAgoISO(6)); setDateTo(todayISO()); }
    else if (preset === "month") { setDateFrom(startOfMonthISO()); setDateTo(todayISO()); }
    else if (preset === "last30") { setDateFrom(daysAgoISO(29)); setDateTo(todayISO()); }
    else if (preset === "year") { setDateFrom(startOfYearISO()); setDateTo(todayISO()); }
  };

  const exportDashboard = () => {
    try {
      const wb = XLSX.utils.book_new();
      const summaryRows: (string | number)[][] = [
        ["REPORTE CHARM CLÍNICA"],
        ["Período:", `${dateFrom} a ${dateTo}`],
        ["Generado:", new Date().toLocaleString("es-DO")],
        [],
        ["Empleada","Días trabajados","Atendidos","No asistió","Canceló","Sin cita","Tiempo trabajado","Tiempo inactivo","Utilización %"],
      ];
      visibleEmployees.forEach(emp => {
        const s = stats[emp];
        summaryRows.push([emp, s.daysWorked, s.attended, s.noShow, s.cancelled, s.walkIns, formatHours(s.timeWorkedMin), formatHours(s.timeIdleMin), `${s.utilizationPct}%`]);
      });
      if (isAdmin) {
        summaryRows.push([]);
        summaryRows.push(["TOTALES","",totals.attended,totals.noShow,totals.cancelled,totals.walkIns,formatHours(totals.timeWorkedMin),"",""]);
      }
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{wch:14},{wch:16},{wch:12},{wch:12},{wch:10},{wch:10},{wch:18},{wch:18},{wch:14}];
      XLSX.utils.book_append_sheet(wb, ws1, "Resumen");

      const dailyRows: (string | number)[][] = [["Fecha","Empleada","Atendidos","No asistió","Canceló","Sin cita"]];
      Object.keys(dailyBreakdown).sort().forEach(date => {
        visibleEmployees.forEach(emp => {
          const d = dailyBreakdown[date][emp];
          if (!d) return;
          dailyRows.push([date, emp, d.attended, d.noShow, d.cancelled, d.walkIns]);
        });
      });
      const ws2 = XLSX.utils.aoa_to_sheet(dailyRows);
      ws2["!cols"] = [{wch:12},{wch:12},{wch:12},{wch:12},{wch:10},{wch:10}];
      XLSX.utils.book_append_sheet(wb, ws2, "Detalle Diario");

      const aptRows: (string | number)[][] = [["Fecha","Hora","Cliente","Empleada","Cabina","Sin cita","No asistió","Canceló"]];
      filtered.forEach(a => {
        if (!isAdmin && a.employee !== myEmployee) return;
        aptRows.push([a.date, a.time, a.client, a.employee || "", a.cabin || "", a.walk_in?"Sí":"", a.no_show?"Sí":"", a.cancelled?"Sí":""]);
      });
      const ws3 = XLSX.utils.aoa_to_sheet(aptRows);
      ws3["!cols"] = [{wch:12},{wch:12},{wch:30},{wch:12},{wch:8},{wch:10},{wch:10},{wch:10}];
      XLSX.utils.book_append_sheet(wb, ws3, "Todas las citas");

      XLSX.writeFile(wb, `REPORTE_CHARM_${dateFrom}_a_${dateTo}.xlsx`);
    } catch (e) {
      alert("Error al exportar: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <div className="text-xs font-label text-accent">CARGANDO REPORTE…</div>
      </div>
    );
  }

  const dailyChartData = Object.keys(dailyBreakdown).sort().map(date => {
    const dayTotals: Record<string, number> = {};
    visibleEmployees.forEach(emp => { dayTotals[emp] = dailyBreakdown[date][emp]?.attended || 0; });
    return { date, ...dayTotals } as { date: string } & Record<string, number>;
  });
  const maxDailyClients = Math.max(1, ...dailyChartData.flatMap(d => visibleEmployees.map(emp => d[emp] || 0)));

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-xs font-label text-accent">REPORTES Y ESTADÍSTICAS</div>
          <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 400, lineHeight: 1.1 }}>
            {isAdmin ? "Dashboard del equipo" : "Mis estadísticas"}
          </h2>
        </div>
        <button onClick={exportDashboard} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-2">
          <Download size={14} /> Exportar Reporte
        </button>
      </div>

      <div className="border border-border bg-card p-4 mb-6">
        <div className="text-xs font-label mb-3 flex items-center gap-2 text-accent">
          <Filter size={12} /> FILTROS DE FECHA
        </div>
        <div className="flex gap-2 flex-wrap mb-4">
          {[
            { key: "today", label: "Hoy" },
            { key: "week", label: "Esta semana" },
            { key: "last7", label: "Últimos 7 días" },
            { key: "month", label: "Este mes" },
            { key: "last30", label: "Últimos 30 días" },
            { key: "year", label: "Este año" },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => applyPreset(key)}
              className="px-3 py-2 text-xs font-label border border-primary"
              style={{
                backgroundColor: activePreset === key ? "hsl(var(--primary))" : "transparent",
                color: activePreset === key ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
              }}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-label mb-1 text-muted-foreground">Desde</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActivePreset("custom"); }}
              className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground" />
          </div>
          <div>
            <label className="block text-xs font-label mb-1 text-muted-foreground">Hasta</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActivePreset("custom"); }}
              className="w-full px-3 py-2 border border-border bg-background text-sm text-foreground" />
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<Users size={16} />} label="Atendidos" value={totals.attended} color="#3A8769" />
          <StatCard icon={<AlertCircle size={16} />} label="No asistió" value={totals.noShow} color="#C53A2D" />
          <StatCard icon={<AlertCircle size={16} />} label="Canceló" value={totals.cancelled} color="#8A5A6E" />
          <StatCard icon={<TrendingUp size={16} />} label="Sin cita" value={totals.walkIns} color="#C2566E" />
        </div>
      )}

      <div className="space-y-4">
        {visibleEmployees.map(emp => {
          const s = stats[emp]; const e = empInfo[emp];
          if (!s || !e) return null;
          const showRate = s.attended + s.noShow + s.cancelled > 0
            ? Math.round((s.attended / (s.attended + s.noShow + s.cancelled)) * 100) : 0;
          return (
            <div key={emp} className="border border-border bg-card" style={{ borderLeft: `4px solid ${e.color}` }}>
              <div className="p-5">
                <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-primary" style={{ fontSize: 32, fontWeight: 500 }}>{emp}</span>
                    <span className="text-xs font-label" style={{ color: e.color }}>
                      {s.daysWorked} día{s.daysWorked === 1 ? "" : "s"} trabajado{s.daysWorked === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <Award size={14} className="text-accent" />
                    <span className="text-xs font-label text-muted-foreground">UTILIZACIÓN</span>
                    <span className="font-display" style={{ fontSize: 28, fontWeight: 500, color: s.utilizationPct >= 70 ? "#3A8769" : s.utilizationPct >= 40 ? "#C2566E" : "#C53A2D" }}>
                      {s.utilizationPct}%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MiniStat label="Atendidos" value={s.attended} sub={`${showRate}% asistencia`} />
                  <MiniStat label="No asistió" value={s.noShow} color="#C53A2D" />
                  <MiniStat label="Canceló" value={s.cancelled} color="#8A5A6E" />
                  <MiniStat label="Sin cita" value={s.walkIns} color="#C2566E" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  <TimeBar label="Tiempo trabajado" value={s.timeWorkedMin} max={s.timeWorkedMin + s.timeIdleMin} color="#3A8769" icon={<Activity size={12} />} />
                  <TimeBar label="Tiempo inactivo" value={s.timeIdleMin} max={s.timeWorkedMin + s.timeIdleMin} color="#E8E0DB" icon={<Clock size={12} />} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin && dailyChartData.length > 0 && (
        <div className="mt-6 border border-border bg-card p-5">
          <div className="text-xs font-label mb-4 flex items-center gap-2 text-accent">
            <Calendar size={12} /> CLIENTES ATENDIDOS POR DÍA
          </div>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2" style={{ minHeight: 180, minWidth: `${dailyChartData.length * 80}px` }}>
              {dailyChartData.map(day => (
                <div key={day.date} className="flex-1 min-w-[60px] flex flex-col items-center">
                  <div className="flex items-end gap-0.5 h-40 w-full justify-center">
                    {visibleEmployees.map(emp => {
                      const v = day[emp] || 0;
                      const heightPct = (v / maxDailyClients) * 100;
                      return (
                        <div key={emp} className="flex-1 flex flex-col items-center justify-end" title={`${emp}: ${v}`}>
                          {v > 0 && (
                            <>
                              <div className="text-[9px] text-primary">{v}</div>
                              <div style={{ width: "100%", height: `${heightPct}%`, backgroundColor: empInfo[emp]?.color || "#999", minHeight: 2 }} />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] mt-1 tracking-wide whitespace-nowrap text-muted-foreground">
                    {formatDateShort(day.date)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 flex-wrap mt-4 text-[11px]">
            {visibleEmployees.map(emp => (
              <div key={emp} className="flex items-center gap-1.5">
                <div style={{ width: 10, height: 10, backgroundColor: empInfo[emp]?.color || "#999" }} />
                <span className="text-muted-foreground">{emp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="border border-border bg-card p-8 text-center text-sm italic mt-6 text-muted-foreground">
          No hay datos en el rango seleccionado.
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="border border-border bg-card p-4" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="text-xs font-label flex items-center gap-1 text-accent">{icon} {label.toUpperCase()}</div>
      <div className="font-display" style={{ fontSize: 40, fontWeight: 300, color, lineHeight: 1, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] font-label text-accent">{label.toUpperCase()}</div>
      <div className="font-display" style={{ fontSize: 28, fontWeight: 400, color: color || "hsl(var(--primary))", lineHeight: 1 }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5 italic text-accent">{sub}</div>}
    </div>
  );
}

function TimeBar({ label, value, max, color, icon }: { label: string; value: number; max: number; color: string; icon: React.ReactNode }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="flex items-center gap-1 text-muted-foreground">{icon} {label}</span>
        <span className="text-primary font-medium">{formatHours(value)}</span>
      </div>
      <div className="h-2 w-full" style={{ backgroundColor: "#EFE7E2" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}
