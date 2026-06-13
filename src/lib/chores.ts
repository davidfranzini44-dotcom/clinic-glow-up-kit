import type { Employee, TimeOffMap } from "./roster";

// ─── Chores (tareas) weekly rota ──────────────────────────────────────────
// Surfaced on the daily agenda: technician chores as chips on their stats
// card, reception/closing chores in a "Tareas / Recepción" strip.

export type ChoreSlot = "manana" | "tarde" | "cierre" | "dia";
export type ChorePlacement = "column" | "strip";

export type ChoreItem = {
  key: string;             // stable per (date, chore[, owner]) for done-tracking
  shortLabel: string;
  fullLabel: string;
  slot: ChoreSlot;
  placement: ChorePlacement;
  person: string;          // resolved person (after coverage)
  originalPerson: string;  // originally-assigned person
  covered: boolean;        // reassigned because the original was off
  flagged: boolean;        // nobody available to cover
  employeeChip: string | null; // technician card to attach the chip to (else strip)
};

const RECEPTION = "Yeri";

export const SLOT_LABEL: Record<ChoreSlot, string> = {
  manana: "Mañana",
  tarde: "Tarde",
  cierre: "Cierre",
  dia: "Todo el día",
};

// weekday: 0 Sun .. 6 Sat. Clinic works Mon(1)..Sat(6).
type RawChore = {
  baseKey: string;
  shortLabel: string;
  fullLabel: string;
  slot: ChoreSlot;
  placement: ChorePlacement;
  ownersByDay: Record<number, string[]>;
};

const D = (mon: string, tue: string, wed: string, thu: string, fri: string, sat: string): Record<number, string[]> =>
  ({ 1: [mon], 2: [tue], 3: [wed], 4: [thu], 5: [fri], 6: [sat] });

const EVERYDAY = (who: string): Record<number, string[]> => ({ 1: [who], 2: [who], 3: [who], 4: [who], 5: [who], 6: [who] });

const RAW_CHORES: RawChore[] = [
  // Recoger y tirar la basura — cierre — alterna B→A→L dos veces por semana
  {
    baseKey: "basura", shortLabel: "Basura", fullLabel: "Recoger y tirar la basura",
    slot: "cierre", placement: "strip",
    ownersByDay: D("Belkis", "Altagracia", "Lisa", "Belkis", "Altagracia", "Lisa"),
  },
  // Rellenar las cabinas — tarde — Yaira
  {
    baseKey: "cabinas", shortLabel: "Rellenar cabinas", fullLabel: "Rellenar las cabinas",
    slot: "tarde", placement: "column", ownersByDay: EVERYDAY("Yaira"),
  },
  // Limpiar las puertas de recepción — Yeri
  {
    baseKey: "puertas", shortLabel: "Puertas de recepción", fullLabel: "Limpiar las puertas de recepción",
    slot: "dia", placement: "strip", ownersByDay: EVERYDAY(RECEPTION),
  },
  // Lavar el baño y limpiar el área de descanso — mañana — rotación diaria
  {
    baseKey: "bano", shortLabel: "Baño + área de descanso", fullLabel: "Lavar el baño y limpiar el área de descanso",
    slot: "manana", placement: "column",
    ownersByDay: D("Belkis", RECEPTION, "Angelica", "Lisa", "Altagracia", "Yaira"),
  },
  // Rellenar los frascos de gel — martes y viernes — tarde — Belkis y Altagracia
  {
    baseKey: "gel", shortLabel: "Frascos de gel", fullLabel: "Rellenar los frascos de gel",
    slot: "tarde", placement: "column",
    ownersByDay: { 2: ["Belkis", "Altagracia"], 5: ["Belkis", "Altagracia"] },
  },
  // Limpiar los cristales de recepción y las cabinas — lunes — mañana — Yeri y Angelica
  {
    baseKey: "cristales", shortLabel: "Cristales recepción + cabinas", fullLabel: "Limpiar los cristales de recepción y las cabinas",
    slot: "manana", placement: "column",
    ownersByDay: { 1: [RECEPTION, "Angelica"] },
  },
  // Limpieza general — lunes — mañana — Yaira
  {
    baseKey: "limpieza", shortLabel: "Limpieza general", fullLabel: "Limpieza general",
    slot: "manana", placement: "column", ownersByDay: { 1: ["Yaira"] },
  },
];

export type DayChores = { columns: Record<string, ChoreItem[]>; strip: ChoreItem[] };

export function choresForDate(dateStr: string, employees: Employee[], timeOff: TimeOffMap): DayChores {
  const out: DayChores = { columns: {}, strip: [] };
  if (!dateStr) return out;
  const weekday = new Date(dateStr + "T12:00:00").getDay();
  if (weekday < 1 || weekday > 6) return out; // Sunday / out of range: no chores

  const empByName: Record<string, Employee> = {};
  for (const e of employees) empByName[e.name] = e;
  const order = [...employees].sort((a, b) => a.sortOrder - b.sortOrder).map((e) => e.name);

  const present = (name: string): boolean => {
    if (name === RECEPTION) return true; // reception isn't on the technician roster
    const e = empByName[name];
    if (!e) return false;
    if (!e.schedule[weekday]?.works) return false;
    if (timeOff[name]?.has(dateStr)) return false;
    return true;
  };

  const resolve = (owner: string, partners: string[]): { person: string; covered: boolean; flagged: boolean } => {
    if (owner === RECEPTION) return { person: owner, covered: false, flagged: false };
    if (present(owner)) return { person: owner, covered: false, flagged: false };
    // owner is off → cover. Prefer a present partner, then the next present technician.
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
      const { person, covered, flagged } = resolve(owner, owners);
      const key = owners.length > 1 ? `${dateStr}:${rc.baseKey}:${owner}` : `${dateStr}:${rc.baseKey}`;
      const isTech = person !== RECEPTION && !!empByName[person];
      const employeeChip = rc.placement === "column" && isTech ? person : null;
      const item: ChoreItem = {
        key, shortLabel: rc.shortLabel, fullLabel: rc.fullLabel, slot: rc.slot,
        placement: rc.placement, person, originalPerson: owner, covered, flagged, employeeChip,
      };
      if (employeeChip) {
        (out.columns[employeeChip] ||= []).push(item);
      } else {
        out.strip.push(item);
      }
    }
  }

  const slotRank: Record<ChoreSlot, number> = { manana: 0, tarde: 1, cierre: 2, dia: 3 };
  out.strip.sort((a, b) => slotRank[a.slot] - slotRank[b.slot]);
  for (const k of Object.keys(out.columns)) out.columns[k].sort((a, b) => slotRank[a.slot] - slotRank[b.slot]);
  return out;
}
