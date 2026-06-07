import { useState, useMemo, useEffect, useRef } from "react";
import { Upload, UserPlus, RotateCcw, AlertCircle, FileSpreadsheet, Trash2, Copy, Check, Save, LogOut, Repeat, Lock, Unlock, ChevronLeft, ChevronRight, Menu, X, CalendarDays, UserRound, BarChart3, Users, ShoppingBag, Package, History, Settings, Wallet, Printer, PhoneCall, ListPlus, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { markSaveError, markSaveStart, markSaveSuccess, syncLastSavedAt, useGlobalSaveStatus } from "@/lib/saveSync";
import { useRoster, autoAssign, isWorkingOn, onLunchOn, isOffOn, weekdayOf, getEndBuffer, type Employee } from "@/lib/roster";
import type { Session } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
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
import SettingsModule from "./SettingsModule";
import ProfileModule from "./ProfileModule";

// ─── History cutoff: dates on or before this are hidden from the main agenda ─
const HISTORY_CUTOFF = "2026-04-26";

// ─── Employee config ──────────────────────────────────────────────────────
type EmpKey = string;

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
  arrivedAt: string | null;
};

// ─── Time helpers ─────────────────────────────────────────────────────────
const parseTime = (s: unknown): number | null => {
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

// ─── Excel parser ─────────────────────────────────────────────────────────
const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const parseExcel = async (file: File): Promise<Record<string, Apt[]>> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown as unknown[][];

  // Header row: needs a client column (Client/Cliente) and a time column (Time/Hora)
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const lc = r.map((c) => String(c || "").toLowerCase());
    if (lc.some((c) => /client|cliente/.test(c)) && lc.some((c) => /\btime\b|hora/.test(c))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error("No se encontró el encabezado. Se esperan columnas de Cliente y Hora (o Client/Time).");

  const header = rows[headerIdx].map((c) => String(c || "").toLowerCase());
  const findCol = (re: RegExp) => header.findIndex((c: string) => re.test(c));
  const dateCol = findCol(/date|fecha/);
  const timeCol = findCol(/\btime\b|hora/);
  const clientCol = findCol(/client|cliente/);
  if (dateCol < 0 || timeCol < 0 || clientCol < 0) throw new Error("Faltan columnas obligatorias (Fecha, Hora, Cliente).");

  // For agendas that use a bare day-of-month (e.g. header "Fecha (Mayo)" with days 19..31),
  // derive the month from the date-column header / title and the year from any 20xx in the title.
  const titleText = rows.slice(0, headerIdx + 1).flat().map((c) => String(c || "").toLowerCase()).join(" ");
  const yearMatch = titleText.match(/(20\d{2})/);
  const fileYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  let fileMonth: number | null = null;
  const monthHay = (header[dateCol] || "") + " " + titleText;
  for (const [name, num] of Object.entries(SPANISH_MONTHS)) {
    if (monthHay.includes(name)) { fileMonth = num; break; }
  }

  const days: Record<string, Apt[]> = {};
  let sawDayNumbers = false;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawDate = r[dateCol];
    const time = r[timeCol];
    const client = r[clientCol];
    if (!rawDate || !time || !client) continue;
    const cstr = String(client).toLowerCase();
    if (cstr.includes("total") || cstr.includes("revenue") || cstr.includes("forecast") || cstr.includes("actual")) continue;

    const dayNum = typeof rawDate === "number"
      ? rawDate
      : (/^\d{1,2}$/.test(String(rawDate).trim()) ? parseInt(String(rawDate), 10) : NaN);

    const looksLikeDay = !isNaN(dayNum) && dayNum >= 1 && dayNum <= 31;
    if (looksLikeDay) sawDayNumbers = true;
    let dateObj: Date;
    if (looksLikeDay && fileMonth) {
      dateObj = new Date(fileYear, fileMonth - 1, dayNum);
    } else if (rawDate instanceof Date) {
      dateObj = rawDate;
    } else if (typeof rawDate === "number") {
      dateObj = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
    } else {
      dateObj = new Date(String(rawDate));
    }
    if (isNaN(dateObj.getTime())) continue;

    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
    const timeStr = String(time).replace(/[\u202f\u00a0]/g, " ");
    const timeMins = parseTime(timeStr);
    if (timeMins === null) continue;

    if (!days[dateStr]) days[dateStr] = [];

    const clientStr = String(client).trim();
    const clientNames = clientStr.split(/\s*,\s*/).map((n) => n.trim()).filter((n) => n.length > 0);

    clientNames.forEach((name, nameIdx) => {
      // skip exact duplicate rows (same date + client + time) that some exports contain
      if (days[dateStr].some((x) => x.timeMins === timeMins && x.client.toLowerCase() === name.toLowerCase())) return;
      days[dateStr].push({
        id: `${dateStr}-${i}-${nameIdx}-${Math.random().toString(36).slice(2, 7)}`,
        client: name,
        time: timeStr.trim(),
        timeMins,
        employee: null,
        cabin: null,
        cancelled: false,
        noShow: false,
        walkIn: false,
        changed: "",
        swapLocked: false, arrivedAt: null,
      });
    });
  }
  if (sawDayNumbers && !fileMonth) {
    throw new Error("No se pudo determinar el mes. Asegúrate de que el encabezado de fecha incluya el mes, por ej. \"Fecha (Mayo)\".");
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
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDaysStr = (dateStr: string, n: number) => {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const mondayOf = (dateStr: string) => {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return ymd(d);
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

type ApptRow = Database["public"]["Tables"]["appointments"]["Row"];
type ApptChangePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: ApptRow;
  old: Partial<ApptRow>;
};

const rowToApt = (row: ApptRow): Apt => ({
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
  arrivedAt: row.arrived_at ?? null,
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
  arrived_at: apt.arrivedAt ?? null,
});

export type Perms = {
  full_agenda: boolean;
  clients_access: "none" | "read" | "edit";
  sales: boolean;
  inventory: boolean;
  reports: boolean;
  history: boolean;
  agenda_edit: boolean;
  caja: boolean;
};
const DEFAULT_PERMS: Perms = { full_agenda: true, clients_access: "read", sales: false, inventory: false, reports: true, history: false, agenda_edit: false, caja: false };

// ─── Main component ───────────────────────────────────────────────────────
type Props = { session: Session; profile: Profile; isAdmin: boolean; onSignOut: () => void };

export default function CharmScheduler({ session, profile, isAdmin, onSignOut }: Props) {
  const { employees, timeOff, overrides, reload: reloadRoster } = useRoster();
  const empMap = useMemo<Record<string, Employee>>(() => Object.fromEntries(employees.map((e) => [e.name, e])), [employees]);
  const empNames = useMemo(() => employees.map((e) => e.name), [employees]);
  const myEmployee = (profile?.employee_name || "Yaira") as EmpKey;
  const [days, setDays] = useState<Record<string, Apt[]>>({});
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [view, setView] = useState<"schedule" | "individual" | "reports" | "swaps" | "clients" | "sales" | "inventory" | "history" | "settings" | "profile">(isAdmin ? "schedule" : "individual");
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [perms, setPerms] = useState<Perms>(DEFAULT_PERMS);
  useEffect(() => {
    if (isAdmin) return;
    (async () => {
      try {
        const { data } = await supabase.from("user_permissions").select("*").eq("user_id", session.user.id).maybeSingle();
        if (data) setPerms({
          full_agenda: !!data.full_agenda,
          clients_access: (data.clients_access as Perms["clients_access"]) || "read",
          sales: !!data.sales,
          inventory: !!data.inventory,
          reports: !!data.reports,
          history: !!data.history,
          agenda_edit: !!(data as { agenda_edit?: boolean }).agenda_edit,
          caja: !!(data as { caja?: boolean }).caja,
        });
      } catch { /* defaults */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, session.user.id]);
  const canEditAgenda = isAdmin || perms.agenda_edit;
  const handleNotifLinkRef = useRef<(link: string) => void>(() => {});
  const [arriveDialog, setArriveDialog] = useState<{ open: boolean; apt: Apt | null }>({ open: false, apt: null });
  const [highlightId, setHighlightId] = useState<string | null>(null);
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
        const data = await fetchAll<ApptRow>("appointments", "*", { column: "time_mins", ascending: true });
        const grouped: Record<string, Apt[]> = {};
        (data || []).forEach((row) => {
          if (!grouped[row.date]) grouped[row.date] = [];
          grouped[row.date].push(rowToApt(row));
        });
        setDays(grouped);
        const allDates = Object.keys(grouped).sort().filter(d => d > HISTORY_CUTOFF);
        if (allDates.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          // Always land on today; if today has no citas, the nearest upcoming day; else the latest past day
          const pick = allDates.includes(today)
            ? today
            : (allDates.find((d) => d > today) ?? allDates[allDates.length - 1]);
          setActiveDate(pick);
        }
      } catch (e) {
        console.error("Load error:", e);
      } finally {
        setHasLoaded(true);
      }
    })();

    const channel = supabase
      .channel("appointments-changes")
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "appointments" } as never, (payload: ApptChangePayload) => {
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
            Object.keys(updated).forEach(date => {
              if (date !== row.date) updated[date] = updated[date].filter(a => a.id !== row.id);
            });
            if (updated[row.date]) {
              const exists = updated[row.date].some(a => a.id === row.id);
              updated[row.date] = exists
                ? updated[row.date].map(a => a.id === row.id ? rowToApt(row) : a)
                : [...updated[row.date], rowToApt(row)].sort((a, b) => a.timeMins - b.timeMins);
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

  // Deep links coming from push notification clicks
  const nlinkConsumed = useRef(false);
  useEffect(() => {
    if (!hasLoaded || nlinkConsumed.current) return;
    try {
      const v = new URLSearchParams(window.location.search).get("nlink");
      if (v) {
        nlinkConsumed.current = true;
        setTimeout(() => handleNotifLinkRef.current(v), 250);
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch { /* ignore */ }
  }, [hasLoaded]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const fn = (e: MessageEvent) => {
      if (e.data && e.data.type === "nlink" && e.data.link) handleNotifLinkRef.current(e.data.link);
    };
    navigator.serviceWorker.addEventListener("message", fn);
    return () => navigator.serviceWorker.removeEventListener("message", fn);
  }, []);

  // ── Lista de espera ──
  type WaitRow = { id: string; date: string; client_name: string; phone: string | null; note: string | null; status: string };
  const [waitlist, setWaitlist] = useState<WaitRow[]>([]);
  const [wlOpen, setWlOpen] = useState(false);
  const [wlForm, setWlForm] = useState({ name: "", phone: "" });
  useEffect(() => {
    if (!activeDate) { setWaitlist([]); return; }
    (async () => {
      const { data } = await supabase.from("waitlist").select("*")
        .eq("date", activeDate).neq("status", "removed").order("created_at");
      setWaitlist((data as WaitRow[]) || []);
    })();
  }, [activeDate]);
  const wlPending = waitlist.filter(w => w.status === "pending").length;
  const addToWaitlist = async () => {
    if (!activeDate || !wlForm.name.trim()) return;
    const { data, error } = await supabase.from("waitlist")
      .insert({ date: activeDate, client_name: wlForm.name.trim(), phone: wlForm.phone.trim() || null, created_by: session.user.id })
      .select().single();
    if (error) { toast.error(error.message); return; }
    setWaitlist(prev => [...prev, data as WaitRow]);
    setWlForm({ name: "", phone: "" });
  };
  const setWaitStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("waitlist").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setWaitlist(prev => status === "removed" ? prev.filter(w => w.id !== id) : prev.map(w => w.id === id ? { ...w, status } : w));
  };

  // ── No-show score per client (across all loaded history) ──
  const noShowCount = useMemo(() => {
    const m: Record<string, number> = {};
    Object.values(days).forEach(list => list.forEach(a => {
      if (a.noShow) { const k = a.client.trim().toLowerCase(); m[k] = (m[k] || 0) + 1; }
    }));
    return m;
  }, [days]);
  const noShowsOf = (client: string) => noShowCount[client.trim().toLowerCase()] || 0;

  // ── Printable day sheet (per cabina) ──
  const printDaySheet = () => {
    if (!activeDate) return;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const list = (days[activeDate] || []).filter(a => !a.cancelled).sort((a, b) => a.timeMins - b.timeMins);
    const cabs = Array.from(new Set(list.map(a => a.cabin).filter((c): c is number => c != null))).sort((a, b) => a - b);
    const tbl = (rows: Apt[]) => `<table><thead><tr><th>Hora</th><th>Cliente</th><th>Empleada</th><th></th></tr></thead><tbody>${
      rows.map(a => `<tr><td>${esc(a.time)}</td><td>${esc(a.client)}${a.walkIn ? " <em>(sin cita)</em>" : ""}</td><td>${esc(a.employee || "—")}</td><td>${a.noShow ? "NO ASISTIÓ" : a.arrivedAt ? "✓ llegó" : ""}</td></tr>`).join("")
    }</tbody></table>`;
    const sections = cabs.map(c => `<h2>Cabina ${c}</h2>${tbl(list.filter(a => a.cabin === c))}`).join("");
    const noCab = list.filter(a => a.cabin == null);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Agenda ${activeDate}</title><style>
      body{font-family:Georgia,serif;margin:24px;color:#222}h1{font-size:22px;margin:0 0 2px}
      .sub{color:#777;font-size:12px;margin-bottom:18px}h2{font-size:15px;border-bottom:2px solid #222;padding-bottom:3px;margin:18px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd}
      th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#777}em{color:#a55}
      @media print{body{margin:8mm}}</style></head><body>
      <h1>Charm — Agenda del día</h1><div class="sub">${dateLabelES(activeDate)} · ${list.length} citas</div>
      ${sections}${noCab.length ? `<h2>Sin cabina asignada</h2>${tbl(noCab)}` : ""}
      <script>window.onload=function(){window.print()}<\/script></body></html>`;
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { toast.error("Permite ventanas emergentes para imprimir"); return; }
    w.document.write(html); w.document.close();
  };

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
    } catch (e) {
      failCount++;
      lastErr = (e instanceof Error ? e.message : "") || "Error desconocido";
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
    } catch (e) {
      alert("Error al borrar: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isAdmin) return;
    setLoading(true); setError("");
    try {
      const parsed = await parseExcel(file);
      const assignedDays: Record<string, Apt[]> = {};
      const allRows: ReturnType<typeof aptToRow>[] = [];
      Object.keys(parsed).forEach(d => {
        assignedDays[d] = autoAssign(parsed[d], d, employees, timeOff, getEndBuffer(), overrides);
        assignedDays[d].forEach(apt => allRows.push(aptToRow(apt, d)));
      });
      const parsedDates = Object.keys(parsed);
      const datesWithData = parsedDates.filter(d => (days[d] || []).length > 0);
      if (datesWithData.length > 0) {
        const ok = window.confirm(
          `Ya hay citas guardadas para ${datesWithData.length} fecha(s) de este archivo (${datesWithData.slice(0, 4).join(", ")}${datesWithData.length > 4 ? "…" : ""}). Se reemplazarán por las del archivo nuevo.`
        );
        if (!ok) { setLoading(false); e.target.value = ""; return; }
      }
      markSaveStart();
      // Replace, don't accumulate: remove the old rows of these dates first
      const { error: delErr } = await supabase.from("appointments").delete().in("date", parsedDates);
      if (delErr) throw delErr;
      const { error, data } = await supabase.from("appointments").upsert(allRows).select("updated_at");
      if (error) throw error;
      setDays(prev => ({ ...prev, ...assignedDays }));
      setActiveDate(Object.keys(assignedDays).sort()[0]);
      setView("schedule");
      markSaveSuccess(Array.isArray(data) ? data[data.length - 1]?.updated_at ?? null : null);
    } catch (err) {
      markSaveError(err);
      setError((err instanceof Error ? err.message : "") || "No se pudo leer el archivo");
    }
    setLoading(false);
    e.target.value = "";
  };

  const sortedDates = useMemo(() => Object.keys(days).filter(d => d > HISTORY_CUTOFF).sort(), [days]);
  const currentAppts = useMemo(() => (activeDate ? (days[activeDate] || []) : []), [activeDate, days]);
  const activeWeekday = activeDate ? weekdayOf(activeDate) : 1;
  useEffect(() => { if (activeDate) setWeekStart(mondayOf(activeDate)); }, [activeDate]);

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
    if (changes.cancelled === true && wlPending > 0) {
      toast.info(`Hay ${wlPending} cliente(s) en lista de espera para este día`, {
        action: { label: "Ver lista", onClick: () => setWlOpen(true) },
      });
    }
  };

  const removeApt = async (id: string) => {
    if (!canEditAgenda || !activeDate) return;
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
    if (!canEditAgenda || !activeDate) return;
    const { time, client } = walkInForm;
    if (!time.trim() || !client.trim()) { alert("Por favor ingresa hora y nombre del cliente."); return; }
    const timeMins = parseTime(time);
    if (timeMins === null) { alert("Formato de hora inválido. Ejemplo: 2:30 p.m."); return; }
    const wd = weekdayOf(activeDate);
    const counts: Record<string, number> = {};
    const lastSeen: Record<string, number> = {};
    empNames.forEach((n) => { counts[n] = 0; lastSeen[n] = -999; });
    currentAppts.forEach(a => {
      if (a.employee && counts[a.employee] != null && !a.cancelled && !a.noShow) {
        counts[a.employee]++;
        lastSeen[a.employee] = Math.max(lastSeen[a.employee], a.timeMins);
      }
    });
    let cands = employees.filter(e => isWorkingOn(e, timeMins, wd, 0, overrides[e.name]?.[activeDate]) && !isOffOn(timeOff, e.name, activeDate) && (e.maxClients == null || counts[e.name] < e.maxClients));
    if (cands.length === 0) cands = employees.filter(e => isWorkingOn(e, timeMins, wd, 0, overrides[e.name]?.[activeDate]) && !isOffOn(timeOff, e.name, activeDate));
    if (cands.length === 0) cands = [...employees];
    cands.sort((a, b) => {
      const gapA = timeMins - lastSeen[a.name];
      const gapB = timeMins - lastSeen[b.name];
      if (gapA !== gapB) return gapB - gapA;
      return counts[a.name] - counts[b.name];
    });
    const chosen = cands[0];
    const newApt: Apt = {
      id: `walkin-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      client: client.trim(),
      time: formatTime(timeMins),
      timeMins,
      employee: chosen.name,
      cabin: chosen.cabin,
      cancelled: false, noShow: false, walkIn: true, changed: "", swapLocked: false, arrivedAt: null,
    };
    setDays(prev => ({
      ...prev,
      [activeDate]: [...(prev[activeDate] || []), newApt].sort((a, b) => a.timeMins - b.timeMins),
    }));
    await saveApt(newApt, activeDate);
    setWalkInForm({ open: false, time: "", client: "" });
  };

  const [syncing, setSyncing] = useState(false);
  const syncDnsuite = async () => {
    if (!isAdmin || syncing) return;
    setSyncing(true);
    try {
      const { data: cfg } = await supabase.from("dnsuite_config").select("webhook_secret").eq("id", 1).maybeSingle();
      const secret = (cfg as { webhook_secret?: string } | null)?.webhook_secret;
      if (!secret) { toast.error("Configura la conexión con DNSuite primero (tabla dnsuite_config)."); setSyncing(false); return; }
      const { data, error } = await supabase.functions.invoke("dnsuite-sync", { body: { trigger: "manual" }, headers: { "x-sync-secret": secret } });
      if (error) throw error;
      const r = (data as { ok?: boolean; result?: string; error?: string });
      if (r?.ok) toast.success("Sincronizado con DNSuite — " + (r.result || ""));
      else toast.error("DNSuite: " + (r?.error || "error desconocido"));
    } catch (e) {
      toast.error("No se pudo sincronizar: " + (e instanceof Error ? e.message : String(e)));
    }
    setSyncing(false);
  };

  const confirmArrival = async (apt: Apt, cabin: number | null) => {
    if (!activeDate) return;
    const arrivedAt = new Date().toISOString();
    setDays(prev => ({ ...prev, [activeDate]: (prev[activeDate] || []).map(x => x.id === apt.id ? { ...x, cabin, arrivedAt } : x) }));
    setArriveDialog({ open: false, apt: null });
    const { error } = await supabase.from("appointments").update({ cabin, arrived_at: arrivedAt }).eq("id", apt.id);
    if (error) toast.error(error.message || "No se pudo confirmar la llegada");
    else toast.success("Llegada confirmada — empleada notificada");
  };

  const reAutoAssign = async () => {
    if (!canEditAgenda || !activeDate) return;
    if (!confirm("¿Volver a asignar todo el día?")) return;
    const reset = (days[activeDate] || []).map(a => ({ ...a, employee: null as EmpKey | null, cabin: null as number | null }));
    const assigned = autoAssign(reset, activeDate, employees, timeOff, getEndBuffer(), overrides);
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
    const stats: Record<string, { total: number; attended: number; noShow: number; cancelled: number }> = {};
    empNames.forEach((n) => { stats[n] = { total: 0, attended: 0, noShow: 0, cancelled: 0 }; });
    currentAppts.forEach(a => {
      if (!a.employee || !stats[a.employee]) return;
      stats[a.employee].total++;
      if (a.noShow) stats[a.employee].noShow++;
      else if (a.cancelled) stats[a.employee].cancelled++;
      else stats[a.employee].attended++;
    });
    return stats;
  }, [currentAppts, empNames]);

  const exportIndividualText = (emp: EmpKey) => {
    const list = currentAppts.filter(a => a.employee === emp && !a.cancelled).sort((a, b) => a.timeMins - b.timeMins);
    const header = `📋 ${emp} — ${dateLabelES(activeDate)}\nCabina ${empMap[emp]?.cabin ?? "?"}\n\n`;
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
        const rows: (string | number | null)[][] = [];
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
    } catch (err) {
      alert(`Error al exportar: ${err instanceof Error ? err.message : String(err)}`);
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
      <div className="min-h-screen w-full bg-background overflow-x-hidden">
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

  type ViewKey = "schedule" | "individual" | "reports" | "swaps" | "clients" | "sales" | "inventory" | "history" | "settings" | "profile";
  const navItems: { key: ViewKey; label: string; icon: React.ReactNode; badge?: number }[] = isAdmin
    ? [
        { key: "schedule", label: "Agenda", icon: <CalendarDays size={16} /> },
        { key: "individual", label: "Individual", icon: <UserRound size={16} /> },
        { key: "reports", label: "Reportes", icon: <BarChart3 size={16} /> },
        { key: "swaps", label: "Solicitudes", icon: <Repeat size={16} />, badge: pendingSwaps },
        { key: "clients", label: "Clientes", icon: <Users size={16} /> },
        { key: "sales", label: "Ventas", icon: <ShoppingBag size={16} /> },
        { key: "inventory", label: "Inventario", icon: <Package size={16} /> },
        { key: "history", label: "Historial", icon: <History size={16} /> },
        { key: "settings", label: "Ajustes", icon: <Settings size={16} /> },
      ]
    : [
        ...(perms.full_agenda ? [{ key: "schedule" as ViewKey, label: "Agenda", icon: <CalendarDays size={16} /> }] : []),
        { key: "individual" as ViewKey, label: "Mi agenda", icon: <UserRound size={16} /> },
        { key: "swaps" as ViewKey, label: "Solicitudes", icon: <Repeat size={16} />, badge: pendingSwaps },
        ...(perms.clients_access !== "none" ? [{ key: "clients" as ViewKey, label: "Clientes", icon: <Users size={16} /> }] : []),
        ...(perms.reports ? [{ key: "reports" as ViewKey, label: "Mis reportes", icon: <BarChart3 size={16} /> }] : []),
        ...(perms.sales ? [{ key: "sales" as ViewKey, label: "Ventas", icon: <ShoppingBag size={16} /> }] : []),
        ...(perms.inventory ? [{ key: "inventory" as ViewKey, label: "Inventario", icon: <Package size={16} /> }] : []),
        ...(perms.history ? [{ key: "history" as ViewKey, label: "Historial", icon: <History size={16} /> }] : []),
        ...(perms.caja && !perms.sales ? [{ key: "sales" as ViewKey, label: "Caja", icon: <Wallet size={16} /> }] : []),
      ];
  const goView = (key: ViewKey) => {
    if (key === "clients") setSelectedClientId(null);
    setView(key);
    setSidebarOpen(false);
  };
  const sidebarNav = (
    <nav className="flex-1 py-3 overflow-y-auto">
      {navItems.map((it) => (
        <button key={it.key} onClick={() => goView(it.key)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-label text-left transition-colors"
          style={{
            backgroundColor: view === it.key ? "hsl(var(--secondary))" : "transparent",
            color: "hsl(var(--primary))",
            borderLeft: view === it.key ? "3px solid hsl(var(--primary))" : "3px solid transparent",
            opacity: view === it.key ? 1 : 0.75,
          }}>
          {it.icon}
          <span className="flex-1">{it.label}</span>
          {it.badge && it.badge > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] bg-destructive text-destructive-foreground rounded-full">{it.badge}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen w-full bg-background overflow-x-hidden md:flex">
      <aside className="hidden md:flex md:flex-col w-56 flex-shrink-0 border-r border-border bg-card sticky top-0 h-screen">
        <div className="px-4 pt-5 pb-3 border-b border-border">
          <span className="font-display text-primary" style={{ fontSize: 30, fontWeight: 500, lineHeight: 1 }}>Charm</span>
          <div className="text-[10px] font-label text-accent mt-1">CLÍNICA ESTÉTICA</div>
        </div>
        {sidebarNav}
        <div className="px-4 py-3 border-t border-border text-[10px] font-label text-muted-foreground truncate">
          {profile?.display_name || profile?.employee_name || ""}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-card border-r border-border flex flex-col">
            <div className="px-4 pt-5 pb-3 border-b border-border flex items-center justify-between">
              <span className="font-display text-primary" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1 }}>Charm</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5" aria-label="Cerrar menú"><X size={18} className="text-primary" /></button>
            </div>
            {sidebarNav}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
      <header className="border-b border-border sticky top-0 z-10 bg-card">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 md:py-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 border border-border text-primary" aria-label="Abrir menú"><Menu size={16} /></button>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-primary md:hidden" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1 }}>Charm</span>
              <span className="text-xs font-label text-accent hidden md:inline">{profile?.display_name || profile?.employee_name}</span>
            </div>
            <div className="text-[11px] font-label text-muted-foreground leading-relaxed hidden sm:block">
              {saveStatus === "saving" ? "Guardando automáticamente…" : lastSavedLabel ? `Último guardado: ${lastSavedLabel} · Santo Domingo` : "Sin guardado reciente"}
            </div>
            {pendingCount > 0 && (
              <button
                onClick={() => void flushPending({ manual: true })}
                className="text-xs flex items-center gap-1 px-2 py-1 bg-destructive text-destructive-foreground font-label"
                title={lastSaveError || "Reintentar guardar cambios pendientes"}
              >
                <Save size={11} /> Guardar ({pendingCount})
              </button>
            )}
            <button
              onClick={() => setShowDebug(s => !s)}
              className="text-[10px] px-2 py-1 border border-border font-label hover:bg-accent/10 hidden sm:inline-flex"
              title="Mostrar panel de depuración de autosave"
            >
              {showDebug ? "Debug ▾" : "Debug ▸"}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <GlobalSearch
              isAdmin={isAdmin}
              employees={empNames}
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
                } catch (error) {
                  markSaveError(error);
                  toast.error((error instanceof Error ? error.message : "") || "No se pudo actualizar el bloqueo");
                }
              } : undefined}
            />
            <NotificationBell
              userId={session.user.id}
              onLink={(link) => handleNotifLinkRef.current(link)}
            />
            {(() => { handleNotifLinkRef.current = (link: string) => {
                if (link === "swaps") setView("swaps");
                else if (link.startsWith("date:")) {
                  const d = link.slice(5);
                  if (days[d]) setActiveDate(d);
                }
                else if (link.startsWith("apt:")) {
                  const parts = link.split(":");
                  const aptId = parts[1];
                  const d = parts[2];
                  if (d && days[d]) setActiveDate(d);
                  setView(isAdmin || perms.full_agenda ? "schedule" : "individual");
                  setHighlightId(aptId);
                  setTimeout(() => {
                    (document.getElementById("apt-" + aptId) || document.getElementById("apt-m-" + aptId))?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 450);
                  setTimeout(() => setHighlightId(null), 6000);
                }
              }; return null; })()}
            {isAdmin && view === "schedule" && (
              <>
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
            <AccountMenu
              name={profile?.display_name || profile?.employee_name || ""}
              email={session.user.email || ""}
              onProfile={() => setView("profile")}
              onSignOut={onSignOut}
            />
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
        {showDebug && (
          <div className="bg-muted/40 border-t border-border px-4 md:px-6 py-2 text-[11px] font-mono text-foreground/80 space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>queue: <b>{pendingRef.current.size}</b></span>
              <span>pendingCount(state): <b>{pendingCount}</b></span>
              <span>flushing: <b>{String(isFlushingRef.current)}</b></span>
              <span>status: <b>{saveStatus || "idle"}</b></span>
              <span>flushes: <b>{flushCount}</b></span>
              <span>timer: <b>{flushTimerRef.current ? "armed" : "off"}</b></span>
              <span>tick: {debugTick}</span>
            </div>
            <div>lastSavedAt: {lastSavedAt || "—"}</div>
            <div>lastFlushAt: {lastFlushAt || "—"}</div>
            <div className="break-words">lastError: {lastSaveError || "—"}</div>
            <div className="break-words">
              pendingIds: {pendingRef.current.size === 0 ? "—" : Array.from(pendingRef.current.keys()).join(", ")}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => void flushPending({ manual: true })}
                className="px-2 py-0.5 border border-border hover:bg-accent/10"
              >Force flush</button>
              <button
                onClick={() => { setLastSaveError(""); }}
                className="px-2 py-0.5 border border-border hover:bg-accent/10"
              >Clear error</button>
            </div>
          </div>
        )}
        {(view === "schedule" || view === "individual") && weekStart && (() => {
          const wkEnd = addDaysStr(weekStart, 5);
          const d0 = new Date(weekStart + "T12:00:00");
          const d1 = new Date(wkEnd + "T12:00:00");
          const rangeLabel = d0.getMonth() === d1.getMonth()
            ? `${d0.getDate()}–${d1.getDate()} ${MONTHS_ES[d0.getMonth()]} ${d0.getFullYear()}`
            : `${d0.getDate()} ${MONTHS_ES[d0.getMonth()]} – ${d1.getDate()} ${MONTHS_ES[d1.getMonth()]} ${d1.getFullYear()}`;
          return (
            <div className="max-w-7xl mx-auto px-4 md:px-6 pb-3">
              <div className="text-center text-[10px] font-label text-accent mb-1.5 tracking-[0.15em] uppercase">{rangeLabel}</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setWeekStart(addDaysStr(weekStart, -7))} className="px-2 py-3 border border-primary text-primary bg-card hover:bg-accent/10" aria-label="Semana anterior"><ChevronLeft size={16} /></button>
                <div className="grid grid-cols-6 gap-1.5 flex-1">
                  {[0, 1, 2, 3, 4, 5].map((i) => {
                    const d = addDaysStr(weekStart, i);
                    const dd = new Date(d + "T12:00:00");
                    const count = (days[d] || []).filter((a) => !a.cancelled).length;
                    const isActive = activeDate === d;
                    const has = count > 0;
                    return (
                      <button key={d} onClick={() => setActiveDate(d)} className="text-center py-2 border transition-colors"
                        style={{
                          borderColor: isActive ? "hsl(var(--primary))" : "hsl(var(--border))",
                          backgroundColor: isActive ? "hsl(var(--primary))" : "hsl(var(--card))",
                          color: isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--primary))",
                          opacity: isActive ? 1 : (has ? 1 : 0.45),
                        }}>
                        <div className="text-[10px] font-label" style={{ opacity: 0.85 }}>{DAYS_ES_SHORT[dd.getDay()]}</div>
                        <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.1 }}>{dd.getDate()}</div>
                        <div className="text-[9px] font-label" style={{ opacity: 0.7 }}>{has ? count : "·"}</div>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setWeekStart(addDaysStr(weekStart, 7))} className="px-2 py-3 border border-primary text-primary bg-card hover:bg-accent/10" aria-label="Semana siguiente"><ChevronRight size={16} /></button>
              </div>
            </div>
          );
        })()}
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        {view === "schedule" && (isAdmin || perms.full_agenda) && (
          <>
            <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
              <div>
                <div className="text-xs font-label text-accent">AGENDA PARA</div>
                <h2 className="font-display text-primary" style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 400, lineHeight: 1.1 }}>
                  {dateLabelES(activeDate)}
                </h2>
              </div>
              {canEditAgenda && <div className="flex gap-2 flex-wrap">
                <button onClick={() => setWalkInForm({ open: true, time: "", client: "" })}
                  className="px-4 py-2 text-xs font-label border border-primary text-primary bg-card flex items-center gap-2">
                  <UserPlus size={14} /> Sin Cita
                </button>
                <button onClick={reAutoAssign}
                  className="px-4 py-2 text-xs font-label border border-primary text-primary bg-card flex items-center gap-2">
                  <RotateCcw size={14} /> Reasignar
                </button>
                <button onClick={() => void syncDnsuite()} disabled={syncing}
                  className="px-4 py-2 text-xs font-label border border-accent text-accent bg-card flex items-center gap-2">
                  <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> {syncing ? "Sincronizando…" : "Sincronizar"}
                </button>
                <button onClick={printDaySheet}
                  className="px-4 py-2 text-xs font-label border border-primary text-primary bg-card flex items-center gap-2">
                  <Printer size={14} /> Imprimir
                </button>
                <button onClick={() => setWlOpen(o => !o)}
                  className="px-4 py-2 text-xs font-label border bg-card flex items-center gap-2"
                  style={{ borderColor: wlPending > 0 ? "hsl(var(--accent))" : "hsl(var(--primary))", color: wlPending > 0 ? "hsl(var(--accent))" : "hsl(var(--primary))" }}>
                  <ListPlus size={14} /> Lista de espera{wlPending > 0 ? ` (${wlPending})` : ""}
                </button>
                {isAdmin && (
                <button onClick={clearAllData}
                  className="px-4 py-2 text-xs font-label border border-destructive text-destructive bg-card flex items-center gap-2">
                  <Trash2 size={14} /> Borrar Todo
                </button>
                )}
              </div>}
            </div>

            {wlOpen && canEditAgenda && (
              <div className="border border-accent bg-card p-4 mb-6">
                <div className="text-xs font-label text-accent mb-3">LISTA DE ESPERA · {activeDate ? dateLabelES(activeDate) : ""}</div>
                <div className="flex gap-2 flex-wrap mb-3">
                  <input value={wlForm.name} onChange={(e) => setWlForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Nombre del cliente" className="px-3 py-2 text-sm border border-border bg-background text-foreground flex-1 min-w-[160px]" />
                  <input value={wlForm.phone} onChange={(e) => setWlForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="Teléfono (opcional)" className="px-3 py-2 text-sm border border-border bg-background text-foreground w-40" />
                  <button onClick={() => void addToWaitlist()} className="px-4 py-2 text-xs font-label bg-primary text-primary-foreground">Agregar</button>
                </div>
                {waitlist.length === 0 && <div className="text-xs italic text-muted-foreground">Nadie en espera para este día.</div>}
                <div className="space-y-1">
                  {waitlist.map(w => (
                    <div key={w.id} className="flex items-center gap-2 text-sm flex-wrap border-b border-border pb-1">
                      <span className="text-foreground">{w.client_name}</span>
                      {w.phone && <a href={`tel:${w.phone}`} className="text-xs text-accent flex items-center gap-1"><PhoneCall size={11} />{w.phone}</a>}
                      {w.status !== "pending" && <span className="text-[10px] font-label px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">{w.status === "called" ? "LLAMADA" : "AGENDADA"}</span>}
                      <span className="flex-1" />
                      {w.status === "pending" && (
                        <button onClick={() => void setWaitStatus(w.id, "called")} className="px-2 py-1 text-[10px] font-label border border-border text-muted-foreground">Llamé</button>
                      )}
                      {w.status !== "booked" && (
                        <button onClick={() => { setWalkInForm({ open: true, time: "", client: w.client_name }); void setWaitStatus(w.id, "booked"); }}
                          className="px-2 py-1 text-[10px] font-label border border-success text-success">Agendar</button>
                      )}
                      <button onClick={() => void setWaitStatus(w.id, "removed")} className="px-2 py-1 text-[10px] font-label border border-border text-muted-foreground" title="Quitar">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
              {empNames.map(emp => {
                const e = empMap[emp];
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
                const empColor = a.employee ? (empMap[a.employee]?.color ?? "hsl(var(--muted-foreground))") : "hsl(var(--muted-foreground))";
                const dimmed = a.cancelled || a.noShow;
                return (
                  <div key={a.id} id={`apt-${a.id}`} className="grid gap-3 px-4 py-3 border-b items-center"
                    style={{
                      borderColor: "hsl(var(--border))",
                      backgroundColor: highlightId === a.id ? "hsl(var(--secondary))" : idx % 2 === 0 ? "transparent" : "hsl(var(--background))",
                      gridTemplateColumns: "90px 1fr 130px 50px 240px",
                      opacity: dimmed ? 0.5 : 1,
                      outline: highlightId === a.id ? "2px solid hsl(var(--accent))" : undefined,
                    }}>
                    <div className="text-sm text-primary">{a.time}</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <button onClick={() => setProfileClient(a.client)} className="text-sm truncate text-primary hover:underline text-left" style={{ textDecoration: dimmed ? "line-through" : undefined }}>{a.client}</button>
                      {noShowsOf(a.client) >= 2 && <span className="text-[9px] font-label px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive whitespace-nowrap" title={`No asistió ${noShowsOf(a.client)} veces`}>⚠ {noShowsOf(a.client)} FALTAS</span>}
                      {a.walkIn && <span className="text-[10px] px-2 py-0.5 flex-shrink-0 font-label bg-chip-walkin-bg text-chip-walkin-fg">SIN CITA</span>}
                    </div>
                    <div>
                      <select value={a.employee || ""}
                        onChange={(e) => updateApt(a.id, { employee: (e.target.value || null) as EmpKey | null, cabin: e.target.value ? (empMap[e.target.value]?.cabin ?? null) : null })}
                        className="w-full px-2 py-1 text-sm bg-background text-foreground"
                        style={{ border: `1px solid hsl(var(--border))`, borderLeftWidth: 3, borderLeftColor: empColor }}>
                        <option value="">—</option>
                        {empNames.map(emp => {
                          const working = empMap[emp] ? isWorkingOn(empMap[emp], a.timeMins, activeWeekday, 0, activeDate ? overrides[emp]?.[activeDate] : null) : false;
                          const lunch = empMap[emp] ? onLunchOn(empMap[emp], a.timeMins, activeWeekday) : false;
                          return <option key={emp} value={emp}>{emp}{!working ? (lunch ? " (almuerzo)" : " (fuera)") : ""}</option>;
                        })}
                      </select>
                    </div>
                    <div className="text-sm text-muted-foreground">{a.cabin || "—"}</div>
                    <div className="flex items-center justify-end gap-1">
                      {a.employee && !a.cancelled && (a.arrivedAt ? (
                        <span className="text-[9px] font-label px-1.5 py-0.5 rounded-full bg-success/15 text-success whitespace-nowrap" title={`Llegó ${new Date(a.arrivedAt).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`}>✓ LLEGÓ</span>
                      ) : (canEditAgenda ? (
                        <button onClick={() => setArriveDialog({ open: true, apt: a })} className="px-2 py-1 text-[10px] font-label border border-success text-success whitespace-nowrap">LLEGÓ</button>
                      ) : null))}
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
                      {canEditAgenda && <button onClick={() => removeApt(a.id)} className="p-1 opacity-40 hover:opacity-100" title="Eliminar">
                        <Trash2 size={14} className="text-destructive" />
                      </button>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {currentAppts.length === 0 && <div className="p-8 text-center text-sm italic border border-border bg-card text-muted-foreground">No hay citas para este día.</div>}
              {currentAppts.map((a) => {
                const empColor = a.employee ? (empMap[a.employee]?.color ?? "hsl(var(--muted-foreground))") : "hsl(var(--muted-foreground))";
                const dimmed = a.cancelled || a.noShow;
                return (
                  <div key={a.id} id={`apt-m-${a.id}`} className="border border-border bg-card p-3" style={{ borderLeft: `4px solid ${empColor}`, opacity: dimmed ? 0.55 : 1, outline: highlightId === a.id ? "2px solid hsl(var(--accent))" : undefined }}>
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-medium text-primary">{a.time}</span>
                        <button onClick={() => setProfileClient(a.client)} className="text-sm text-primary hover:underline text-left" style={{ textDecoration: dimmed ? "line-through" : undefined }}>{a.client}</button>
                        {noShowsOf(a.client) >= 2 && <span className="text-[9px] font-label px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive" title={`No asistió ${noShowsOf(a.client)} veces`}>⚠ {noShowsOf(a.client)}</span>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {a.employee && !a.cancelled && (a.arrivedAt ? (
                          <span className="text-[9px] font-label px-1.5 py-0.5 rounded-full bg-success/15 text-success">✓</span>
                        ) : (canEditAgenda ? (
                          <button onClick={() => setArriveDialog({ open: true, apt: a })} className="px-2 py-0.5 text-[10px] font-label border border-success text-success">LLEGÓ</button>
                        ) : null))}
                        {a.walkIn && <span className="text-[10px] px-2 py-0.5 font-label bg-chip-walkin-bg text-chip-walkin-fg">SIN CITA</span>}
                        {canEditAgenda && <button onClick={() => removeApt(a.id)} className="p-1 opacity-50"><Trash2 size={14} className="text-destructive" /></button>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <select value={a.employee || ""}
                        onChange={(e) => updateApt(a.id, { employee: (e.target.value || null) as EmpKey | null, cabin: e.target.value ? (empMap[e.target.value]?.cabin ?? null) : null })}
                        className="flex-1 px-2 py-2 text-sm bg-background text-foreground"
                        style={{ border: `1px solid hsl(var(--border))`, borderLeftWidth: 3, borderLeftColor: empColor }}>
                        <option value="">— Sin asignar —</option>
                        {empNames.map(emp => {
                          const working = empMap[emp] ? isWorkingOn(empMap[emp], a.timeMins, activeWeekday, 0, activeDate ? overrides[emp]?.[activeDate] : null) : false;
                          const lunch = empMap[emp] ? onLunchOn(empMap[emp], a.timeMins, activeWeekday) : false;
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
                {empNames.map(emp => (
                  <button key={emp} onClick={() => setSelectedEmployee(emp)}
                    className="px-5 py-2 text-xs font-label border"
                    style={{
                      backgroundColor: selectedEmployee === emp ? (empMap[emp]?.color ?? "transparent") : "transparent",
                      color: selectedEmployee === emp ? "hsl(var(--card))" : (empMap[emp]?.color ?? "hsl(var(--primary))"),
                      borderColor: empMap[emp]?.color ?? "hsl(var(--border))",
                    }}>
                    {emp}
                  </button>
                ))}
              </div>
            )}

            <div className="border border-border bg-card p-6 md:p-8">
              <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
                <div>
                  <div className="font-display" style={{ fontSize: 36, fontWeight: 500, lineHeight: 1, color: empMap[selectedEmployee]?.color }}>
                    {selectedEmployee}
                  </div>
                  {empMap[selectedEmployee] && (
                    <div className="text-xs font-label mt-1 text-accent">
                      CABINA {empMap[selectedEmployee].cabin ?? "—"}{empMap[selectedEmployee].schedule[activeWeekday]?.works
                        ? ` · ${formatTime(empMap[selectedEmployee].schedule[activeWeekday].startMin).replace(" a.m.","am").replace(" p.m.","pm")} – ${formatTime(empMap[selectedEmployee].schedule[activeWeekday].endMin).replace(" a.m.","am").replace(" p.m.","pm")}`
                        : " · Descansa hoy"}
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
          <ClientsModule isAdmin={isAdmin} canEdit={isAdmin || perms.clients_access === "edit"} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} />
        )}

        {view === "sales" && (isAdmin || perms.sales || perms.caja) && (
          <SalesModule profile={profile} isAdmin={isAdmin} cajaOnly={!isAdmin && !perms.sales && perms.caja} />
        )}

        {view === "inventory" && (
          <InventoryModule isAdmin={isAdmin} />
        )}

        {view === "history" && (isAdmin || perms.history) && (
          <HistoryView
            days={days}
            cutoff={HISTORY_CUTOFF}
            onClientClick={(name) => setProfileClient(name)}
          />
        )}

        {view === "settings" && isAdmin && (
          <SettingsModule isAdmin={isAdmin} onChanged={reloadRoster} />
        )}

        {view === "profile" && (
          <ProfileModule session={session} onRosterChanged={reloadRoster} />
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
        employees={empNames}
      />

      <ClientProfileModal
        clientName={profileClient}
        onClose={() => setProfileClient(null)}
      />

      {arriveDialog.open && arriveDialog.apt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setArriveDialog({ open: false, apt: null })} />
          <div className="relative bg-card border border-border p-5 w-full max-w-xs space-y-3">
            <div className="font-display text-primary" style={{ fontSize: 22, fontWeight: 500 }}>Confirmar llegada</div>
            <div className="text-sm text-primary">{arriveDialog.apt.client}</div>
            <div className="text-xs text-muted-foreground">{arriveDialog.apt.time} · {arriveDialog.apt.employee || "Sin asignar"}</div>
            <label className="block text-xs">
              <span className="font-label text-accent">Confirmar cabina</span>
              <select id="arrive-cabin" defaultValue={String(arriveDialog.apt.cabin ?? 1)} className="mt-1 w-full px-3 py-2 text-sm border border-border bg-background text-foreground">
                {[1, 2, 3, 4].map((c) => <option key={c} value={c}>Cabina {c}</option>)}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setArriveDialog({ open: false, apt: null })} className="px-3 py-2 text-xs font-label border border-border text-muted-foreground">Cancelar</button>
              <button onClick={() => { const sel = document.getElementById("arrive-cabin") as HTMLSelectElement | null; void confirmArrival(arriveDialog.apt as Apt, sel ? parseInt(sel.value) || null : null); }} className="px-3 py-2 text-xs font-label bg-success text-success-foreground">Confirmar llegada</button>
            </div>
          </div>
        </div>
      )}

      <footer className="text-center py-8 text-xs font-label text-accent">
        CHARM CLÍNICA ESTÉTICA · AGENDA DIARIA
      </footer>
      </div>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────

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


function AccountMenu({ name, email, onProfile, onSignOut }: { name: string; email: string; onProfile: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const initials = (name || email || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Cuenta"
        className="w-9 h-9 rounded-full bg-primary text-primary-foreground text-xs font-label inline-flex items-center justify-center">
        {initials || "?"}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-border shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border">
            <div className="text-sm text-primary truncate">{name || "—"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{email}</div>
          </div>
          <button onClick={() => { setOpen(false); onProfile(); }} className="w-full text-left px-3 py-2.5 text-xs font-label text-primary hover:bg-background flex items-center gap-2">
            <UserRound size={14} /> Mi perfil
          </button>
          <button onClick={() => { setOpen(false); onSignOut(); }} className="w-full text-left px-3 py-2.5 text-xs font-label text-destructive hover:bg-background flex items-center gap-2">
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
