import type { Employee, TimeOffMap } from "./roster";

// ─── Chores (tareas) weekly rota ──────────────────────────────────────────
// Technician chores show as chips on their stats card; reception/closing in a
// strip; each person sees their own chores on "Mi agenda" with a suggested
// time of day (fitted around their citas) and a one-day transfer request.
// Completed chores add their minutes to the person's "tiempo trabajado".

export type ChoreSlot = "manana" | "tarde" | "cierre" | "dia";
export type ChorePlacement = "column" | "strip";

export type ChoreItem = {
  key: string;
  shortLabel: string;
  fullLabel: string;
  slot: ChoreSlot;
  minutes: number;        // counts toward tiempo trabajado when marked done
  placement: ChorePlacement;
  person: string;
  originalPerson: string;
  covered: boolean;
  transferred: boolean;
  flagged: boolean;
  employeeChip: string | null;
};

const RECEPTION = "Yeri";

export const SLOT_LABEL: Record<ChoreSlot, string> = {
  manana: "Mañana", tarde: "Tarde", cierre: "Cierre", dia: "Todo el día",
};
const SLOT_RANK: Record<ChoreSlot, number> = { manana: 0, tarde: 1, cierre: 2, dia: 3 };

type RawChore = {
  baseKey: string; shortLabel: string; fullLabel: string;
  slot: ChoreSlot; minutes: number; placement: ChorePlacement;
  ownersByDay: Record<number, string[]>;
};

const D = (mon: string, tue: string, wed: string, thu: string, fri: string, sat: string): Record<number, string[]> =>
  ({ 1: [mon], 2: [tue], 3: [wed], 4: [thu], 5: [fri], 6: [sat] });
const EVERYDAY = (who: string): Record<number, string[]> => ({ 1: [who], 2: [who], 3: [who], 4: [who], 5: [who], 6: [who] });

const RAW_CHORES: RawChore[] = [
  { baseKey: "basura", shortLabel: "Basura", fullLabel: "Recoger y tirar la basura",
    slot: "cierre", minutes: 10, placement: "strip",
    ownersByDay: D("Belkis", "Altagracia", "Lisa", "Belkis", "Altagracia", "Lisa") },
  { baseKey: "cabinas", shortLabel: "Rellenar cabinas", fullLabel: "Rellenar las cabinas",
    slot: "tarde", minutes: 15, placement: "column", ownersByDay: EVERYDAY("Yaira") },
  { baseKey: "puertas", shortLabel: "Puertas de recepción", fullLabel: "Limpiar las puertas de recepción",
    slot: "manana", minutes: 15, placement: "strip", ownersByDay: EVERYDAY(RECEPTION) },
  { baseKey: "bano", shortLabel: "Baño + área de descanso", fullLabel: "Lavar el baño y limpiar el área de descanso",
    slot: "manana", minutes: 60, placement: "column",
    ownersByDay: D("Belkis", RECEPTION, "Angelica", "Lisa", "Altagracia", "Yaira") },
  { baseKey: "gel", shortLabel: "Frascos de gel", fullLabel: "Rellenar los frascos de gel",
    slot: "tarde", minutes: 30, placement: "column",
    ownersByDay: { 2: ["Belkis", "Altagracia"], 5: ["Belkis", "Altagracia"] } },
  { baseKey: "cristales", shortLabel: "Cristales recepción + cabinas", fullLabel: "Limpiar los cristales de recepción y las cabinas",
    slot: "manana", minutes: 25, placement: "column", ownersByDay: { 1: [RECEPTION, "Angelica"] } },
  { baseKey: "limpieza", shortLabel: "Limpieza general", fullLabel: "Limpieza general",
    slot: "manana", minutes: 20, placement: "column", ownersByDay: { 1: ["Yaira"] } },
];

export type DayChores = { columns: Record<string, ChoreItem[]>; strip: ChoreItem[] };

export function choresForDate(
  dateStr: string, employees: Employee[], timeOff: TimeOffMap, overrides: Record<string, string> = {},
): DayChores {
  const out: DayChores = { columns: {}, strip: [] };
  if (!dateStr) return out;
  const weekday = new Date(dateStr + "T12:00:00").getDay();
  if (weekday < 1 || weekday > 6) return out;

  const empByName: Record<string, Employee> = {};
  for (const e of employees) empByName[e.name] = e;
  const order = [...employees].sort((a, b) => a.sortOrder - b.sortOrder).map((e) => e.name);

  const present = (name: string): boolean => {
    if (name === RECEPTION) return true;
    const e = empByName[name];
    if (!e) return false;
    if (!e.schedule[weekday]?.works) return false;
    if (timeOff[name]?.has(dateStr)) return false;
    return true;
  };

  const resolve = (owner: string, partners: string[]): { person: string; covered: boolean; flagged: boolean } => {
    if (owner === RECEPTION) return { person: owner, covered: false, flagged: false };
    if (present(owner)) return { person: owner, covered: false, flagged: false };
    for (const p of partners) if (p !== owner && p !== RECEPTION && present(p)) return { person: p, covered: true, flagged: false };
    const idx = order.indexOf(owner);
    if (idx >= 0) {
      for (let k = 1; k <= order.length; k++) {
        const cand = order[(idx + k) % order.length];
        if (cand && cand !== owner && present(cand)) return { person: cand, covered: true, flagged: false };
      }
    } else {
      for (const cand of order) if (present(cand)) return { person: cand, covered: true, flagged: false };
    }
    return { person: owner, covered: false, flagged: true };
  };

  for (const rc of RAW_CHORES) {
    const owners = rc.ownersByDay[weekday];
    if (!owners || owners.length === 0) continue;
    for (const owner of owners) {
      const r = resolve(owner, owners);
      let person = r.person, covered = r.covered, flagged = r.flagged, transferred = false;
      const key = owners.length > 1 ? `${dateStr}:${rc.baseKey}:${owner}` : `${dateStr}:${rc.baseKey}`;
      const ov = overrides[key];
      if (ov && ov !== person) { person = ov; transferred = true; covered = false; flagged = false; }
      const isTech = person !== RECEPTION && !!empByName[person];
      const employeeChip = rc.placement === "column" && isTech ? person : null;
      const item: ChoreItem = {
        key, shortLabel: rc.shortLabel, fullLabel: rc.fullLabel, slot: rc.slot, minutes: rc.minutes,
        placement: rc.placement, person, originalPerson: owner, covered, transferred, flagged, employeeChip,
      };
      if (employeeChip) (out.columns[employeeChip] ||= []).push(item);
      else out.strip.push(item);
    }
  }

  out.strip.sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot]);
  for (const k of Object.keys(out.columns)) out.columns[k].sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot]);
  return out;
}

export function choresForPerson(day: DayChores, person: string): ChoreItem[] {
  const all = [...(day.columns[person] || []), ...day.strip.filter((i) => i.person === person)];
  all.sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot]);
  return all;
}

// Minutes (per baseKey) for crediting completed chores in reports without
// recomputing the whole rota; key format is "<date>:<base>[:owner]".
export const CHORE_MINUTES: Record<string, number> = Object.fromEntries(RAW_CHORES.map((r) => [r.baseKey, r.minutes]));
export function choreMinutesForKey(key: string): number {
  const parts = key.split(":");
  return CHORE_MINUTES[parts[1]] ?? 0;
}

export type ShiftInfo = { startMin: number; endMin: number; lunchStartMin: number | null; lunchMinutes: number; busy: { s: number; e: number }[] };

// Suggest when in the day to do the chore: a free gap of the right length in
// the right window (mañana/tarde/cierre), around citas + lunch. null = no gap.
export function suggestChoreSlot(item: ChoreItem, sh: ShiftInfo): { startMin: number; endMin: number } | null {
  const dur = item.minutes;
  const { startMin, endMin, lunchStartMin, lunchMinutes } = sh;
  if (!(endMin > startMin) || dur <= 0) return null;

  // Belkis takes the trash at 6:30pm specifically.
  if (item.shortLabel === "Basura" && item.person === "Belkis") return { startMin: 1110, endMin: 1110 + dur };
  if (item.slot === "cierre") { const s = Math.max(startMin, endMin - dur); return { startMin: s, endMin }; }

  const lunchE = lunchStartMin != null ? lunchStartMin + lunchMinutes : null;
  let ws = startMin, we = endMin;
  if (item.slot === "manana") { ws = startMin; we = lunchStartMin ?? Math.min(endMin, 780); }
  else if (item.slot === "tarde") { ws = lunchE ?? Math.max(startMin, 780); we = endMin; }

  const blocks = [...sh.busy];
  if (lunchStartMin != null && lunchE != null) blocks.push({ s: lunchStartMin, e: lunchE });
  blocks.sort((a, b) => a.s - b.s);

  for (let t = ws; t + dur <= we; t += 5) {
    const e = t + dur;
    if (!blocks.some((b) => t < b.e && e > b.s)) return { startMin: t, endMin: e };
  }
  return null;
}
