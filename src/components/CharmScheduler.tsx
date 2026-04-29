import { useState, useMemo, useEffect, useRef } from "react";
import { Upload, UserPlus, RotateCcw, AlertCircle, FileSpreadsheet, Trash2, Copy, Check, Save, LogOut, Repeat, Lock, Unlock } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { markSaveError, markSaveStart, markSaveSuccess, syncLastSavedAt, useGlobalSaveStatus } from "@/lib/saveSync";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import Dashboard from "./Dashboard";
import SwapRequests, { SwapRequestDialog } from "./SwapRequests";
import NotificationBell from "./NotificationBell";
import GlobalSearch from "./GlobalSearch";
import ClientsModule from "./ClientsModule";
import SalesModule from "./SalesModule";
import InventoryModule from "./InventoryModule";
import ClientProfileModal from "./ClientProfileModal";
import HistoryView from "./HistoryView";

// ─── History cutoff: dates on or before this are hidden from the main agenda ─
const HISTORY_CUTOFF = "2026-04-26";

// ─── Employee config ──────────────────────────────────────────────────────
type EmpKey = "Yaira" | "Belkis" | "Cielo" | "Lisa";
const EMPLOYEES: Record<EmpKey, {
  startM: number; endM: number; assignEndM: number; lunchM: number;
  cabin: number; color: string; maxClients: number | null;
}> = {
  Yaira:  { startM: 9*60,  endM: 18*60, assignEndM: 18*60,     lunchM: 12*60, cabin: 2, color: "hsl(var(--emp-yaira))",  maxClients: null },
  Belkis: { startM: 10*60, endM: 19*60, assignEndM: 18*60 + 1, lunchM: 13*60, cabin: 1, color: "hsl(var(--emp-belkis))", maxClients: null },
  Cielo:  { startM: 11*60, endM: 20*60, assignEndM: 20*60,     lunchM: 12*60, cabin: 1, color: "hsl(var(--emp-cielo))",  maxClients: null },
  Lisa:   { startM: 12*60, endM: 20*60, assignEndM: 20*60,     lunchM: 13*60, cabin: 2, color: "hsl(var(--emp-lisa))",   maxClients: 8 },
};
const EMP_LIST: EmpKey[] = Object.keys(EMPLOYEES) as EmpKey[];

export type Profile = {
  id: string;
  display_name: string | null;
  employee_name: string | null;
};

export type Apt = {
  id: string;
  client: string;
  time: string;
  timeMins: number;
  employee: EmpKey | null;
  cabin: number | null;
  cancelled: boolean;
  noShow: boolean;
  walkIn: boolean;
  changed: string;
  swapLocked: boolean;
};

// ─── Time helpers ─────────────────────────────────────────────────────────
const parseTime = (s: any): number | null => {
  if (s === null || s === undefined) return null;
  const cleaned = String(s).replace(/[\u202f\u00a0]/g, " ").toLowerCase().trim();
  const m = cleaned.match(/(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ap = m[3];
  if (ap) {
    const isPM = ap.includes("p");
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
  }
  return h * 60 + mins;
};

const formatTime = (mins: number) => {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h24 >= 12 ? "p.m." : "a.m.";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ap}`;
};

const isWorking = (emp: EmpKey, mins: number) => {
  const e = EMPLOYEES[emp];
  if (mins < e.startM || mins >= e.assignEndM) return false;
  if (mins >= e.lunchM && mins < e.lunchM + 60) return false;
  return true;
};
const onLunch = (emp: EmpKey, mins: number) => {
  const e = EMPLOYEES[emp];
  return mins >= e.lunchM && mins < e.lunchM + 60;
};

// ─── Auto-assignment v3 ───────────────────────────────────────────────────
const autoAssign = (appointments: Apt[]): Apt[] => {
  const sorted = [...appointments].sort((a, b) => a.timeMins - b.timeMins);
  const total = sorted.filter(a => !a.cancelled).length;

  const lisaTarget = Math.min(8, Math.max(5, Math.round(total * 0.16)));
  const others = total - lisaTarget;
  const yairaTarget = Math.round(others / 3);
  const belkisTarget = Math.round(others / 3);
  const cieloTarget = others - yairaTarget - belkisTarget;
  const targets: Record<EmpKey, number> = { Yaira: yairaTarget, Belkis: belkisTarget, Cielo: cieloTarget, Lisa: lisaTarget };

  const counts: Record<EmpKey, number> = { Yaira: 0, Belkis: 0, Cielo: 0, Lisa: 0 };
  const lastSeen: Record<EmpKey, number> = { Yaira: -999, Belkis: -999, Cielo: -999, Lisa: -999 };
  const usedAtSlot: Record<number, Set<EmpKey>> = {};

  return sorted.map((apt) => {
    if (apt.cancelled) return { ...apt };
    const t = apt.timeMins;
    if (!usedAtSlot[t]) usedAtSlot[t] = new Set();
    const slotUsed = usedAtSlot[t];

    let available = EMP_LIST.filter(e => isWorking(e, t));
    if (available.length === 0) available = [...EMP_LIST];

    const notYetAtSlot = available.filter(e => !slotUsed.has(e));
    let pool: EmpKey[];
    if (notYetAtSlot.length > 0) {
      const under = notYetAtSlot.filter(e => counts[e] < targets[e]);
      pool = under.length > 0 ? under : notYetAtSlot;
    } else {
      const under = available.filter(e => counts[e] < targets[e]);
      pool = under.length > 0 ? under : available;
    }

    pool.sort((a, b) => {
      const deficitA = targets[a] - counts[a];
      const deficitB = targets[b] - counts[b];
      if (deficitA !== deficitB) return deficitB - deficitA;
      const gapA = t - lastSeen[a];
      const gapB = t - lastSeen[b];
      return gapB - gapA;
    });

    const chosen = pool[0];
    counts[chosen]++;
    lastSeen[chosen] = t;
    slotUsed.add(chosen);
    return { ...apt, employee: chosen, cabin: EMPLOYEES[chosen].cabin };
  });
};

// ─── Excel parser ─────────────────────────────────────────────────────────
const parseExcel = async (file: File): Promise<Record<string, Apt[]>> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const lc = r.map((c: any) => String(c || "").toLowerCase());
    if (lc.some(c => c.includes("client")) && lc.some(c => c.includes("time"))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error("No se encontró el encabezado. Se esperan columnas: Date, Time, Client.");

  const header = rows[headerIdx].map((c: any) => String(c || "").toLowerCase());
  const dateCol = header.findIndex((c: string) => c.includes("date"));
  const timeCol = header.findIndex((c: string) => c.includes("time"));
  const clientCol = header.findIndex((c: string) => c.includes("client"));
  if (dateCol < 0 || timeCol < 0 || clientCol < 0) throw new Error("Faltan columnas obligatorias.");

  const days: Record<string, Apt[]> = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawDate = r[dateCol];
    const time = r[timeCol];
    const client = r[clientCol];
    if (!rawDate || !time || !client) continue;
    const cstr = String(client).toLowerCase();
    if (cstr.includes("total") || cstr.includes("revenue") || cstr.includes("forecast") || cstr.includes("actual")) continue;

    let dateObj: Date;
    if (rawDate instanceof Date) dateObj = rawDate;
    else if (typeof rawDate === "number") dateObj = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
    else dateObj = new Date(rawDate);
    if (isNaN(dateObj.getTime())) continue;

    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,"0")}-${String(dateObj.getDate()).padStart(2,"0")}`;
    const timeStr = String(time).replace(/[\u202f\u00a0]/g, " ");
    const timeMins = parseTime(timeStr);
    if (timeMins === null) continue;

    if (!days[dateStr]) days[dateStr] = [];

    const clientStr = String(client).trim();
    const clientNames = clientStr.split(/\s*,\s*/).map(n => n.trim()).filter(n => n.length > 0);

    clientNames.forEach((name, nameIdx) => {
      days[dateStr].push({
        id: `${dateStr}-${i}-${nameIdx}-${Math.random().toString(36).slice(2,7)}`,
        client: name,
        time: timeStr.trim(),
        timeMins,
        employee: null,
        cabin: null,
        cancelled: false,
        noShow: false,
        walkIn: false,
        changed: "",
        swapLocked: false,
      });
    });
  }
  if (Object.keys(days).length === 0) throw new Error("No se encontraron citas válidas.");
  return days;
};

const DAYS_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const DAYS_ES_SHORT = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MONTHS_ES_UPPER = MONTHS_ES.map(m => m.toUpperCase());
const SANTO_DOMINGO_TZ = "America/Santo_Domingo";

const dateLabelES = (dateStr: string | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return `${DAYS_ES[d.getDay()]}, ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
};
const dateLabelShortES = (dateStr: string) => {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAYS_ES_SHORT[d.getDay()]} ${d.getDate()}`;
};

const formatSantoDomingoDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-DO", {
    timeZone: SANTO_DOMINGO_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
};

const latestTimestamp = (current: string | null, incoming?: string | null) => {
  if (!incoming) return current;
  if (!current) return incoming;
  return new Date(incoming).getTime() > new Date(current).getTime() ? incoming : current;
};

const rowToApt = (row: any): Apt => ({
  id: row.id,
  client: row.client,
  time: row.time,
  timeMins: row.time_mins,
  employee: row.employee,
  cabin: row.cabin,
  cancelled: row.cancelled,
  noShow: row.no_show,
  walkIn: row.walk_in,
  changed: row.changed || "",
  swapLocked: !!row.swap_locked,
});

const aptToRow = (apt: Apt, dateStr: string) => ({
  id: apt.id,
  date: dateStr,
  client: apt.client,
  time: apt.time,
  time_mins: apt.timeMins,
  employee: apt.employee,
  cabin: apt.cabin,
  cancelled: apt.cancelled,
  no_show: apt.noShow,
  walk_in: apt.walkIn,
  changed: apt.changed || "",
  swap_locked: apt.swapLocked,
});

// ─── Main component ───────────────────────────────────────────────────────
type Props = { session: Session; profile: Profile; isAdmin: boolean; onSignOut: () => void };

export default function CharmScheduler({ session, profile, isAdmin, onSignOut }: Props) {
  const myEmployee = (profile?.employee_name || "Yaira") as EmpKey;
  const [days, setDays] = useState<Record<string, Apt[]>>({});
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [view, setView] = useState<"schedule" | "individual" | "reports" | "swaps" | "clients" | "sales" | "inventory" | "history">(isAdmin ? "schedule" : "individual");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [profileClient, setProfileClient] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmpKey>(isAdmin ? "Yaira" : myEmployee);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [walkInForm, setWalkInForm] = useState<{ open: boolean; time: string; client: string }>({ open: false, time: "", client: "" });
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [swapDialog, setSwapDialog] = useState<{ open: boolean; apt: Apt | null; date: string | null }>({ open: false, apt: null, date: null });
  const [pendingSwaps, setPendingSwaps] = useState(0);
  const [globalSwapsLocked, setGlobalSwapsLocked] = useState(false);
  const pendingRef = useRef<Map<string, { apt: Apt; date: string }>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlushingRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSaveError, setLastSaveError] = useState<string>("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugTick, setDebugTick] = useState(0);
  const [flushCount, setFlushCount] = useState(0);
  const [lastFlushAt, setLastFlushAt] = useState<string | null>(null);
  const globalSave = useGlobalSaveStatus();

  useEffect(() => {
    if (!showDebug) return;
    const t = setInterval(() => setDebugTick(x => x + 1), 500);
    return () => clearInterval(t);
  }, [showDebug]);

  const clearFlushTimer = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  };
  

  useEffect(() => {
    if (!isAdmin) {
      setView("individual");
      setSelectedEmployee(myEmployee);
    }
  }, [isAdmin, myEmployee]);

  useEffect(() => {
    setSaveStatus(globalSave.status === "idle" ? "" : globalSave.status);
    if (globalSave.error) setLastSaveError(globalSave.error);
    if (globalSave.lastSavedAt) {
      setLastSavedAt(prev => latestTimestamp(prev, globalSave.lastSavedAt));
    }
  }, [globalSave]);

  useEffect(() => () => clearFlushTimer(), []);

  // ─── Load + realtime ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchAll<any>("appointments", "*", { column: "time_mins", ascending: true });
        const grouped: Record<string, Apt[]> = {};
        (data || []).forEach((row: any) => {
          if (!grouped[row.date]) grouped[row.date] = [];
          grouped[row.date].push(rowToApt(row));
        });
        setDays(grouped);
        const allDates = Object.keys(grouped).sort().filter(d => d > HISTORY_CUTOFF);
        if (allDates.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          setActiveDate(allDates.includes(today) ? today : allDates[0]);
        }
      } catch (e) {
        console.error("Load error:", e);
      } finally {
        setHasLoaded(true);
      }
    })();

    const channel = supabase
      .channel("appointments-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, (payload: any) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new;
          setLastSavedAt(prev => latestTimestamp(prev, row.updated_at));
          syncLastSavedAt(row.updated_at);
          setDays(prev => {
            const updated = { ...prev };
            if (!updated[row.date]) updated[row.date] = [];
            if (!updated[row.date].find(a => a.id === row.id)) {
              updated[row.date] = [...updated[row.date], rowToApt(row)].sort((a, b) => a.timeMins - b.timeMins);
            }
            return updated;
          });
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new;
          setLastSavedAt(prev => latestTimestamp(prev, row.updated_at));
          syncLastSavedAt(row.updated_at);
          setDays(prev => {
            const updated = { ...prev };
            if (updated[row.date]) {
              updated[row.date] = updated[row.date].map(a => a.id === row.id ? rowToApt(row) : a);
            }
            return updated;
          });
        } else if (payload.eventType === "DELETE") {
          const row = payload.old;
          setDays(prev => {
            const updated = { ...prev };
            Object.keys(updated).forEach(date => {
              updated[date] = updated[date].filter(a => a.id !== row.id);
            });
            return updated;
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ─── Pending swap requests count (for badge) ────────────────────────
  useEffect(() => {
    const refresh = async () => {
      const { count } = await supabase
        .from("appointment_swap_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_user_id", session.user.id)
        .eq("status", "pending");
      setPendingSwaps(count || 0);
    };
    refresh();
    const ch = supabase
      .channel("swap-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_swap_requests" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session.user.id]);

  // Load global swap lock + subscribe
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("swaps_locked").eq("id", 1).maybeSingle();
      setGlobalSwapsLocked(!!data?.swaps_locked);
    })();
    const ch = supabase
      .channel("app-settings-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, async () => {
        const { data } = await supabase.from("app_settings").select("swaps_locked").eq("id", 1).maybeSingle();
        setGlobalSwapsLocked(!!data?.swaps_locked);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingCount > 0) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pendingCount]);

  const queuePendingSave = (apt: Apt, dateStr: string) => {
    pendingRef.current.set(apt.id, { apt, date: dateStr });
    setPendingCount(pendingRef.current.size);
    setSaveStatus("saving");
    setLastSaveError("");
    markSaveStart();
  };

  const scheduleFlush = (delay = 700) => {
    clearFlushTimer();
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      void flushPending();
    }, delay);
  };

  // Auto-retry pending saves every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingRef.current.size > 0 && !isFlushingRef.current) {
        void flushPending();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveApt = async (apt: Apt, dateStr: string) => {
    queuePendingSave(apt, dateStr);
    if (isFlushingRef.current) return;
    scheduleFlush();
  };

  const flushPending = async (options?: { manual?: boolean }) => {
    clearFlushTimer();
    if (isFlushingRef.current) {
      if (options?.manual) toast("Guardando cambios…");
      return;
    }
    if (pendingRef.current.size === 0) {
      if (options?.manual) toast.success("Todo está guardado");
      return;
    }

    const items = Array.from(pendingRef.current.values());
    isFlushingRef.current = true;
    markSaveStart();
    setSaveStatus("saving");
    let okCount = 0, failCount = 0; let lastErr = ""; let newestSavedAt: string | null = null;
    try {
      for (const { apt, date } of items) {
        const row = aptToRow(apt, date);
        const { data: updated, error: updErr } = await supabase
          .from("appointments")
          .update(row)
          .eq("id", apt.id)
          .select("id, updated_at");
        let error = updErr;
        let savedAt = updated?.[0]?.updated_at ?? null;
        if (!error && (!updated || updated.length === 0)) {
          const { data: inserted, error: upErr } = await supabase
            .from("appointments")
            .upsert(row)
            .select("id, updated_at")
            .single();
          error = upErr;
          savedAt = inserted?.updated_at ?? savedAt;
        }
        if (error) {
          failCount++;
          lastErr = error.message;
        } else {
          newestSavedAt = latestTimestamp(newestSavedAt, savedAt);
          const latestPending = pendingRef.current.get(apt.id);
          if (latestPending && latestPending.apt === apt && latestPending.date === date) {
            pendingRef.current.delete(apt.id);
          }
          okCount++;
        }
      }
    } catch (e: any) {
      failCount++;
      lastErr = e?.message || "Error desconocido";
      console.error("Flush save error:", e);
    } finally {
      isFlushingRef.current = false;
      setFlushCount(c => c + 1);
      setLastFlushAt(new Date().toISOString());
    }

    setPendingCount(pendingRef.current.size);
    if (failCount === 0 && pendingRef.current.size === 0) {
      setSaveStatus("saved");
      setLastSaveError("");
      setLastSavedAt(prev => latestTimestamp(prev, newestSavedAt));
      markSaveSuccess(newestSavedAt);
      if (options?.manual) {
        toast.success(`${okCount} cambio${okCount === 1 ? "" : "s"} guardado${okCount === 1 ? "" : "s"}`);
      }
      setTimeout(() => setSaveStatus(""), 1500);
    } else if (failCount === 0) {
      if (newestSavedAt) {
        setLastSavedAt(prev => latestTimestamp(prev, newestSavedAt));
        syncLastSavedAt(newestSavedAt);
      }
      setLastSaveError("");
      setSaveStatus("saving");
      markSaveStart();
      scheduleFlush(250);
      if (options?.manual) toast("Guardando cambios recientes…");
    } else {
      setSaveStatus("error");
      setLastSaveError(lastErr);
      markSaveError(lastErr);
      toast.error(`${failCount} cambio${failCount === 1 ? "" : "s"} no se pudo guardar`, { description: lastErr });
    }
  };

  const clearAllData = async () => {
    if (!isAdmin) return;
    if (!confirm("¿Borrar TODAS las citas guardadas? Esta acción afecta a todos los usuarios y no se puede deshacer.")) return;
    try {
      const { error } = await supabase.from("appointments").delete().neq("id", "never");
      if (error) throw error;
      setDays({});
      setActiveDate(null);
    } catch (e: any) {
      alert("Error al borrar: " + e.message);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isAdmin) return;
    setLoading(true); setError("");
    try {
      const parsed = await parseExcel(file);
      const assignedDays: Record<string, Apt[]> = {};
      const allRows: any[] = [];
      Object.keys(parsed).forEach(d => {
        assignedDays[d] = autoAssign(parsed[d]);
        assignedDays[d].forEach(apt => allRows.push(aptToRow(apt, d)));
      });
      markSaveStart();
      const { error, data } = await supabase.from("appointments").upsert(allRows).select("updated_at");
      if (error) throw error;
      setDays(prev => ({ ...prev, ...assignedDays }));
      setActiveDate(Object.keys(assignedDays).sort()[0]);
      setView("schedule");
      markSaveSuccess(Array.isArray(data) ? data[data.length - 1]?.updated_at ?? null : null);
    } catch (err: any) {
      markSaveError(err);
      setError(err.message || "No se pudo leer el archivo");
    }
    setLoading(false);
    e.target.value = "";
  };

  const sortedDates = useMemo(() => Object.keys(days).filter(d => d > HISTORY_CUTOFF).sort(), [days]);
  const currentAppts = activeDate ? (days[activeDate] || []) : [];

  const updateApt = async (id: string, changes: Partial<Apt>) => {
    if (!activeDate) return;
    let updated: Apt | undefined;
    setDays(prev => {
      const out = { ...prev };
      out[activeDate] = (prev[activeDate] || []).map(a => {
        if (a.id === id) { updated = { ...a, ...changes }; return updated; }
        return a;
      });
      return out;
    });
    if (updated) await saveApt(updated, activeDate);
  };

  const removeApt = async (id: string) => {
    if (!isAdmin || !activeDate) return;
    setDays(prev => ({
      ...prev,
      [activeDate]: prev[activeDate].filter(a => a.id !== id),
    }));
    try {
      markSaveStart();
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
      markSaveSuccess();
    } catch (e) { markSaveError(e); console.error(e); }
  };

  const addWalkIn = async () => {
    if (!isAdmin || !activeDate) return;
    const { time, client } = walkInForm;
    if (!time.trim() || !client.trim()) { alert("Por favor ingresa hora y nombre del cliente."); return; }
    const timeMins = parseTime(time);
    if (timeMins === null) { alert("Formato de hora inválido. Ejemplo: 2:30 p.m."); return; }
    const counts: Record<EmpKey, number> = { Yaira: 0, Belkis: 0, Cielo: 0, Lisa: 0 };
    const lastSeen: Record<EmpKey, number> = { Yaira: -999, Belkis: -999, Cielo: -999, Lisa: -999 };
    currentAppts.forEach(a => {
      if (a.employee && !a.cancelled && !a.noShow) {
        counts[a.employee]++;
        lastSeen[a.employee] = Math.max(lastSeen[a.employee], a.timeMins);
      }
    });
    let cands = EMP_LIST.filter(e => isWorking(e, timeMins) && (EMPLOYEES[e].maxClients === null || counts[e] < (EMPLOYEES[e].maxClients as number)));
    if (cands.length === 0) cands = EMP_LIST.filter(e => isWorking(e, timeMins));
    if (cands.length === 0) cands = [...EMP_LIST];
    cands.sort((a, b) => {
      const gapA = timeMins - lastSeen[a];
      const gapB = timeMins - lastSeen[b];
      if (gapA !== gapB) return gapB - gapA;
      return counts[a] - counts[b];
    });
    const chosen = cands[0];
    const newApt: Apt = {
      id: `walkin-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      client: client.trim(),
      time: formatTime(timeMins),
      timeMins,
      employee: chosen,
      cabin: EMPLOYEES[chosen].cabin,
      cancelled: false, noShow: false, walkIn: true, changed: "", swapLocked: false,
    };
    setDays(prev => ({
      ...prev,
      [activeDate]: [...(prev[activeDate] || []), newApt].sort((a, b) => a.timeMins - b.timeMins),
    }));
    await saveApt(newApt, activeDate);
    setWalkInForm({ open: false, time: "", client: "" });
  };

  const reAutoAssign = async () => {
    if (!isAdmin || !activeDate) return;
    if (!confirm("¿Volver a asignar todo el día?")) return;
    const reset = (days[activeDate] || []).map(a => ({ ...a, employee: null as EmpKey | null, cabin: null as number | null }));
    const assigned = autoAssign(reset);
    setDays(prev => ({ ...prev, [activeDate]: assigned }));
    const rows = assigned.map(a => aptToRow(a, activeDate));
    try {
      markSaveStart();
      const { error, data } = await supabase.from("appointments").upsert(rows).select("updated_at");
      if (error) throw error;
      markSaveSuccess(Array.isArray(data) ? data[data.length - 1]?.updated_at ?? null : null);
    } catch (e) {
      markSaveError(e);
      console.error(e);
    }
  };

  const employeeStats = useMemo(() => {
    const stats: Record<EmpKey, { total: number; attended: number; noShow: number; cancelled: number }> =
      { Yaira: { total: 0, attended: 0, noShow: 0, cancelled: 0 },
        Belkis: { total: 0, attended: 0, noShow: 0, cancelled: 0 },
        Cielo:  { total: 0, attended: 0, noShow: 0, cancelled: 0 },
        Lisa:   { total: 0, attended: 0, noShow: 0, cancelled: 0 } };
    currentAppts.forEach(a => {
      if (!a.employee) return;
      stats[a.employee].total++;
      if (a.noShow) stats[a.employee].noShow++;
      else if (a.cancelled) stats[a.employee].cancelled++;
      else stats[a.employee].attended++;
    });
    return stats;
  }, [currentAppts]);

  const exportIndividualText = (emp: EmpKey) => {
    const list = currentAppts.filter(a => a.employee === emp && !a.cancelled).sort((a, b) => a.timeMins - b.timeMins);
    const header = `📋 ${emp} — ${dateLabelES(activeDate)}\nCabina ${EMPLOYEES[emp].cabin}\n\n`;
    const lines = list.map(a => {
      const flag = a.noShow ? " ❌ NO ASISTIÓ" : (a.walkIn ? " ✨ SIN CITA" : "");
      return `${a.time}  —  ${a.client}${flag}`;
    });
    const total = list.filter(a => !a.noShow).length;
    return header + lines.join("\n") + `\n\nTotal: ${total} cliente${total === 1 ? "" : "s"}`;
  };

  const copyIndividual = async (emp: EmpKey) => {
    const text = exportIndividualText(emp);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopyStatus(emp);
    setTimeout(() => setCopyStatus(""), 2000);
  };

  const exportAgendaExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      sortedDates.forEach(dateStr => {
        const d = new Date(dateStr + "T12:00:00");
        const dd = d.getDate(); const mm = d.getMonth() + 1; const yy = String(d.getFullYear()).slice(2);
        const sheetName = `${dd}-${mm}-${yy}`;
        const monthName = MONTHS_ES_UPPER[d.getMonth()];
        const yearDigits = String(d.getFullYear()).split("").map(c => parseInt(c));
        const rows: any[][] = [];
        rows.push(["AGENDA DIARIA ", dd, monthName, ...yearDigits]);
        rows.push(["CLIENTES", "HORARIO", "ASIGNACION", "CAMBIO", null, "NO ASISTIDO"]);
        const sorted = [...(days[dateStr] || [])].sort((a, b) => a.timeMins - b.timeMins);
        sorted.forEach(a => {
          rows.push([a.client, a.time, a.employee || "", a.changed || (a.walkIn ? "SIN CITA" : ""), null, a.noShow ? "X" : (a.cancelled ? "CANCELÓ" : "")]);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [{ wch: 38 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 3 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
      });
      const filename = `AGENDA_CHARM_${sortedDates[0]}_a_${sortedDates[sortedDates.length-1]}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      alert(`Error al exportar: ${err.message}`);
    }
  };

  // ─── Render: loading ─────────────────────────────────────────────────
  if (!hasLoaded) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="font-display text-primary" style={{ fontSize: 48 }}>Charm</div>
          <div className="text-xs font-label text-accent mt-2">CARGANDO…</div>
        </div>
      </div>
    );
  }

  // ─── Render: empty state ─────────────────────────────────────────────
  if (Object.keys(days).length === 0) {
    return (
      <div className="min-h-screen w-full bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
          <div className="flex justify-end mb-4">
            <button onClick={onSignOut} className="text-xs font-label text-accent flex items-center gap-2 opacity-60 hover:opacity-100">
              <LogOut size={12} /> Salir
            </button>
          </div>
          <div className="text-center mb-12">
            <div className="text-xs font-label text-accent">CLÍNICA ESTÉTICA</div>
            <h1 className="font-display text-primary mt-2" style={{ fontSize: "clamp(56px,12vw,96px)", lineHeight: 1 }}>Charm</h1>
            <div className="h-px w-32 mx-auto mt-4 bg-accent" />
            <div className="text-xs font-label text-accent mt-3">
              AGENDA DIARIA · {profile?.display_name || profile?.employee_name || "Usuario"}
            </div>
          </div>

          {isAdmin ? (
            <div className="border border-border bg-card p-8 md:p-12 text-center">
              <Upload size={36} className="mx-auto mb-4 text-accent" strokeWidth={1.2} />
              <h2 className="font-display text-primary mb-3" style={{ fontSize: 32, fontWeight: 400 }}>Subir archivo de citas</h2>
              <p className="text-sm mb-8 max-w-md mx-auto text-muted-foreground">
                Sube el archivo Excel exportado de tu sistema de reservas.
              </p>
              <div style={{ position: "relative", display: "inline-block" }}>
                <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleUpload} disabled={loading}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 100 }} />
                <span className="inline-block px-8 py-3 text-xs font-label bg-primary text-primary-foreground pointer-events-none">
                  {loading ? "Leyendo…" : "Elegir Archivo"}
                </span>
              </div>
              {error && (
                <div className="mt-6 text-sm flex items-center justify-center gap-2 text-destructive">
                  <AlertCircle size={14} /> {error}
                </div>
              )}
            </div>
          ) : (
            <div className="border border-border bg-card p-12 text-center">
              <p className="text-sm text-muted-foreground">
                No hay citas cargadas todavía. Espera a que la administradora suba la agenda.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: main ────────────────────────────────────────────────────
  const lastSavedLabel = formatSantoDomingoDateTime(lastSavedAt);

  return (
    <div className="min-h-screen w-full bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-card">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-primary" style={{ fontSize: 34, fontWeight: 400, lineHeight: 1 }}>Charm</span>
              <span className="text-xs font-label text-accent hidden sm:inline">{profile?.display_name || profile?.employee_name}</span>
            </div>
            <div className="text-[11px] font-label text-muted-foreground leading-relaxed">
              {saveStatus === "saving" ? "Guardando automáticamente…" : lastSavedLabel ? `Último guardado: ${lastSavedLabel} · Santo Domingo` : "Sin guardado reciente"}
            </div>
            {pendingCount > 0 ? (
              <button
                onClick={() => void flushPending({ manual: true })}
                className="text-xs flex items-center gap-1 px-2 py-1 bg-destructive text-destructive-foreground font-label"
                title={lastSaveError || "Reintentar guardar cambios pendientes"}
              >
                <Save size={11} /> Guardar ({pendingCount})
              </button>
            ) : (
              <button
                onClick={() => void flushPending({ manual: true })}
                disabled={saveStatus === "saving"}
                className="text-xs flex items-center gap-1 px-2 py-1 border border-border font-label hover:bg-accent/10 disabled:opacity-60"
                title="Guardar manualmente (los cambios se guardan automáticamente)"
              >
                {saveStatus === "saving" ? (
                  <><Save size={11} className="animate-pulse" /> guardando…</>
                ) : saveStatus === "saved" ? (
                  <><Check size={11} className="text-success" /> Guardado</>
                ) : (
                  <><Save size={11} /> Guardar</>
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <GlobalSearch
              isAdmin={isAdmin}
              employees={EMP_LIST}
              onPickDate={(d) => { if (days[d]) setActiveDate(d); else toast("Esa fecha no tiene citas cargadas"); }}
              onPickEmployee={(e) => { setSelectedEmployee(e); setView("individual"); }}
              onOpenSwaps={() => setView("swaps")}
              onOpenUpload={isAdmin ? () => document.getElementById("hidden-upload-input")?.click() : undefined}
              onAddWalkIn={isAdmin ? () => { setView("schedule"); setWalkInForm({ open: true, time: "", client: "" }); } : undefined}
              onSignOut={onSignOut}
              onToggleLock={isAdmin ? async () => {
                try {
                  markSaveStart();
                  const { error } = await supabase
                    .from("app_settings")
                    .update({ swaps_locked: !globalSwapsLocked, updated_by: session.user.id, updated_at: new Date().toISOString() })
                    .eq("id", 1);
                  if (error) throw error;
                  setGlobalSwapsLocked(v => !v);
                  markSaveSuccess();
                  toast.success(!globalSwapsLocked ? "Cambios bloqueados" : "Cambios desbloqueados");
                } catch (error: any) {
                  markSaveError(error);
                  toast.error(error?.message || "No se pudo actualizar el bloqueo");
                }
              } : undefined}
            />
            <NotificationBell
              userId={session.user.id}
              onLink={(link) => {
                if (link === "swaps") setView("swaps");
                else if (link.startsWith("date:")) {
                  const d = link.slice(5);
                  if (days[d]) setActiveDate(d);
                }
              }}
            />
            {isAdmin && (
              <>
                <TabBtn active={view === "schedule"} onClick={() => setView("schedule")}>Agenda</TabBtn>
                <TabBtn active={view === "individual"} onClick={() => setView("individual")}>Individual</TabBtn>
                <TabBtn active={view === "reports"} onClick={() => setView("reports")}>Reportes</TabBtn>
                <TabBtn active={view === "swaps"} onClick={() => setView("swaps")} badge={pendingSwaps}>Solicitudes</TabBtn>
                <TabBtn active={view === "clients"} onClick={() => { setSelectedClientId(null); setView("clients"); }}>Clientes</TabBtn>
                <TabBtn active={view === "sales"} onClick={() => setView("sales")}>Ventas</TabBtn>
                <TabBtn active={view === "inventory"} onClick={() => setView("inventory")}>Inventario</TabBtn>
                <TabBtn active={view === "history"} onClick={() => setView("history")}>Historial</TabBtn>
                <button onClick={exportAgendaExcel} className="px-3 md:px-4 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-2">
                  <FileSpreadsheet size={14} /> <span className="hidden sm:inline">Exportar</span>
                </button>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <input id="hidden-upload-input" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleUpload}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 100 }} />
                  <span className="px-3 md:px-4 py-2 text-xs font-label border border-primary text-primary flex items-center gap-2 pointer-events-none">
                    <Upload size={14} /> <span className="hidden sm:inline">Subir</span>
                  </span>
                </div>
              </>
            )}
            {!isAdmin && (
              <>
                <TabBtn active={view === "individual"} onClick={() => setView("individual")}>Mi agenda</TabBtn>
                <TabBtn active={view === "reports"} onClick={() => setView("reports")}>Mis reportes</TabBtn>
                <TabBtn active={view === "swaps"} onClick={() => setView("swaps")} badge={pendingSwaps}>Solicitudes</TabBtn>
              </>
            )}
            <button onClick={onSignOut} className="px-2 md:px-3 py-2 text-xs font-label border border-destructive text-destructive flex items-center gap-1" title="Salir">
              <LogOut size={13} />
            </button>
          </div>
        </div>
        {!profile?.employee_name && !isAdmin && (
          <div className="bg-destructive/10 border-t border-destructive px-4 md:px-6 py-2 text-xs text-destructive flex items-center gap-2">
            <AlertCircle size={12} /> Tu cuenta no está vinculada a una empleada. Pide al admin que te asigne para poder editar y solicitar cambios.
          </div>
        )}
        {saveStatus === "error" && (
          <div className="bg-destructive/10 border-t border-destructive px-4 md:px-6 py-2 text-xs text-destructive flex items-center gap-2 justify-between flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={12} className="flex-shrink-0" />
              <span className="break-words">SAVE ERROR: {lastSaveError || "No se pudo guardar automáticamente."}</span>
            </div>
            {pendingCount > 0 && (
              <button onClick={() => void flushPending({ manual: true })} className="px-2 py-1 border border-destructive text-destructive font-label">
                Reintentar
              </button>
            )}
          </div>
        )}
        {(view === "schedule" || view === "individual") && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 pb-3 flex items-center gap-1 overflow-x-auto">
            {sortedDates.map(d => (
              <button key={d} onClick={() => setActiveDate(d)}
                className="px-3 md:px-4 py-2 text-xs font-label border border-primary whitespace-nowrap transition-opacity"
                style={{
                  backgroundColor: activeDate === d ? "hsl(var(--primary))" : "transparent",
                  color: activeDate === d ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
                  opacity: activeDate === d ? 1 : 0.6,
                }}>
                {dateLabelShortES(d)}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        {view === "schedule" && isAdmin && (
          <>
            <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
              <div>
                <div className="text-xs font-label text-accent">AGENDA PARA</div>
                <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
                  {dateLabelES(activeDate)}
                </h2>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setWalkInForm({ open: true, time: "", client: "" })}
                  className="px-4 py-2 text-xs font-label border border-primary text-primary bg-card flex items-center gap-2">
                  <UserPlus size={14} /> Sin Cita
                </button>
                <button onClick={reAutoAssign}
                  className="px-4 py-2 text-xs font-label border border-primary text-primary bg-card flex items-center gap-2">
                  <RotateCcw size={14} /> Reasignar
                </button>
                <button onClick={clearAllData}
                  className="px-4 py-2 text-xs font-label border border-destructive text-destructive bg-card flex items-center gap-2">
                  <Trash2 size={14} /> Borrar Todo
                </button>
              </div>
            </div>

            {walkInForm.open && (
              <div className="border border-accent bg-card p-4 mb-6">
                <div className="text-xs font-label text-accent mb-3">AGREGAR CLIENTE SIN CITA</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={walkInForm.time} onChange={(e) => setWalkInForm(f => ({ ...f, time: e.target.value }))}
                    placeholder="Hora (ej. 2:30 p.m.)" className="px-3 py-2 border border-border bg-background text-sm text-foreground" />
                  <input value={walkInForm.client} onChange={(e) => setWalkInForm(f => ({ ...f, client: e.target.value }))}
                    placeholder="Nombre del cliente" className="px-3 py-2 border border-border bg-background text-sm text-foreground" />
                  <div className="flex gap-2">
                    <button onClick={addWalkIn} className="flex-1 px-4 py-2 text-xs font-label bg-primary text-primary-foreground">Agregar</button>
                    <button onClick={() => setWalkInForm({ open: false, time: "", client: "" })}
                      className="px-4 py-2 text-xs font-label border border-primary text-primary">Cancelar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {EMP_LIST.map(emp => {
                const e = EMPLOYEES[emp];
                const s = employeeStats[emp];
                const overCap = e.maxClients && s.attended > e.maxClients;
                return (
                  <div key={emp} className="border border-border bg-card p-4" style={{ borderLeft: `4px solid ${e.color}` }}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-primary" style={{ fontSize: 24, fontWeight: 500 }}>{emp}</span>
                      <span className="text-xs font-label" style={{ color: e.color }}>C.{e.cabin}</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-display" style={{ fontSize: 36, fontWeight: 300, lineHeight: 1, color: overCap ? "hsl(var(--destructive))" : "hsl(var(--primary))" }}>
                        {s.attended}
                      </span>
                      <span className="text-xs text-muted-foreground">{e.maxClients ? `/ ${e.maxClients} máx` : "clientes"}</span>
                    </div>
                    <div className="text-xs mt-2 flex gap-3 text-muted-foreground">
                      {s.noShow > 0 && <span>{s.noShow} no asistió</span>}
                      {s.cancelled > 0 && <span>{s.cancelled} canceló</span>}
                      {s.noShow === 0 && s.cancelled === 0 && <span>&nbsp;</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block border border-border bg-card">
              <div className="grid gap-3 px-4 py-3 text-xs font-label border-b border-border items-center text-accent"
                style={{ gridTemplateColumns: "90px 1fr 130px 50px 240px" }}>
                <div>Hora</div><div>Cliente</div><div>Asignación</div><div>Cab.</div><div className="text-right">Estado</div>
              </div>
              {currentAppts.length === 0 && <div className="p-8 text-center text-sm italic text-muted-foreground">No hay citas para este día.</div>}
              {currentAppts.map((a, idx) => {
                const empColor = a.employee ? EMPLOYEES[a.employee].color : "hsl(var(--muted-foreground))";
                const dimmed = a.cancelled || a.noShow;
                return (
                  <div key={a.id} className="grid gap-3 px-4 py-3 border-b items-center"
                    style={{
                      borderColor: "hsl(var(--border))",
                      backgroundColor: idx % 2 === 0 ? "transparent" : "hsl(var(--background))",
                      gridTemplateColumns: "90px 1fr 130px 50px 240px",
                      opacity: dimmed ? 0.5 : 1,
                    }}>
                    <div className="text-sm text-primary">{a.time}</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <button onClick={() => setProfileClient(a.client)} className="text-sm truncate text-primary hover:underline text-left" style={{ textDecoration: dimmed ? "line-through" : undefined }}>{a.client}</button>
                      {a.walkIn && <span className="text-[10px] px-2 py-0.5 flex-shrink-0 font-label bg-chip-walkin-bg text-chip-walkin-fg">SIN CITA</span>}
                    </div>
                    <div>
                      <select value={a.employee || ""}
                        onChange={(e) => updateApt(a.id, { employee: (e.target.value || null) as EmpKey | null, cabin: e.target.value ? EMPLOYEES[e.target.value as EmpKey].cabin : null })}
                        className="w-full px-2 py-1 text-sm bg-background text-foreground"
                        style={{ border: `1px solid hsl(var(--border))`, borderLeftWidth: 3, borderLeftColor: empColor }}>
                        <option value="">—</option>
                        {EMP_LIST.map(emp => {
                          const working = isWorking(emp, a.timeMins);
                          const lunch = onLunch(emp, a.timeMins);
                          return <option key={emp} value={emp}>{emp}{!working ? (lunch ? " (almuerzo)" : " (fuera)") : ""}</option>;
                        })}
                      </select>
                    </div>
                    <div className="text-sm text-muted-foreground">{a.cabin || "—"}</div>
                    <div className="flex items-center justify-end gap-1">
                      <ToggleBtn active={a.noShow} onClick={() => updateApt(a.id, { noShow: !a.noShow, cancelled: false })} variant="destructive">NO ASISTIÓ</ToggleBtn>
                      <ToggleBtn active={a.cancelled} onClick={() => updateApt(a.id, { cancelled: !a.cancelled, noShow: false })} variant="accent">CANCELÓ</ToggleBtn>
                      {isAdmin && (
                        <button
                          onClick={() => updateApt(a.id, { swapLocked: !a.swapLocked })}
                          className="p-1 opacity-60 hover:opacity-100"
                          title={a.swapLocked ? "Desbloquear cambios para esta cita" : "Bloquear cambios para esta cita"}
                        >
                          {a.swapLocked
                            ? <Lock size={14} className="text-destructive" />
                            : <Unlock size={14} className="text-muted-foreground" />}
                        </button>
                      )}
                      <button onClick={() => removeApt(a.id)} className="p-1 opacity-40 hover:opacity-100" title="Eliminar">
                        <Trash2 size={14} className="text-destructive" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {currentAppts.length === 0 && <div className="p-8 text-center text-sm italic border border-border bg-card text-muted-foreground">No hay citas para este día.</div>}
              {currentAppts.map((a) => {
                const empColor = a.employee ? EMPLOYEES[a.employee].color : "hsl(var(--muted-foreground))";
                const dimmed = a.cancelled || a.noShow;
                return (
                  <div key={a.id} className="border border-border bg-card p-3" style={{ borderLeft: `4px solid ${empColor}`, opacity: dimmed ? 0.55 : 1 }}>
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-medium text-primary">{a.time}</span>
                        <button onClick={() => setProfileClient(a.client)} className="text-sm text-primary hover:underline text-left" style={{ textDecoration: dimmed ? "line-through" : undefined }}>{a.client}</button>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {a.walkIn && <span className="text-[10px] px-2 py-0.5 font-label bg-chip-walkin-bg text-chip-walkin-fg">SIN CITA</span>}
                        <button onClick={() => removeApt(a.id)} className="p-1 opacity-50"><Trash2 size={14} className="text-destructive" /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <select value={a.employee || ""}
                        onChange={(e) => updateApt(a.id, { employee: (e.target.value || null) as EmpKey | null, cabin: e.target.value ? EMPLOYEES[e.target.value as EmpKey].cabin : null })}
                        className="flex-1 px-2 py-2 text-sm bg-background text-foreground"
                        style={{ border: `1px solid hsl(var(--border))`, borderLeftWidth: 3, borderLeftColor: empColor }}>
                        <option value="">— Sin asignar —</option>
                        {EMP_LIST.map(emp => {
                          const working = isWorking(emp, a.timeMins);
                          const lunch = onLunch(emp, a.timeMins);
                          return <option key={emp} value={emp}>{emp}{!working ? (lunch ? " (almuerzo)" : " (fuera)") : ""}</option>;
                        })}
                      </select>
                      <span className="text-xs px-2 py-2 border border-border text-muted-foreground">Cab. {a.cabin || "—"}</span>
                    </div>
                    <div className="flex gap-2">
                      <ToggleBtn active={a.noShow} onClick={() => updateApt(a.id, { noShow: !a.noShow, cancelled: false })} variant="destructive" className="flex-1">NO ASISTIÓ</ToggleBtn>
                      <ToggleBtn active={a.cancelled} onClick={() => updateApt(a.id, { cancelled: !a.cancelled, noShow: false })} variant="accent" className="flex-1">CANCELÓ</ToggleBtn>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {view === "individual" && (
          <>
            <div className="mb-6">
              <div className="text-xs font-label text-accent">{isAdmin ? "AGENDAS INDIVIDUALES" : "MI AGENDA"}</div>
              <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
                {dateLabelES(activeDate)}
              </h2>
            </div>

            {isAdmin && (
              <div className="flex gap-2 mb-6 flex-wrap">
                {EMP_LIST.map(emp => (
                  <button key={emp} onClick={() => setSelectedEmployee(emp)}
                    className="px-5 py-2 text-xs font-label border"
                    style={{
                      backgroundColor: selectedEmployee === emp ? EMPLOYEES[emp].color : "transparent",
                      color: selectedEmployee === emp ? "hsl(var(--card))" : EMPLOYEES[emp].color,
                      borderColor: EMPLOYEES[emp].color,
                    }}>
                    {emp}
                  </button>
                ))}
              </div>
            )}

            <div className="border border-border bg-card p-6 md:p-8">
              <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
                <div>
                  <div className="font-display" style={{ fontSize: 36, fontWeight: 500, lineHeight: 1, color: EMPLOYEES[selectedEmployee]?.color }}>
                    {selectedEmployee}
                  </div>
                  {EMPLOYEES[selectedEmployee] && (
                    <div className="text-xs font-label mt-1 text-accent">
                      CABINA {EMPLOYEES[selectedEmployee].cabin} · {formatTime(EMPLOYEES[selectedEmployee].startM).replace(" a.m.","am").replace(" p.m.","pm")} – {formatTime(EMPLOYEES[selectedEmployee].endM).replace(" a.m.","am").replace(" p.m.","pm")}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <button onClick={() => copyIndividual(selectedEmployee)}
                    className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-2">
                    {copyStatus === selectedEmployee ? <><Check size={14} /> ¡Copiado!</> : <><Copy size={14} /> Copiar Agenda</>}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {currentAppts.filter(a => a.employee === selectedEmployee && !a.cancelled).length === 0 && (
                  <div className="text-sm italic text-muted-foreground">No hay citas asignadas.</div>
                )}
                {currentAppts.filter(a => a.employee === selectedEmployee && !a.cancelled).sort((a, b) => a.timeMins - b.timeMins).map(a => (
                  <div key={a.id} className="flex items-center gap-3 py-3 border-b border-border flex-wrap">
                    <div className="text-sm font-medium w-24 text-primary">{a.time}</div>
                    <button onClick={() => setProfileClient(a.client)} className="flex-1 min-w-0 text-sm text-primary hover:underline text-left" style={{ textDecoration: a.noShow ? "line-through" : undefined }}>{a.client}</button>
                    {a.walkIn && <span className="text-[10px] px-2 py-0.5 font-label bg-chip-walkin-bg text-chip-walkin-fg">SIN CITA</span>}
                    {selectedEmployee === myEmployee && a.employee === myEmployee && !a.noShow && (
                      <button
                        onClick={() => setSwapDialog({ open: true, apt: a, date: activeDate })}
                        disabled={a.swapLocked || (globalSwapsLocked && !isAdmin)}
                        className="px-3 py-1 text-[11px] font-label border border-accent text-accent flex items-center gap-1 disabled:opacity-40"
                        title={a.swapLocked ? "Cita bloqueada por admin" : (globalSwapsLocked ? "Cambios bloqueados" : "Pedir cambio")}>
                        {a.swapLocked ? <Lock size={11} /> : <Repeat size={11} />} Cambio
                      </button>
                    )}
                    {!isAdmin && selectedEmployee === myEmployee && (
                      <button onClick={() => updateApt(a.id, { noShow: !a.noShow })}
                        className="px-3 py-1 text-[11px] font-label border"
                        style={{
                          borderColor: a.noShow ? "hsl(var(--destructive))" : "hsl(var(--border))",
                          backgroundColor: a.noShow ? "hsl(var(--destructive))" : "transparent",
                          color: a.noShow ? "hsl(var(--destructive-foreground))" : "hsl(var(--muted-foreground))",
                        }}>
                        {a.noShow ? "✓ NO ASISTIÓ" : "NO ASISTIÓ"}
                      </button>
                    )}
                    {isAdmin && a.noShow && <span className="text-[10px] px-2 py-0.5 font-label bg-chip-noshow-bg text-chip-noshow-fg">NO ASISTIÓ</span>}
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-border flex justify-between text-xs font-label text-accent">
                <span>TOTAL ATENDIDOS</span>
                <span>{currentAppts.filter(a => a.employee === selectedEmployee && !a.cancelled && !a.noShow).length} CLIENTES</span>
              </div>
            </div>

            {isAdmin && (
              <div className="mt-6 border border-border bg-card p-6">
                <div className="text-xs font-label mb-3 text-accent">VISTA WHATSAPP / EMAIL</div>
                <pre className="text-sm whitespace-pre-wrap text-primary" style={{ fontFamily: "Lora, serif" }}>{exportIndividualText(selectedEmployee)}</pre>
              </div>
            )}
          </>
        )}

        {view === "reports" && (
          <Dashboard profile={profile} isAdmin={isAdmin} />
        )}

        {view === "swaps" && (
          <SwapRequests session={session} isAdmin={isAdmin} myEmployee={myEmployee} />
        )}

        {view === "clients" && (
          <ClientsModule isAdmin={isAdmin} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />
        )}

        {view === "sales" && isAdmin && (
          <SalesModule profile={profile} isAdmin={isAdmin} />
        )}

        {view === "inventory" && (
          <InventoryModule isAdmin={isAdmin} />
        )}

        {view === "history" && isAdmin && (
          <HistoryView
            days={days}
            cutoff={HISTORY_CUTOFF}
            onClientClick={(name) => setProfileClient(name)}
          />
        )}
      </main>

      <SwapRequestDialog
        open={swapDialog.open}
        onClose={() => setSwapDialog({ open: false, apt: null, date: null })}
        appointment={swapDialog.apt && swapDialog.date ? {
          id: swapDialog.apt.id,
          client: swapDialog.apt.client,
          time: swapDialog.apt.time,
          date: swapDialog.date,
          time_mins: swapDialog.apt.timeMins,
        } : null}
        myEmployee={myEmployee}
        myUserId={session.user.id}
        employees={EMP_LIST}
      />

      <ClientProfileModal
        clientName={profileClient}
        onClose={() => setProfileClient(null)}
      />

      <footer className="text-center py-8 text-xs font-label text-accent">
        CHARM CLÍNICA ESTÉTICA · AGENDA DIARIA
      </footer>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────
function TabBtn({ active, onClick, children, badge }: { active: boolean; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <button onClick={onClick} className="px-3 md:px-4 py-2 text-xs font-label transition-opacity relative"
      style={{
        borderBottom: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
        color: "hsl(var(--primary))",
        opacity: active ? 1 : 0.55,
      }}>
      {children}
      {badge && badge > 0 ? (
        <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] bg-destructive text-destructive-foreground rounded-full align-middle">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ToggleBtn({ active, onClick, variant, children, className = "" }: {
  active: boolean; onClick: () => void; variant: "destructive" | "accent";
  children: React.ReactNode; className?: string;
}) {
  const color = variant === "destructive" ? "hsl(var(--destructive))" : "hsl(var(--accent))";
  return (
    <button onClick={onClick} className={`px-2 py-1 text-[10px] font-label border ${className}`}
      style={{
        borderColor: active ? color : "hsl(var(--border))",
        backgroundColor: active ? color : "transparent",
        color: active ? "hsl(var(--card))" : "hsl(var(--muted-foreground))",
        opacity: active ? 1 : 0.7,
      }}>
      {children}
    </button>
  );
}
