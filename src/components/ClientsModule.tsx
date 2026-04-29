import { useState, useMemo, useEffect } from "react";
import {
  Plus, Search, Edit2, Phone, Mail, Cake, MessageCircle,
  AlertTriangle, ChevronLeft, Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { trackSave } from "@/lib/saveSync";

const EMPLOYEES: Record<string, { color: string }> = {
  Yaira:  { color: "#C8956D" },
  Belkis: { color: "#8B6F47" },
  Cielo:  { color: "#A67B5B" },
  Lisa:   { color: "#6B4423" },
};

const fmtMoney = (n: any) => {
  if (n === null || n === undefined || isNaN(n)) return "RD$ 0.00";
  return `RD$ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const SubNavBtn = ({ active, onClick, children }: any) => (
  <button onClick={onClick} className="px-3 py-1.5 text-xs tracking-[0.15em] uppercase whitespace-nowrap"
    style={{ backgroundColor: active ? "#3E2A1A" : "transparent", color: active ? "#F5EFE6" : "#3E2A1A", border: "1px solid #3E2A1A", opacity: active ? 1 : 0.65, fontFamily: "Lora, serif" }}>
    {children}
  </button>
);

const Section = ({ title, subtitle, action, children }: any) => (
  <>
    <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
      <div>
        {subtitle && <div className="text-xs tracking-[0.3em]" style={{ color: "#8B6F47" }}>{subtitle}</div>}
        <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "clamp(28px, 5vw, 44px)", color: "#3E2A1A", fontWeight: 400, lineHeight: 1.1 }}>{title}</h2>
      </div>
      {action}
    </div>
    {children}
  </>
);

type Props = {
  isAdmin: boolean;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
};

export default function ClientsModule({ isAdmin, selectedClientId, setSelectedClientId }: Props) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [appointmentNotes, setAppointmentNotes] = useState<Record<string, any>>({});
  const [view, setView] = useState<"list" | "birthdays" | "inactive">("list");
  const [search, setSearch] = useState("");
  const [editForm, setEditForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cust, inv, pkg, apt, notes] = await Promise.all([
          fetchAll<any>("customers"),
          fetchAll<any>("invoices", "*, invoice_items(*), invoice_payments(*)"),
          fetchAll<any>("customer_packages"),
          fetchAll<any>("appointments"),
          fetchAll<any>("appointment_notes"),
        ]);
        setCustomers(cust || []);
        setInvoices(inv || []);
        setPackages(pkg || []);
        setAppointments(apt || []);
        const notesMap: Record<string, any> = {};
        (notes || []).forEach((n: any) => { notesMap[n.appointment_id] = n; });
        setAppointmentNotes(notesMap);
      } catch (e) {
        console.error("Load error:", e);
      }
      setLoading(false);
    })();
  }, []);

  const enriched = useMemo(() => {
    return customers.map(c => {
      const clientInvoices = invoices.filter(i => i.customer_id === c.id && i.status !== "voided");
      const totalSpent = clientInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
      let lastVisit: string | null = null;
      appointments.forEach(apt => {
        if (apt.client?.toLowerCase().trim() === c.name?.toLowerCase().trim() && !apt.cancelled) {
          if (!lastVisit || apt.date > lastVisit) lastVisit = apt.date;
        }
      });
      const visits = clientInvoices.length;
      const activePkgs = packages.filter(p => p.customer_id === c.id && p.active && p.used_sessions < p.total_sessions);
      return { ...c, totalSpent, lastVisit, visits, activePkgs };
    });
  }, [customers, invoices, appointments, packages]);

  const selectedClient = customers.find(c => c.id === selectedClientId);
  if (selectedClient) {
    return <ClientDetail
      client={selectedClient} setCustomers={setCustomers}
      invoices={invoices} packages={packages}
      appointments={appointments}
      appointmentNotes={appointmentNotes} setAppointmentNotes={setAppointmentNotes}
      onBack={() => setSelectedClientId(null)}
      isAdmin={isAdmin}
    />;
  }

  const filtered = enriched.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name?.toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q);
  }).sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

  const currentMonth = new Date().getMonth() + 1;
  const birthdaysThisMonth = enriched.filter(c => {
    if (!c.birthday) return false;
    return new Date(c.birthday).getMonth() + 1 === currentMonth;
  }).sort((a, b) => new Date(a.birthday).getDate() - new Date(b.birthday).getDate());

  const sixtyDaysAgo = new Date(); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sixtyAgoStr = sixtyDaysAgo.toISOString().slice(0, 10);
  const inactive = enriched.filter(c => c.lastVisit && c.lastVisit < sixtyAgoStr)
    .sort((a, b) => (a.lastVisit || "").localeCompare(b.lastVisit || ""));

  const saveClient = async () => {
    if (!editForm.name?.trim()) { alert("El nombre es obligatorio."); return; }
    try {
      if (editForm.id) {
        const { error } = await trackSave(supabase.from("customers").update({
          name: editForm.name, phone: editForm.phone, email: editForm.email,
          birthday: editForm.birthday || null, address: editForm.address,
          notes: editForm.notes, allergies: editForm.allergies,
        }).eq("id", editForm.id));
        if (error) throw error;
        setCustomers(prev => prev.map(c => c.id === editForm.id ? { ...c, ...editForm } : c));
      } else {
        const { data, error } = await trackSave(supabase.from("customers").insert({
          name: editForm.name, phone: editForm.phone, email: editForm.email,
          birthday: editForm.birthday || null, address: editForm.address,
          notes: editForm.notes, allergies: editForm.allergies, source: "manual",
        }).select().single());
        if (error) throw error;
        setCustomers(prev => [...prev, data]);
      }
      setEditForm(null);
    } catch (e: any) {
      alert("Error al guardar: " + e.message);
    }
  };

  const exportClients = () => {
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [["Nombre", "Teléfono", "Correo", "Cumpleaños", "Total gastado", "Visitas", "Última visita", "Notas"]];
    enriched.forEach(c => rows.push([c.name, c.phone || "", c.email || "", c.birthday || "", c.totalSpent, c.visits, c.lastVisit || "", c.notes || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, `CLIENTES_CHARM_${todayISO()}.xlsx`);
  };

  if (loading) return <div className="p-12 text-center text-xs tracking-[0.3em]" style={{ color: "#8B6F47" }}>CARGANDO CLIENTES…</div>;

  return (
    <Section title="Clientes" subtitle="BASE DE CLIENTES"
      action={isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportClients} className="px-4 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}><Download size={14} /> Exportar</button>
          <button onClick={() => setEditForm({ name: "", phone: "", email: "", birthday: "", address: "", notes: "", allergies: "" })} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}><Plus size={14} /> Nuevo</button>
        </div>
      )}>
      <div className="flex gap-2 mb-6 flex-wrap">
        <SubNavBtn active={view === "list"} onClick={() => setView("list")}>Todos ({customers.length})</SubNavBtn>
        <SubNavBtn active={view === "birthdays"} onClick={() => setView("birthdays")}>🎂 Cumpleaños mes ({birthdaysThisMonth.length})</SubNavBtn>
        <SubNavBtn active={view === "inactive"} onClick={() => setView("inactive")}>📞 Inactivos +60d ({inactive.length})</SubNavBtn>
      </div>

      {editForm && <ClientEditForm form={editForm} setForm={setEditForm} onSave={saveClient} onCancel={() => setEditForm(null)} />}

      {view === "list" && (
        <>
          <div className="border p-4 mb-4 flex items-center gap-2" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
            <Search size={14} style={{ color: "#8B6F47" }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o correo…" className="flex-1 px-2 py-1 text-sm bg-transparent outline-none" style={{ color: "#3E2A1A" }} />
          </div>
          {filtered.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>{customers.length === 0 ? "Aún no hay clientes. Sube una agenda y se agregarán automáticamente." : "Sin resultados."}</div>}
          <div className="space-y-2">
            {filtered.map(c => <ClientRow key={c.id} c={c} onClick={() => setSelectedClientId(c.id)} />)}
          </div>
        </>
      )}

      {view === "birthdays" && (
        <div className="space-y-2">
          {birthdaysThisMonth.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>Nadie cumple años este mes.</div>}
          {birthdaysThisMonth.map(c => (
            <div key={c.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", borderLeft: "4px solid #C8956D" }}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Cake size={18} style={{ color: "#C8956D" }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{c.name}</div>
                  <div className="text-xs" style={{ color: "#8B6F47" }}>Día {new Date(c.birthday).getDate()} · {c.phone || "Sin teléfono"}</div>
                </div>
              </div>
              {c.phone && <button onClick={() => sendBirthdayWA(c)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Felicitar</button>}
              <button onClick={() => setSelectedClientId(c.id)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Ver perfil</button>
            </div>
          ))}
        </div>
      )}

      {view === "inactive" && (
        <div className="space-y-2">
          {inactive.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>No hay clientes inactivos.</div>}
          {inactive.map(c => {
            const daysSince = c.lastVisit ? Math.floor((+new Date() - +new Date(c.lastVisit + "T12:00:00")) / (1000 * 60 * 60 * 24)) : 0;
            return (
              <div key={c.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", borderLeft: "4px solid #A04040" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{c.name}</div>
                  <div className="text-xs" style={{ color: "#8B6F47" }}>{daysSince} días sin venir · Última: {c.lastVisit}</div>
                </div>
                {c.phone && <button onClick={() => sendReactivationWA(c)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Reactivar</button>}
                <button onClick={() => setSelectedClientId(c.id)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Ver perfil</button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ClientRow({ c, onClick }: any) {
  return (
    <button onClick={onClick} className="w-full border p-4 flex items-center gap-3 text-left hover:opacity-90 flex-wrap" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0" style={{ backgroundColor: "#E8D9BF", color: "#6B4423" }}>
        {(c.name || "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{c.name}</div>
        <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: "#8B6F47" }}>
          {c.phone && <span><Phone size={10} className="inline mr-1" />{c.phone}</span>}
          {c.email && <span><Mail size={10} className="inline mr-1" />{c.email}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs" style={{ color: "#6B5B47" }}>{c.visits} visita{c.visits === 1 ? "" : "s"}</div>
        {c.totalSpent > 0 && <div className="text-sm" style={{ color: "#3E2A1A", fontWeight: 500 }}>{fmtMoney(c.totalSpent)}</div>}
        {c.lastVisit && <div className="text-[10px] italic" style={{ color: "#8B6F47" }}>Últ: {c.lastVisit}</div>}
      </div>
      {c.activePkgs?.length > 0 && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#E8D9BF", color: "#6B4423" }}>📦 {c.activePkgs.length}</span>}
    </button>
  );
}

function ClientEditForm({ form, setForm, onSave, onCancel }: any) {
  return (
    <div className="border p-5 mb-6" style={{ borderColor: "#8B6F47", backgroundColor: "#FBF7F0" }}>
      <div className="text-xs tracking-[0.25em] mb-4" style={{ color: "#8B6F47" }}>{form.id ? "EDITAR CLIENTE" : "NUEVO CLIENTE"}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Nombre completo *</label>
          <input type="text" value={form.name || ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Teléfono / WhatsApp</label>
          <input type="tel" value={form.phone || ""} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} placeholder="809-555-1234" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Correo</label>
          <input type="email" value={form.email || ""} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Cumpleaños</label>
          <input type="date" value={form.birthday || ""} onChange={e => setForm((f: any) => ({ ...f, birthday: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Dirección</label>
          <input type="text" value={form.address || ""} onChange={e => setForm((f: any) => ({ ...f, address: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs tracking-[0.2em] uppercase mb-1 flex items-center gap-1" style={{ color: "#A04040" }}><AlertTriangle size={11} /> Alergias / Condiciones médicas</label>
          <textarea value={form.allergies || ""} onChange={e => setForm((f: any) => ({ ...f, allergies: e.target.value }))} rows={2} placeholder="Ej. Embarazo, alergia a..., medicamentos actuales" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Notas generales</label>
          <textarea value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Preferencias, observaciones..." className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onSave} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}>Guardar</button>
        <button onClick={onCancel} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Cancelar</button>
      </div>
    </div>
  );
}

function ClientDetail({ client, setCustomers, invoices, packages, appointments, appointmentNotes, setAppointmentNotes, onBack, isAdmin }: any) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...client });
  const [tab, setTab] = useState<"history" | "invoices" | "packages">("history");

  const allAppts = useMemo(() =>
    appointments
      .filter((apt: any) => apt.client?.toLowerCase().trim() === client.name?.toLowerCase().trim())
      .sort((a: any, b: any) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""))),
    [appointments, client.name]
  );

  const clientInvoices = invoices.filter((i: any) => i.customer_id === client.id).sort((a: any, b: any) => (b.invoice_number || 0) - (a.invoice_number || 0));
  const clientPackages = packages.filter((p: any) => p.customer_id === client.id);
  const totalSpent = clientInvoices.filter((i: any) => i.status !== "voided").reduce((s: number, i: any) => s + Number(i.total || 0), 0);

  const saveEdit = async () => {
    try {
      const { error } = await trackSave(supabase.from("customers").update({
        name: editForm.name, phone: editForm.phone, email: editForm.email,
        birthday: editForm.birthday || null, address: editForm.address,
        notes: editForm.notes, allergies: editForm.allergies,
      }).eq("id", client.id));
      if (error) throw error;
      setCustomers((prev: any[]) => prev.map(c => c.id === client.id ? { ...c, ...editForm } : c));
      setEditing(false);
    } catch (e: any) { alert("Error: " + e.message); }
  };

  const sendWA = (msg: string) => {
    const phone = (client.phone || "").replace(/\D/g, "");
    if (!phone) { alert("Sin teléfono."); return; }
    const url = `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  const upcomingAppt = allAppts.find((a: any) => a.date >= todayISO() && !a.cancelled && !a.no_show);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase mb-4" style={{ color: "#8B6F47", fontFamily: "Lora, serif" }}>
        <ChevronLeft size={14} /> Volver a clientes
      </button>

      {editing ? (
        <ClientEditForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={() => { setEditing(false); setEditForm({ ...client }); }} />
      ) : (
        <div className="border p-6 mb-6" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-medium flex-shrink-0" style={{ backgroundColor: "#E8D9BF", color: "#6B4423" }}>
              {(client.name || "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "32px", color: "#3E2A1A", fontWeight: 500, lineHeight: 1.1 }}>{client.name}</div>
              <div className="text-xs flex items-center gap-3 flex-wrap mt-2" style={{ color: "#6B5B47" }}>
                {client.phone && <span className="flex items-center gap-1"><Phone size={11} /> {client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail size={11} /> {client.email}</span>}
                {client.birthday && <span className="flex items-center gap-1"><Cake size={11} /> {client.birthday}</span>}
              </div>
              {client.address && <div className="text-xs mt-1" style={{ color: "#8B6F47" }}>{client.address}</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {client.phone && <button onClick={() => sendWA(`Hola ${client.name}, le saluda Charm Clínica Estética.`)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> WhatsApp</button>}
              {isAdmin && <button onClick={() => setEditing(true)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}><Edit2 size={12} /> Editar</button>}
            </div>
          </div>

          {client.allergies && (
            <div className="mt-4 p-3 border" style={{ borderColor: "#A04040", backgroundColor: "#FAEBEB" }}>
              <div className="text-xs flex items-center gap-1 mb-1" style={{ color: "#A04040", fontWeight: 600 }}><AlertTriangle size={12} /> ALERGIAS / CONDICIONES</div>
              <div className="text-sm" style={{ color: "#3E2A1A" }}>{client.allergies}</div>
            </div>
          )}
          {client.notes && (
            <div className="mt-4 p-3" style={{ backgroundColor: "#F5EFE6" }}>
              <div className="text-xs tracking-[0.2em] mb-1" style={{ color: "#8B6F47" }}>NOTAS</div>
              <div className="text-sm italic" style={{ color: "#3E2A1A" }}>{client.notes}</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mt-6 pt-4 border-t" style={{ borderColor: "#D4C4A8" }}>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8B6F47" }}>VISITAS</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#3E2A1A", fontWeight: 500, lineHeight: 1 }}>{allAppts.filter((a: any) => !a.cancelled && !a.no_show).length}</div>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8B6F47" }}>GASTADO</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#3E2A1A", fontWeight: 500, lineHeight: 1 }}>{fmtMoney(totalSpent)}</div>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8B6F47" }}>PAQUETES</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#3E2A1A", fontWeight: 500, lineHeight: 1 }}>{clientPackages.filter((p: any) => p.used_sessions < p.total_sessions).length}</div>
            </div>
          </div>

          {upcomingAppt && client.phone && (
            <div className="mt-4 pt-4 border-t flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "#D4C4A8" }}>
              <div className="text-xs" style={{ color: "#8B6F47" }}>Próxima cita: <span style={{ color: "#3E2A1A", fontWeight: 500 }}>{upcomingAppt.date} a las {upcomingAppt.time}</span></div>
              <button onClick={() => sendWA(`Hola ${client.name}, le recordamos su cita en Charm el ${upcomingAppt.date} a las ${upcomingAppt.time}.`)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Recordatorio</button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <SubNavBtn active={tab === "history"} onClick={() => setTab("history")}>📅 Historial ({allAppts.length})</SubNavBtn>
        <SubNavBtn active={tab === "invoices"} onClick={() => setTab("invoices")}>🧾 Facturas ({clientInvoices.length})</SubNavBtn>
        <SubNavBtn active={tab === "packages"} onClick={() => setTab("packages")}>📦 Paquetes ({clientPackages.length})</SubNavBtn>
      </div>

      {tab === "history" && (
        <div className="space-y-2">
          {allAppts.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>Sin historial.</div>}
          {allAppts.map((apt: any) => <AppointmentNoteRow key={apt.id} apt={apt} appointmentNotes={appointmentNotes} setAppointmentNotes={setAppointmentNotes} />)}
        </div>
      )}
      {tab === "invoices" && (
        <div className="space-y-2">
          {clientInvoices.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>Sin facturas.</div>}
          {clientInvoices.map((inv: any) => (
            <div key={inv.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
              <div className="text-xs" style={{ color: "#8B6F47" }}>#{inv.invoice_number}</div>
              <div className="text-xs" style={{ color: "#6B5B47" }}>{inv.date}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm" style={{ color: "#3E2A1A" }}>{(inv.invoice_items || []).map((i: any) => i.name).join(", ")}</div>
                <div className="text-xs" style={{ color: "#8B6F47" }}>Vendido por {inv.sold_by}</div>
              </div>
              <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{fmtMoney(inv.total)}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "packages" && (
        <div className="space-y-2">
          {clientPackages.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", color: "#6B5B47" }}>Sin paquetes.</div>}
          {clientPackages.map((p: any) => {
            const remaining = p.total_sessions - p.used_sessions;
            const isDone = remaining === 0;
            return (
              <div key={p.id} className="border p-4" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", borderLeft: `4px solid ${isDone ? "#8B6F47" : "#6B8E5A"}` }}>
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                  <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{p.package_name}</div>
                  <div className="text-xs" style={{ color: "#8B6F47" }}>Comprado: {p.purchased_date}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="h-2 w-full" style={{ backgroundColor: "#EAE0CC" }}>
                      <div style={{ width: `${(p.used_sessions / p.total_sessions) * 100}%`, height: "100%", backgroundColor: isDone ? "#8B6F47" : "#6B8E5A" }} />
                    </div>
                  </div>
                  <div className="text-sm" style={{ color: "#3E2A1A" }}>
                    <span style={{ fontWeight: 600 }}>{remaining}</span> de {p.total_sessions} restantes
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppointmentNoteRow({ apt, appointmentNotes, setAppointmentNotes }: any) {
  const note = appointmentNotes[apt.id] || { observations: "", treatments: "" };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const empColor = apt.employee ? EMPLOYEES[apt.employee]?.color : "#999";
  const dimmed = apt.cancelled || apt.no_show;
  const past = apt.date < todayISO();

  const save = async () => {
    try {
      const { error } = await trackSave(supabase.from("appointment_notes").upsert({
        appointment_id: apt.id,
        treatments: draft.treatments || "",
        observations: draft.observations || "",
      }, { onConflict: "appointment_id" }));
      if (error) throw error;
      setAppointmentNotes((prev: any) => ({ ...prev, [apt.id]: { ...draft, appointment_id: apt.id } }));
      setEditing(false);
    } catch (e: any) { alert("Error: " + e.message); }
  };

  return (
    <div className="border p-4" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", borderLeft: `4px solid ${empColor}`, opacity: dimmed ? 0.6 : 1 }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color: "#3E2A1A" }}>{apt.date}</span>
          <span style={{ color: "#8B6F47" }}>{apt.time}</span>
          {apt.employee && <span className="text-xs px-2 py-0.5" style={{ backgroundColor: empColor, color: "#FBF7F0" }}>{apt.employee}</span>}
          {apt.cabin && <span className="text-xs" style={{ color: "#8B6F47" }}>· Cabina {apt.cabin}</span>}
          {apt.cancelled && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#8B6F47", color: "white" }}>CANCELÓ</span>}
          {apt.no_show && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#A04040", color: "white" }}>NO ASISTIÓ</span>}
        </div>
        {past && !dimmed && !editing && (
          <button onClick={() => { setDraft(note); setEditing(true); }} className="text-xs flex items-center gap-1" style={{ color: "#8B6F47" }}>
            <Edit2 size={11} /> {note.observations || note.treatments ? "Editar notas" : "Agregar notas"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <input type="text" value={draft.treatments || ""} onChange={e => setDraft((d: any) => ({ ...d, treatments: e.target.value }))} placeholder="Tratamientos: Ej. Láser axilas + bigote" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
          <textarea value={draft.observations || ""} onChange={e => setDraft((d: any) => ({ ...d, observations: e.target.value }))} rows={2} placeholder="Observaciones..." className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}>Guardar</button>
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Cancelar</button>
          </div>
        </div>
      ) : (
        (note.treatments || note.observations) && (
          <div className="mt-2 space-y-1">
            {note.treatments && <div className="text-xs" style={{ color: "#3E2A1A" }}><span style={{ color: "#8B6F47", fontWeight: 500 }}>Tratamientos:</span> {note.treatments}</div>}
            {note.observations && <div className="text-xs italic" style={{ color: "#6B5B47" }}>{note.observations}</div>}
          </div>
        )
      )}
    </div>
  );
}

function sendBirthdayWA(c: any) {
  const phone = (c.phone || "").replace(/\D/g, "");
  const msg = `¡Feliz cumpleaños ${c.name.split(" ")[0]}! 🎂✨ Todo el equipo de Charm Clínica Estética te desea un día maravilloso. Tenemos una sorpresa especial para ti. 💕`;
  const url = phone ? `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

function sendReactivationWA(c: any) {
  const phone = (c.phone || "").replace(/\D/g, "");
  const msg = `Hola ${c.name.split(" ")[0]}, le saluda Charm Clínica Estética. Hace tiempo que no la vemos por acá. Tenemos novedades y promociones que le pueden interesar. ¿Le gustaría agendar una cita?`;
  const url = phone ? `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}
