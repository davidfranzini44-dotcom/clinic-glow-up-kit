import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────
export type DaySchedule = {
  works: boolean;
  startMin: number;
  endMin: number;
  lunchStartMin: number | null;
  lunchMinutes: number;
};

export type Employee = {
  name: string;
  cabin: number | null;
  color: string;
  maxClients: number | null;
  active: boolean;
  sortOrder: number;
  schedule: Record<number, DaySchedule>; // weekday 0 (Sun) .. 6 (Sat)
};

export type TimeOffMap = Record<string, Set<string>>; // name -> set of "YYYY-MM-DD"

// End-of-shift buffer: don't auto-assign within N minutes of an employee's end time. 0 = off.
const END_BUFFER_KEY = "charm_end_buffer_min";
export const getEndBuffer = (): number => {
  try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(END_BUFFER_KEY) : null; const n = v ? parseInt(v, 10) : 0; return isNaN(n) ? 0 : n; } catch { return 0; }
};
export const setEndBuffer = (mins: number) => {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(END_BUFFER_KEY, String(Math.max(0, mins | 0))); } catch { /* ignore */ }
};

// In-memory cache so multiple useRoster() callers don't each re-query.
let rosterCache: { employees: Employee[]; timeOff: TimeOffMap } | null = null;
let rosterInflight: Promise<{ employees: Employee[]; timeOff: TimeOffMap }> | null = null;
export const invalidateRoster = () => { rosterCache = null; rosterInflight = null; };

// ─── Fallback defaults (mirror the pre-DB hardcoded roster) ───────────
const DEFAULT_DEF = [
  { name: "Yaira",  cabin: 2, color: "hsl(var(--emp-yaira))",  max: null as number | null, s: 540, e: 1080, l: 720 },
  { name: "Belkis", cabin: 1, color: "hsl(var(--emp-belkis))", max: null as number | null, s: 600, e: 1081, l: 780 },
  { name: "Cielo",  cabin: 1, color: "hsl(var(--emp-cielo))",  max: null as number | null, s: 660, e: 1200, l: 720 },
  { name: "Lisa",   cabin: 2, color: "hsl(var(--emp-lisa))",   max: 8 as number | null,    s: 720, e: 1200, l: 780 },
];

function defaultSchedule(s: number, e: number, l: number): Record<number, DaySchedule> {
  const sched: Record<number, DaySchedule> = {};
  for (let wd = 0; wd <= 6; wd++) {
    sched[wd] = { works: wd !== 0, startMin: s, endMin: e, lunchStartMin: l, lunchMinutes: 60 };
  }
  return sched;
}

export const DEFAULT_EMPLOYEES: Employee[] = DEFAULT_DEF.map((d, i) => ({
  name: d.name, cabin: d.cabin, color: d.color, maxClients: d.max, active: true, sortOrder: i + 1,
  schedule: defaultSchedule(d.s, d.e, d.l),
}));

// ─── DB row shapes ────────────────────────────────────────────────────
type SettingRow = { name: string; cabin: number | null; color: string | null; max_clients: number | null; active: boolean; sort_order: number };
type SchedRow = { employee_name: string; weekday: number; works: boolean; start_min: number | null; end_min: number | null; lunch_start_min: number | null; lunch_minutes: number };
type TimeOffRow = { employee_name: string; date: string };

export function buildEmployees(settings: SettingRow[], scheds: SchedRow[]): Employee[] {
  const byName: Record<string, Employee> = {};
  for (const s of settings) {
    byName[s.name] = {
      name: s.name,
      cabin: s.cabin,
      color: s.color || "hsl(var(--muted-foreground))",
      maxClients: s.max_clients,
      active: s.active,
      sortOrder: s.sort_order,
      schedule: {},
    };
  }
  for (const r of scheds) {
    const emp = byName[r.employee_name];
    if (!emp) continue;
    emp.schedule[r.weekday] = {
      works: r.works,
      startMin: r.start_min ?? 0,
      endMin: r.end_min ?? 0,
      lunchStartMin: r.lunch_start_min,
      lunchMinutes: r.lunch_minutes ?? 60,
    };
  }
  return Object.values(byName).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function fetchRoster(force = false): Promise<{ employees: Employee[]; timeOff: TimeOffMap }> {
  if (!force && rosterCache) return rosterCache;
  if (!force && rosterInflight) return rosterInflight;
  const run = _fetchRosterUncached();
  rosterInflight = run;
  const result = await run;
  rosterCache = result;
  rosterInflight = null;
  return result;
}

async function _fetchRosterUncached(): Promise<{ employees: Employee[]; timeOff: TimeOffMap }> {
  const [settingsRes, schedRes, offRes] = await Promise.all([
    supabase.from("employee_settings").select("*").eq("active", true).order("sort_order"),
    supabase.from("employee_schedules").select("*"),
    supabase.from("employee_time_off").select("employee_name,date"),
  ]);
  const settings = (settingsRes.data ?? []) as SettingRow[];
  const scheds = (schedRes.data ?? []) as SchedRow[];
  const offs = (offRes.data ?? []) as TimeOffRow[];
  const timeOff: TimeOffMap = {};
  for (const o of offs) {
    (timeOff[o.employee_name] ??= new Set<string>()).add(o.date);
  }
  const employees = settings.length ? buildEmployees(settings, scheds) : DEFAULT_EMPLOYEES;
  return { employees, timeOff };
}

export function useRoster() {
  const [employees, setEmployees] = useState<Employee[]>(DEFAULT_EMPLOYEES);
  const [timeOff, setTimeOff] = useState<TimeOffMap>({});
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (force = true) => {
    try {
      const r = await fetchRoster(force);
      if (r.employees.length) setEmployees(r.employees);
      setTimeOff(r.timeOff);
    } catch (e) {
      console.error("Roster load failed; using defaults", e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(false); }, [reload]);
  return { employees, timeOff, loading, reload };
}

// ─── Scheduling helpers ───────────────────────────────────────────────
export function weekdayOf(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

export function isWorkingOn(emp: Employee, mins: number, weekday: number, endBufferMin = 0): boolean {
  const d = emp.schedule[weekday];
  if (!d || !d.works) return false;
  if (mins < d.startMin || mins >= d.endMin - endBufferMin) return false;
  if (d.lunchStartMin != null && mins >= d.lunchStartMin && mins < d.lunchStartMin + d.lunchMinutes) return false;
  return true;
}

export function onLunchOn(emp: Employee, mins: number, weekday: number): boolean {
  const d = emp.schedule[weekday];
  if (!d || d.lunchStartMin == null) return false;
  return mins >= d.lunchStartMin && mins < d.lunchStartMin + d.lunchMinutes;
}

export function isOffOn(timeOff: TimeOffMap, name: string, dateStr: string): boolean {
  return !!timeOff[name]?.has(dateStr);
}

// ─── Auto-assignment (dynamic roster, honors hours/lunch/days off/time off/caps) ──
export type AssignableAppt = {
  timeMins: number;
  cancelled: boolean;
  employee: string | null;
  cabin: number | null;
};

export function autoAssign<T extends AssignableAppt>(
  appts: T[],
  dateStr: string,
  employees: Employee[],
  timeOff: TimeOffMap,
  endBufferMin = 0
): T[] {
  const wd = weekdayOf(dateStr);
  const roster = employees.length ? employees : DEFAULT_EMPLOYEES;
  const sorted = [...appts].sort((a, b) => a.timeMins - b.timeMins);
  const total = sorted.filter(a => !a.cancelled).length;

  // Targets: capped employees get up to their cap (≈ fair share); the rest split the remainder.
  const fair = Math.round(total / Math.max(1, roster.length));
  const targets: Record<string, number> = {};
  let remaining = total;
  const uncapped: Employee[] = [];
  for (const e of roster) {
    if (e.maxClients != null) {
      const t = Math.min(e.maxClients, Math.max(0, fair));
      targets[e.name] = t;
      remaining -= t;
    } else {
      uncapped.push(e);
    }
  }
  remaining = Math.max(0, remaining);
  const per = Math.floor(remaining / Math.max(1, uncapped.length));
  let extra = remaining - per * uncapped.length;
  for (const e of uncapped) { targets[e.name] = per + (extra-- > 0 ? 1 : 0); }

  const counts: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};
  for (const e of roster) { counts[e.name] = 0; lastSeen[e.name] = -999; }
  const usedAtSlot: Record<number, Set<string>> = {};

  return sorted.map((apt) => {
    if (apt.cancelled) return { ...apt };
    const t = apt.timeMins;
    (usedAtSlot[t] ??= new Set<string>());
    const slotUsed = usedAtSlot[t];

    let available = roster.filter(e =>
      isWorkingOn(e, t, wd, endBufferMin) && !isOffOn(timeOff, e.name, dateStr) &&
      (e.maxClients == null || counts[e.name] < e.maxClients)
    );
    if (available.length === 0) available = roster.filter(e => isWorkingOn(e, t, wd, endBufferMin) && !isOffOn(timeOff, e.name, dateStr));
    if (available.length === 0) available = roster.filter(e => !isOffOn(timeOff, e.name, dateStr));
    if (available.length === 0) available = [...roster];

    const notYet = available.filter(e => !slotUsed.has(e.name));
    let pool: Employee[];
    if (notYet.length > 0) {
      const under = notYet.filter(e => counts[e.name] < (targets[e.name] ?? 0));
      pool = under.length > 0 ? under : notYet;
    } else {
      const under = available.filter(e => counts[e.name] < (targets[e.name] ?? 0));
      pool = under.length > 0 ? under : available;
    }

    pool.sort((a, b) => {
      const dA = (targets[a.name] ?? 0) - counts[a.name];
      const dB = (targets[b.name] ?? 0) - counts[b.name];
      if (dA !== dB) return dB - dA;
      return (t - lastSeen[b.name]) - (t - lastSeen[a.name]);
    });

    const chosen = pool[0];
    counts[chosen.name]++;
    lastSeen[chosen.name] = t;
    slotUsed.add(chosen.name);
    return { ...apt, employee: chosen.name, cabin: chosen.cabin };
  });
}

// Representative working-day hours (for capacity/utilization metrics).
export function repHours(emp: Employee): { startMin: number; endMin: number } {
  for (let wd = 1; wd <= 6; wd++) {
    const d = emp.schedule[wd];
    if (d && d.works) return { startMin: d.startMin, endMin: d.endMin };
  }
  const any = Object.values(emp.schedule).find((d) => d.works);
  return any ? { startMin: any.startMin, endMin: any.endMin } : { startMin: 540, endMin: 1080 };
}
