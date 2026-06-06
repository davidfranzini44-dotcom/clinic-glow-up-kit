import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getEndBuffer, setEndBuffer } from "@/lib/roster";
import { toast } from "sonner";
import { Plus, Trash2, Save, CalendarOff, Check } from "lucide-react";

const WD = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const toHHMM = (m: number | null | undefined) =>
  m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string): number | null => {
  if (!s) return null;
  const [h, mm] = s.split(":").map((x) => parseInt(x, 10));
  if (isNaN(h)) return null;
  return h * 60 + (mm || 0);
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type EmpRow = { name: string; cabin: number | null; color: string | null; max_clients: number | null; active: boolean; sort_order: number };
type SchedRow = { employee_name: string; weekday: number; works: boolean; start_min: number | null; end_min: number | null; lunch_start_min: number | null; lunch_minutes: number };
type OffRow = { id: string; employee_name: string; date: string; reason: string };
type ProfileRow = { id: string; display_name: string | null; employee_name: string | null };

function blankSchedule(): SchedRow[] {
  const rows: SchedRow[] = [];
  for (let wd = 0; wd <= 6; wd++) {
    rows.push({ employee_name: "", weekday: wd, works: wd !== 0, start_min: 540, end_min: 1080, lunch_start_min: 720, lunch_minutes: 60 });
  }
  return rows;
}

export default function SettingsModule({ isAdmin, onChanged }: { isAdmin: boolean; onChanged?: () => void }) {
  const [emps, setEmps] = useState<EmpRow[]>([]);
  const [scheds, setScheds] = useState<Record<string, Record<number, SchedRow>>>({});
  const [offs, setOffs] = useState<OffRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [offEmp, setOffEmp] = useState("");
  const [offDate, setOffDate] = useState(todayISO());
  const [bufferOn, setBufferOn] = useState(getEndBuffer() > 0);
  const [bufferMin, setBufferMin] = useState(getEndBuffer() || 30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, s, o, p, r] = await Promise.all([
        supabase.from("employee_settings").select("*").order("sort_order"),
        supabase.from("employee_schedules").select("*"),
        supabase.from("employee_time_off").select("id,employee_name,date,reason").gte("date", todayISO()).order("date"),
        supabase.from("profiles").select("id,display_name,employee_name"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      setEmps((e.data || []) as EmpRow[]);
      const sm: Record<string, Record<number, SchedRow>> = {};
      ((s.data || []) as SchedRow[]).forEach((row) => { (sm[row.employee_name] ??= {})[row.weekday] = row; });
      setScheds(sm);
      setOffs((o.data || []) as OffRow[]);
      setProfiles((p.data || []) as ProfileRow[]);
      const admins = new Set<string>();
      ((r.data || []) as { user_id: string; role: string }[]).forEach((x) => { if (x.role === "admin") admins.add(x.user_id); });
      setAdminIds(admins);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateEmpField = (name: string, field: keyof EmpRow, value: unknown) => {
    setEmps((prev) => prev.map((e) => (e.name === name ? { ...e, [field]: value } : e)));
  };
  const updateSched = (name: string, wd: number, patch: Partial<SchedRow>) => {
    setScheds((prev) => {
      const forEmp = { ...(prev[name] || {}) };
      const cur = forEmp[wd] || { employee_name: name, weekday: wd, works: true, start_min: 540, end_min: 1080, lunch_start_min: 720, lunch_minutes: 60 };
      forEmp[wd] = { ...cur, ...patch, employee_name: name, weekday: wd };
      return { ...prev, [name]: forEmp };
    });
  };

  const saveEmployee = async (name: string) => {
    if (!isAdmin) return;
    const emp = emps.find((e) => e.name === name);
    if (!emp) return;
    try {
      const { error: e1 } = await supabase.from("employee_settings")
        .update({ cabin: emp.cabin, color: emp.color, max_clients: emp.max_clients, active: emp.active, sort_order: emp.sort_order })
        .eq("name", name);
      if (e1) throw e1;
      const rows = Object.values(scheds[name] || {}).map((r) => ({
        employee_name: name, weekday: r.weekday, works: r.works,
        start_min: r.start_min, end_min: r.end_min, lunch_start_min: r.lunch_start_min, lunch_minutes: r.lunch_minutes || 60,
      }));
      if (rows.length) {
        const { error: e2 } = await supabase.from("employee_schedules").upsert(rows, { onConflict: "employee_name,weekday" });
        if (e2) throw e2;
      }
      toast.success(`${name} guardado`);
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const addEmployee = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const sort = (emps.reduce((m, e) => Math.max(m, e.sort_order), 0)) + 1;
      const { error: e1 } = await supabase.from("employee_settings").insert({ name, cabin: 1, color: "#8A5A6E", max_clients: null, active: true, sort_order: sort });
      if (e1) throw e1;
      const rows = blankSchedule().map((r) => ({ ...r, employee_name: name }));
      const { error: e2 } = await supabase.from("employee_schedules").upsert(rows, { onConflict: "employee_name,weekday" });
      if (e2) throw e2;
      setNewName("");
      toast.success(`${name} agregada`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const deactivate = async (name: string) => {
    if (!confirm(`¿Desactivar a ${name}? Dejará de aparecer en la asignación.`)) return;
    try {
      const { error } = await supabase.from("employee_settings").update({ active: false }).eq("name", name);
      if (error) throw error;
      await load();
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const markOff = async () => {
    if (!offEmp || !offDate) { toast("Elige empleada y fecha."); return; }
    try {
      const { error } = await supabase.from("employee_time_off").upsert(
        { employee_name: offEmp, date: offDate, reason: "off" },
        { onConflict: "employee_name,date" }
      );
      if (error) throw error;
      toast.success(`${offEmp} marcada libre el ${offDate}`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const removeOff = async (id: string) => {
    try {
      const { error } = await supabase.from("employee_time_off").delete().eq("id", id);
      if (error) throw error;
      setOffs((prev) => prev.filter((o) => o.id !== id));
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const saveProfile = async (prof: ProfileRow, makeAdmin: boolean) => {
    try {
      const { error: e1 } = await supabase.from("profiles").update({ employee_name: prof.employee_name }).eq("id", prof.id);
      if (e1) throw e1;
      if (makeAdmin && !adminIds.has(prof.id)) {
        const { error } = await supabase.from("user_roles").upsert({ user_id: prof.id, role: "admin" }, { onConflict: "user_id,role" });
        if (error) throw error;
      } else if (!makeAdmin && adminIds.has(prof.id)) {
        const { error } = await supabase.from("user_roles").delete().eq("user_id", prof.id).eq("role", "admin");
        if (error) throw error;
      }
      toast.success("Usuario actualizado");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (!isAdmin) return <div className="p-8 text-center text-sm italic text-muted-foreground">Solo administradores.</div>;
  if (loading) return <div className="p-8 text-center text-sm italic text-muted-foreground">Cargando…</div>;

  const activeEmps = emps.filter((e) => e.active);

  return (
    <div className="space-y-8">
      {/* ── Employees & schedules ── */}
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-display text-primary" style={{ fontSize: 28, fontWeight: 500 }}>Empleadas y Horarios</h2>
          <div className="flex items-center gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre nueva empleada"
              className="px-3 py-2 text-sm border border-border bg-background text-foreground" />
            <button onClick={addEmployee} className="px-3 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-1">
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {activeEmps.map((emp) => (
            <div key={emp.name} className="border border-border bg-card p-4" style={{ borderLeft: `4px solid ${emp.color || "#8A5A6E"}` }}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <span className="font-display text-primary" style={{ fontSize: 22, fontWeight: 500 }}>{emp.name}</span>
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  <label className="flex items-center gap-1">Cabina
                    <input type="number" value={emp.cabin ?? ""} onChange={(e) => updateEmpField(emp.name, "cabin", e.target.value ? parseInt(e.target.value) : null)}
                      className="w-14 px-2 py-1 border border-border bg-background text-foreground" /></label>
                  <label className="flex items-center gap-1">Color
                    <input type="text" value={emp.color ?? ""} onChange={(e) => updateEmpField(emp.name, "color", e.target.value)}
                      className="w-28 px-2 py-1 border border-border bg-background text-foreground" /></label>
                  <label className="flex items-center gap-1">Máx/día
                    <input type="number" value={emp.max_clients ?? ""} onChange={(e) => updateEmpField(emp.name, "max_clients", e.target.value ? parseInt(e.target.value) : null)}
                      className="w-14 px-2 py-1 border border-border bg-background text-foreground" placeholder="∞" /></label>
                  <button onClick={() => saveEmployee(emp.name)} className="px-3 py-1.5 text-xs font-label bg-primary text-primary-foreground flex items-center gap-1"><Save size={12} /> Guardar</button>
                  <button onClick={() => deactivate(emp.name)} className="p-1.5 opacity-50 hover:opacity-100" title="Desactivar"><Trash2 size={14} className="text-destructive" /></button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-accent font-label text-left">
                    <th className="py-1 pr-3">Día</th><th className="pr-3">Trabaja</th><th className="pr-3">Entrada</th><th className="pr-3">Salida</th><th className="pr-3">Almuerzo</th>
                  </tr></thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                      const sc = scheds[emp.name]?.[wd] || { employee_name: emp.name, weekday: wd, works: wd !== 0, start_min: 540, end_min: 1080, lunch_start_min: 720, lunch_minutes: 60 };
                      return (
                        <tr key={wd} className="border-t border-border">
                          <td className="py-1.5 pr-3 text-primary">{WD[wd]}</td>
                          <td className="pr-3">
                            <input type="checkbox" checked={sc.works} onChange={(e) => updateSched(emp.name, wd, { works: e.target.checked })} />
                          </td>
                          <td className="pr-3"><input type="time" value={toHHMM(sc.start_min)} disabled={!sc.works}
                            onChange={(e) => updateSched(emp.name, wd, { start_min: toMin(e.target.value) })}
                            className="px-2 py-1 border border-border bg-background text-foreground disabled:opacity-40" /></td>
                          <td className="pr-3"><input type="time" value={toHHMM(sc.end_min)} disabled={!sc.works}
                            onChange={(e) => updateSched(emp.name, wd, { end_min: toMin(e.target.value) })}
                            className="px-2 py-1 border border-border bg-background text-foreground disabled:opacity-40" /></td>
                          <td className="pr-3"><input type="time" value={toHHMM(sc.lunch_start_min)} disabled={!sc.works}
                            onChange={(e) => updateSched(emp.name, wd, { lunch_start_min: toMin(e.target.value) })}
                            className="px-2 py-1 border border-border bg-background text-foreground disabled:opacity-40" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Time off ── */}
      <div>
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 500 }}>Días libres / Enferma</h2>
        <div className="border border-border bg-card p-4">
          <div className="flex items-end gap-2 flex-wrap mb-4">
            <label className="text-xs flex flex-col gap-1">Empleada
              <select value={offEmp} onChange={(e) => setOffEmp(e.target.value)} className="px-3 py-2 text-sm border border-border bg-background text-foreground">
                <option value="">—</option>
                {activeEmps.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
              </select></label>
            <label className="text-xs flex flex-col gap-1">Fecha
              <input type="date" value={offDate} onChange={(e) => setOffDate(e.target.value)} className="px-3 py-2 text-sm border border-border bg-background text-foreground" /></label>
            <button onClick={markOff} className="px-3 py-2 text-xs font-label bg-primary text-primary-foreground flex items-center gap-1"><CalendarOff size={14} /> Marcar libre</button>
          </div>
          {offs.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">Sin días libres próximos.</div>
          ) : (
            <div className="space-y-1">
              {offs.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm border-b border-border py-1.5">
                  <span className="text-primary">{o.employee_name} — {o.date}</span>
                  <button onClick={() => removeOff(o.id)} className="p-1 opacity-50 hover:opacity-100"><Trash2 size={13} className="text-destructive" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Assignment rules ── */}
      <div>
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 500 }}>Reglas de asignación</h2>
        <div className="border border-border bg-card p-4">
          <label className="flex items-center gap-2 text-sm text-primary cursor-pointer">
            <input type="checkbox" checked={bufferOn} onChange={(e) => { const on = e.target.checked; setBufferOn(on); setEndBuffer(on ? bufferMin : 0); }} />
            No asignar citas cerca de la hora de salida de la empleada
          </label>
          <div className="flex items-center gap-2 mt-3 text-xs" style={{ opacity: bufferOn ? 1 : 0.4 }}>
            <span className="text-muted-foreground">Minutos antes de su salida:</span>
            <input type="number" min={0} step={5} value={bufferMin} disabled={!bufferOn}
              onChange={(e) => { const m = Math.max(0, parseInt(e.target.value) || 0); setBufferMin(m); if (bufferOn) setEndBuffer(m); }}
              className="w-16 px-2 py-1 border border-border bg-background text-foreground" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Ej.: si una empleada termina a las 6:00 pm y pones 30, la asignación automática no le dará citas nuevas después de las 5:30 pm.
          </p>
        </div>
      </div>

      {/* ── Users ── */}
      <div>
        <h2 className="font-display text-primary mb-4" style={{ fontSize: 28, fontWeight: 500 }}>Usuarios</h2>
        <p className="text-xs text-muted-foreground mb-3">Las nuevas empleadas se registran en la pantalla de inicio de sesión; aquí les asignas su nombre en la agenda y si son administradoras.</p>
        <div className="border border-border bg-card divide-y divide-border">
          {profiles.map((p) => (
            <UserRow key={p.id} prof={p} isAdminUser={adminIds.has(p.id)} empNames={activeEmps.map((e) => e.name)} onSave={saveProfile} />
          ))}
        </div>
      </div>
    </div>
  );
}

function UserRow({ prof, isAdminUser, empNames, onSave }: {
  prof: ProfileRow; isAdminUser: boolean; empNames: string[];
  onSave: (p: ProfileRow, makeAdmin: boolean) => void;
}) {
  const [name, setName] = useState(prof.employee_name || "");
  const [admin, setAdmin] = useState(isAdminUser);
  return (
    <div className="flex items-center justify-between gap-3 p-3 flex-wrap">
      <span className="text-sm text-primary min-w-[140px]">{prof.display_name || "(sin nombre)"}</span>
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-1">Empleada
          <input list="emp-names-list" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre en agenda"
            className="px-2 py-1 border border-border bg-background text-foreground" /></label>
        <datalist id="emp-names-list">{empNames.map((n) => <option key={n} value={n} />)}</datalist>
        <label className="flex items-center gap-1"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin</label>
        <button onClick={() => onSave({ ...prof, employee_name: name.trim() || null }, admin)}
          className="px-3 py-1.5 text-xs font-label bg-primary text-primary-foreground flex items-center gap-1"><Check size={12} /> Guardar</button>
      </div>
    </div>
  );
}
