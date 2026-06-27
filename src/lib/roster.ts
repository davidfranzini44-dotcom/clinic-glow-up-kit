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
  cabins: number[];
  color: string;
  maxClients: number | null;
  active: boolean;
  sortOrder: number;
  schedule: Record<number, DaySchedule>; // weekday 0 (Sun) .. 6 (Sat)
};

export type TimeOffMap = Record<string, Set<string>>; // name -> set of "YYYY-MM-DD"
export type DateOverride = { start_min: number | null; end_min: number | null };
export type OverridesMap = Record<string, Record<string, DateOverride>>; // name -> date -> override

// End-of-shift buffer: don't auto-assign within N minutes of an employee's end time. 0 = off.
const END_BUFFER_KEY = "charm_end_buffer_min";
export const getEndBuffer = (): number => {
  try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(END_BUFFER_KEY) : null; const n = v ? parseInt(v, 10) : 0; return isNaN(n) ? 0 : n; } catch { return 0; }
};
export const setEndBuffer = (mins: number) => {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(END_BUFFER_KEY, String(Math.max(0, mins | 0))); } catch { /* ignore */ }
};

// In-memory cache so multiple useRoster() callers don't each re-query.
let rosterCache: { employees: Employee[]; timeOff: TimeOffMap; overrides: OverridesMap } | null = null;
let rosterInflight: Promise<{ employees: Employee[]; timeOff: TimeOffMap; overrides: OverridesMap }> | null = null;
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
  name: d.name, cabin: d.cabin, cabins: d.cabin != null ? [d.cabin] : [], color: d.color, maxClients: d.max, active: true, sortOrder: i + 1,
  schedule: defaultSchedule(d.s, d.e, d.l),
}));

// ─── DB row shapes ────────────────────────────────────────────────────
type SettingRow = { name: string; cabin: number | null; cabins?: string | null; color: string | null; max_clients: number | null; active: boolean; sort_order: number };
type SchedRow = { employee_name: string; weekday: number; works: boolean; start_min: number | null; end_min: number | null; lunch_start_min: number | null; lunch_minutes: number };
type TimeOffRow = { employee_name: string; date: string };

function parseCabins(cabins: string | null | undefined, fallback: number | null): number[] {
  if (cabins && cabins.trim()) {
    const arr = cabins.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));
    if (arr.length) return Array.from(new Set(arr));
  }
  return fallback != null ? [fallback] : [];
}

export function buildEmployees(settings: SettingRow[], scheds: SchedRow[]): Employee[] {
  const byName: Record<string, Employee> = {};
  for (const s of settings) {
    byName[s.name] = {
      name: s.name,
      cabin: s.cabin,
      cabins: parseCabins(s.cabins, s.cabin),
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

export async function fetchRoster(force = false): Promise<{ employees: Employee[]; timeOff: TimeOffMap; overrides: OverridesMap }> {
  if (!force && rosterCache) return rosterCache;
  if (!force && rosterInflight) return rosterInflight;
  const run = _fetchRosterUncached();
  rosterInflight = run;
  const result = await run;
  rosterCache = result;
  rosterInflight = null;
  return result;
}

async function _fetchRosterUncached(): Promise<{ employees: Employee[]; timeOff: TimeOffMap; overrides: OverridesMap }> {
  const [settingsRes, schedRes, offRes, ovRes] = await Promise.all([
    supabase.from("employee_settings").select("*").eq("active", true).order("sort_order"),
    supabase.from("employee_schedules").select("*"),
    supabase.from("employee_time_off").select("employee_name,date"),
    supabase.from("employee_date_overrides").select("employee_name,date,start_min,end_min"),
  ]);
  const settings = (settingsRes.data ?? []) as SettingRow[];
  const scheds = (schedRes.data ?? []) as SchedRow[];
  const offs = (offRes.data ?? []) as TimeOffRow[];
  const timeOff: TimeOffMap = {};
  for (const o of offs) {
    (timeOff[o.employee_name] ??= new Set<string>()).add(o.date);
  }
  const employees = settings.length ? buildEmployees(settings, scheds) : DEFAULT_EMPLOYEES;
  const overrides: OverridesMap = {};
  for (const o of (ovRes.data ?? []) as { employee_name: string; date: string; start_min: number | null; end_min: number | null }[]) {
    (overrides[o.employee_name] ??= {})[o.date] = { start_min: o.start_min, end_min: o.end_min };
  }
  return { employees, timeOff, overrides };
}

export function useRoster() {
  const [employees, setEmployees] = useState<Employee[]>(DEFAULT_EMPLOYEES);
  const [timeOff, setTimeOff] = useState<TimeOffMap>({});
  const [overrides, setOverrides] = useState<OverridesMap>({});
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (force = true) => {
    try {
      const r = await fetchRoster(force);
      if (r.employees.length) setEmployees(r.employees);
      setTimeOff(r.timeOff);
      setOverrides(r.overrides);
    } catch (e) {
      console.error("Roster load failed; using defaults", e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(false); }, [reload]);
  return { employees, timeOff, overrides, loading, reload };
}

// ─── Scheduling helpers ───────────────────────────────────────────────
export function weekdayOf(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

export function isWorkingOn(emp: Employee, mins: number, weekday: number, endBufferMin = 0, ov?: DateOverride | null): boolean {
  const d = emp.schedule[weekday];
  if (!d || !d.works) return false;
  const startMin = ov?.start_min ?? d.startMin;
  const endMin = ov?.end_min ?? d.endMin;
  if (mins < startMin || mins >= endMin - endBufferMin) return false;
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
  arrivedAt?: string | null;
};

export function autoAssign<T extends AssignableAppt>(
  appts: T[],
  dateStr: string,
  employees: Employee[],
  timeOff: TimeOffMap,
  endBufferMin = 0,
  overrides: OverridesMap = {}
): T[] {
  const wd = weekdayOf(dateStr);
  const roster = employees.length ? employees : DEFAULT_EMPLOYEES;
  const sorted = [...appts].sort((a, b) => a.timeMins - b.timeMins);
  const total = sorted.filter(a => !a.cancelled).length;

  // Targets (water-filling): split the day evenly; when someone hits her cap,
  // her surplus is redistributed evenly among everyone still below cap.
  const targets: Record<string, number> = {};
  for (const e of roster) targets[e.name] = 0;
  let remaining = total;
  let active = roster.filter(e => e.maxClients == null || e.maxClients > 0);
  while (remaining > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    let dist = 0;
    for (const e of active) {
      if (remaining - dist <= 0) break;
      const cap = e.maxClients ?? Number.POSITIVE_INFINITY;
      const add = Math.min(share, cap - targets[e.name], remaining - dist);
      if (add > 0) { targets[e.name] += add; dist += add; }
    }
    if (dist === 0) break;
    remaining -= dist;
    active = active.filter(e => (e.maxClients ?? Number.POSITIVE_INFINITY) > targets[e.name]);
  }

  const counts: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};
  const firstAssigned: Record<string, number> = {};
  for (const e of roster) { counts[e.name] = 0; lastSeen[e.name] = -999; firstAssigned[e.name] = Number.POSITIVE_INFINITY; }
  const shiftStart = (e: Employee): number =>
    overrides[e.name]?.[dateStr]?.start_min ?? e.schedule[wd]?.startMin ?? 0;
  const usedAtSlot: Record<number, Set<string>> = {};
  const slotCnt: Record<number, Record<string, number>> = {};

  // Assign the hardest-to-cover hours first (slots with the fewest available
  // employees), so scarce evening/morning capacity is reserved before the
  // flexible mid-day hours are distributed. Output stays in time order.
  const availCount = (mins: number) =>
    roster.filter(e => isWorkingOn(e, mins, wd, endBufferMin, overrides[e.name]?.[dateStr]) && !isOffOn(timeOff, e.name, dateStr)).length;
  const order = sorted.map((_, i) => i).sort((a, b) => {
    const ca = availCount(sorted[a].timeMins);
    const cb = availCount(sorted[b].timeMins);
    if (ca !== cb) return ca - cb;
    return sorted[a].timeMins - sorted[b].timeMins;
  });
  const result: T[] = new Array(sorted.length);
  // Pre-place locked citas (already arrived): never move them; count them so
  // the rest of the day balances around them.
  const lockedIdx = new Set<number>();
  sorted.forEach((apt, i) => {
    if (apt.cancelled || !apt.arrivedAt || !apt.employee) return;
    lockedIdx.add(i);
    const t = apt.timeMins;
    (usedAtSlot[t] ??= new Set<string>()).add(apt.employee);
    (slotCnt[t] ??= {})[apt.employee] = (slotCnt[t][apt.employee] ?? 0) + 1;
    counts[apt.employee] = (counts[apt.employee] ?? 0) + 1;
    if (t > (lastSeen[apt.employee] ?? -999)) lastSeen[apt.employee] = t;
    if (t < (firstAssigned[apt.employee] ?? Number.POSITIVE_INFINITY)) firstAssigned[apt.employee] = t;
    result[i] = { ...apt };
  });
  for (const idx of order) {
    if (lockedIdx.has(idx)) continue;
    const apt = sorted[idx];
    if (apt.cancelled) { result[idx] = { ...apt }; continue; }
    const t = apt.timeMins;
    (usedAtSlot[t] ??= new Set<string>());
    const slotUsed = usedAtSlot[t];

    let available = roster.filter(e =>
      isWorkingOn(e, t, wd, endBufferMin, overrides[e.name]?.[dateStr]) && !isOffOn(timeOff, e.name, dateStr) &&
      (e.maxClients == null || counts[e.name] < e.maxClients)
    );
    if (available.length === 0) available = roster.filter(e => isWorkingOn(e, t, wd, endBufferMin, overrides[e.name]?.[dateStr]) && !isOffOn(timeOff, e.name, dateStr));
    if (available.length === 0) available = roster.filter(e => isWorkingOn(e, t, wd, 0, overrides[e.name]?.[dateStr]) && !isOffOn(timeOff, e.name, dateStr));
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
      // Spread forced over-capacity: fewer citas already in THIS slot first
      const sa = slotCnt[t]?.[a.name] ?? 0, sb = slotCnt[t]?.[b.name] ?? 0;
      if (sa !== sb) return sa - sb;
      // Whoever just started her shift and has nothing yet works first
      const stA = shiftStart(a), stB = shiftStart(b);
      const startA = t >= stA && t - stA <= 60 && firstAssigned[a.name] > t ? 1 : 0;
      const startB = t >= stB && t - stB <= 60 && firstAssigned[b.name] > t ? 1 : 0;
      if (startA !== startB) return startB - startA;
      const dA = (targets[a.name] ?? 0) - counts[a.name];
      const dB = (targets[b.name] ?? 0) - counts[b.name];
      if (dA !== dB) return dB - dA;
      return (t - lastSeen[b.name]) - (t - lastSeen[a.name]);
    });

    const chosen = pool[0];
    counts[chosen.name]++;
    (slotCnt[t] ??= {})[chosen.name] = (slotCnt[t][chosen.name] ?? 0) + 1;
    lastSeen[chosen.name] = t;
    if (t < firstAssigned[chosen.name]) firstAssigned[chosen.name] = t;
    slotUsed.add(chosen.name);
    result[idx] = { ...apt, employee: chosen.name, cabin: chosen.cabin };
  }

  // ── Spread the afternoon (>= 2pm): rotate so the same person does not work
  //    back-to-back. These swaps only relabel afternoon citas between two
  //    employees, so every person's daily total (and caps) stay exactly the
  //    same; only WHO works consecutive slots changes.
  {
    const AFTER = 14 * 60;
    const byName: Record<string, Employee> = {};
    for (const e of roster) byName[e.name] = e;
    const canWork = (name: string, t: number): boolean => {
      const e = byName[name];
      return !!e && isWorkingOn(e, t, wd, endBufferMin, overrides[name]?.[dateStr]) && !isOffOn(timeOff, name, dateStr);
    };
    const aIdx = result
      .map((_, i) => i)
      .filter(i => result[i] && !result[i].cancelled && !result[i].arrivedAt && !!result[i].employee && result[i].timeMins >= AFTER);
    if (aIdx.length >= 3) {
      const times = Array.from(new Set(aIdx.map(i => result[i].timeMins))).sort((a, b) => a - b);
      const setAt = (tt: number): Set<string> => {
        const set = new Set<string>();
        for (const i of aIdx) { const emp = result[i].employee; if (emp && result[i].timeMins === tt) set.add(emp); }
        return set;
      };
      const cost = (): number => {
        let c = 0;
        for (let k = 0; k < times.length - 1; k++) {
          const a = setAt(times[k]); const b = setAt(times[k + 1]);
          for (const n of a) if (b.has(n)) c++;
        }
        return c;
      };
      let guard = 0; let improved = true;
      while (improved && guard++ < 300) {
        improved = false;
        const base = cost();
        if (base === 0) break;
        for (let p = 0; p < aIdx.length && !improved; p++) {
          for (let q = p + 1; q < aIdx.length; q++) {
            const A = result[aIdx[p]]; const B = result[aIdx[q]];
            if (A.timeMins === B.timeMins) continue;
            const eA = A.employee; const eB = B.employee;
            if (!eA || !eB || eA === eB) continue;
            if (!canWork(eB, A.timeMins) || !canWork(eA, B.timeMins)) continue;
            if (setAt(A.timeMins).has(eB) || setAt(B.timeMins).has(eA)) continue;
            A.employee = eB; A.cabin = byName[eB].cabin;
            B.employee = eA; B.cabin = byName[eA].cabin;
            if (cost() < base) { improved = true; break; }
            A.employee = eA; A.cabin = byName[eA].cabin;
            B.employee = eB; B.cabin = byName[eB].cabin;
          }
        }
      }
    }
  }

  // Assign each cita a free cabina from its employee's set, so two people who
  // share a cabina don't land in it at the same time, and an employee with
  // several cabinas gets whichever is open.
  {
    const empCabs: Record<string, number[]> = {};
    for (const e of roster) empCabs[e.name] = e.cabins && e.cabins.length ? e.cabins : (e.cabin != null ? [e.cabin] : []);
    const bySlot: Record<number, number[]> = {};
    result.forEach((r, i) => { if (r && !r.cancelled && r.employee) (bySlot[r.timeMins] ||= []).push(i); });
    for (const k of Object.keys(bySlot)) {
      const used = new Set<number>();
      const idxs = bySlot[Number(k)];
      // Arrived citas keep their cabina; reserve it so others avoid it.
      for (const i of idxs) { if (result[i].arrivedAt && result[i].cabin != null) used.add(result[i].cabin as number); }
      // Most-constrained first: whoever has the fewest cabina options is placed
      // first, so a single-cabina person never gets blocked out by a flexible
      // one who could have taken another cabina (avoids needless collisions).
      const slotIdx = idxs.filter(i => !result[i].arrivedAt).sort((a, b) =>
        (empCabs[result[a].employee as string] || []).length - (empCabs[result[b].employee as string] || []).length);
      for (const i of slotIdx) {
        const cabs = empCabs[result[i].employee as string] || [];
        let cab: number | null = null;
        for (const c of cabs) { if (!used.has(c)) { cab = c; break; } }
        if (cab == null && cabs.length) cab = cabs[0];
        if (cab != null) used.add(cab);
        result[i].cabin = cab;
      }
    }
  }

  return result;
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
