import { useState, useMemo, useEffect, type ReactNode, type Dispatch, type SetStateAction } from "react";
import {
  Plus, Search, Edit2, Phone, Mail, Cake, MessageCircle,
  AlertTriangle, ChevronLeft, Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { trackSave } from "@/lib/saveSync";
import type { Tables } from "@/integrations/supabase/types";

type Customer = Tables<'customers'>;
type Invoice = Tables<'invoices'> & {
  invoice_items: Tables<'invoice_items'>[];
  invoice_payments: Tables<'invoice_payments'>[];
};
type CustomerPackage = Tables<'customer_packages'>;
type ApptRow = Tables<'appointments'>;
type ApptNote = Tables<'appointment_notes'>;
type NotesMap = Record<string, Partial<ApptNote>>;
type ClientForm = Partial<Customer>;
type EnrichedCustomer = Customer & {
  totalSpent: number; lastVisit: string | null; visits: number; activePkgs: CustomerPackage[];
};

const EMPLOYEES: Record<string, { color: string }> = {
  Yaira:  { color: "#C2566E" },
  Belkis: { color: "#8A5A6E" },
  Cielo:  { color: "#C58A3A" },
  Lisa:   { color: "#8A4A2E" },
};

const fmtMoney = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || isNaN(n as number)) return "RD$ 0.00";
  return `RD$ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const SubNavBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="px-3 py-1.5 text-xs tracking-[0.15em] uppercase whitespace-nowrap"
    style={{ backgroundColor: active ? "#2B2024" : "transparent", color: active ? "#FBF8F6" : "#2B2024", border: "1px solid #2B2024", opacity: active ? 1 : 0.65, fontFamily: "Lora, serif" }}>
    {children}
  </button>
);

const Section = ({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <>
    <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
      <div>
        {subtitle && <div className="text-xs tracking-[0.3em]" style={{ color: "#8A5A6E" }}>{subtitle}</div>}
        <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "clamp(28px, 5vw, 44px)", color: "#2B2024", fontWeight: 400, lineHeight: 1.1 }}>{title}</h2>
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [packages, setPackages] = useState<CustomerPackage[]>([]);
  const [appointments, setAppointments] = useState<ApptRow[]>([]);
  const [appointmentNotes, setAppointmentNotes] = useState<NotesMap>({});
  const [view, setView] = useState<"list" | "birthdays" | "inactive">("list");
  const [search, setSearch] = useState("");
  const [editForm, setEditForm] = useState<ClientForm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cust, inv, pkg, apt, notes] = await Promise.all([
          fetchAll<Customer>("customers"),
          fetchAll<Invoice>("invoices", "*, invoice_items(*), invoice_payments(*)"),
          fetchAll<CustomerPackage>("customer_packages"),
          fetchAll<ApptRow>("appointments"),
          fetchAll<ApptNote>("appointment_notes"),
        ]);
        setCustomers(cust || []);
        setInvoices(inv || []);
        setPackages(pkg || []);
        setAppointments(apt || []);
        const notesMap: NotesMap = {};
        (notes || []).forEach((n) => { notesMap[n.appointment_id] = n; });
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
    } catch (e) {
      alert("Error al guardar: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const exportClients = () => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number | null)[][] = [["Nombre", "Teléfono", "Correo", "Cumpleaños", "Total gastado", "Visitas", "Última visita", "Notas"]];
    enriched.forEach(c => rows.push([c.name, c.phone || "", c.email || "", c.birthday || "", c.totalSpent, c.visits, c.lastVisit || "", c.notes || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, `CLIENTES_CHARM_${todayISO()}.xlsx`);
  };

  if (loading) return <div className="p-12 text-center text-xs tracking-[0.3em]" style={{ color: "#8A5A6E" }}>CARGANDO CLIENTES…</div>;

  return (
    <Section title="Clientes" subtitle="BASE DE CLIENTES"
      action={isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportClients} className="px-4 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: "#2B2024", color: "#2B2024" }}><Download size={14} /> Exportar</button>
          <button onClick={() => setEditForm({ name: "", phone: "", email: "", birthday: "", address: "", notes: "", allergies: "" })} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#2B2024", color: "#FBF8F6" }}><Plus size={14} /> Nuevo</button>
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
          <div className="border p-4 mb-4 flex items-center gap-2" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF" }}>
            <Search size={14} style={{ color: "#8A5A6E" }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o correo…" className="flex-1 px-2 py-1 text-sm bg-transparent outline-none" style={{ color: "#2B2024" }} />
          </div>
          {filtered.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>{customers.length === 0 ? "Aún no hay clientes. Sube una agenda y se agregarán automáticamente." : "Sin resultados."}</div>}
          <div className="space-y-2">
            {filtered.map(c => <ClientRow key={c.id} c={c} onClick={() => setSelectedClientId(c.id)} />)}
          </div>
        </>
      )}

      {view === "birthdays" && (
        <div className="space-y-2">
          {birthdaysThisMonth.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>Nadie cumple años este mes.</div>}
          {birthdaysThisMonth.map(c => (
            <div key={c.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", borderLeft: "4px solid #C2566E" }}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Cake size={18} style={{ color: "#C2566E" }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: "#2B2024" }}>{c.name}</div>
                  <div className="text-xs" style={{ color: "#8A5A6E" }}>Día {new Date(c.birthday).getDate()} · {c.phone || "Sin teléfono"}</div>
                </div>
              </div>
              {c.phone && <button onClick={() => sendBirthdayWA(c)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Felicitar</button>}
              <button onClick={() => setSelectedClientId(c.id)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#2B2024", color: "#2B2024" }}>Ver perfil</button>
            </div>
          ))}
        </div>
      )}

      {view === "inactive" && (
        <div className="space-y-2">
          {inactive.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>No hay clientes inactivos.</div>}
          {inactive.map(c => {
            const daysSince = c.lastVisit ? Math.floor((+new Date() - +new Date(c.lastVisit + "T12:00:00")) / (1000 * 60 * 60 * 24)) : 0;
            return (
              <div key={c.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", borderLeft: "4px solid #C53A2D" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#2B2024" }}>{c.name}</div>
                  <div className="text-xs" style={{ color: "#8A5A6E" }}>{daysSince} días sin venir · Última: {c.lastVisit}</div>
                </div>
                {c.phone && <button onClick={() => sendReactivationWA(c)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Reactivar</button>}
                <button onClick={() => setSelectedClientId(c.id)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#2B2024", color: "#2B2024" }}>Ver perfil</button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ClientRow({ c, onClick }: { c: EnrichedCustomer; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full border p-4 flex items-center gap-3 text-left hover:opacity-90 flex-wrap" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF" }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0" style={{ backgroundColor: "#F4E7EB", color: "#8A4A2E" }}>
        {(c.name || "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: "#2B2024" }}>{c.name}</div>
        <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: "#8A5A6E" }}>
          {c.phone && <span><Phone size={10} className="inline mr-1" />{c.phone}</span>}
          {c.email && <span><Mail size={10} className="inline mr-1" />{c.email}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs" style={{ color: "#786C66" }}>{c.visits} visita{c.visits === 1 ? "" : "s"}</div>
        {c.totalSpent > 0 && <div className="text-sm" style={{ color: "#2B2024", fontWeight: 500 }}>{fmtMoney(c.totalSpent)}</div>}
        {c.lastVisit && <div className="text-[10px] italic" style={{ color: "#8A5A6E" }}>Últ: {c.lastVisit}</div>}
      </div>
      {c.activePkgs?.length > 0 && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#F4E7EB", color: "#8A4A2E" }}>📦 {c.activePkgs.length}</span>}
    </button>
  );
}

function ClientEditForm({ form, setForm, onSave, onCancel }: { form: ClientForm; setForm: Dispatch<SetStateAction<ClientForm | null>>; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="border p-5 mb-6" style={{ borderColor: "#8A5A6E", backgroundColor: "#FFFFFF" }}>
      <div className="text-xs tracking-[0.25em] mb-4" style={{ color: "#8A5A6E" }}>{form.id ? "EDITAR CLIENTE" : "NUEVO CLIENTE"}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Nombre completo *</label>
          <input type="text" value={form.name || ""} onChange={e => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Teléfono / WhatsApp</label>
          <input type="tel" value={form.phone || ""} onChange={e => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="809-555-1234" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Correo</label>
          <input type="email" value={form.email || ""} onChange={e => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Cumpleaños</label>
          <input type="date" value={form.birthday || ""} onChange={e => setForm((f) => ({ ...f, birthday: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Dirección</label>
          <input type="text" value={form.address || ""} onChange={e => setForm((f) => ({ ...f, address: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs tracking-[0.2em] uppercase mb-1 flex items-center gap-1" style={{ color: "#C53A2D" }}><AlertTriangle size={11} /> Alergias / Condiciones médicas</label>
          <textarea value={form.allergies || ""} onChange={e => setForm((f) => ({ ...f, allergies: e.target.value }))} rows={2} placeholder="Ej. Embarazo, alergia a..., medicamentos actuales" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#786C66" }}>Notas generales</label>
          <textarea value={form.notes || ""} onChange={e => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Preferencias, observaciones..." className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onSave} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#2B2024", color: "#FBF8F6" }}>Guardar</button>
        <button onClick={onCancel} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#2B2024", color: "#2B2024" }}>Cancelar</button>
      </div>
    </div>
  );
}

function ClientDetail({ client, setCustomers, invoices, packages, appointments, appointmentNotes, setAppointmentNotes, onBack, isAdmin }: { client: Customer; setCustomers: Dispatch<SetStateAction<Customer[]>>; invoices: Invoice[]; packages: CustomerPackage[]; appointments: ApptRow[]; appointmentNotes: NotesMap; setAppointmentNotes: Dispatch<SetStateAction<NotesMap>>; onBack: () => void; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ClientForm | null>({ ...client });
  const [tab, setTab] = useState<"history" | "invoices" | "packages">("history");

  const allAppts = useMemo(() =>
    appointments
      .filter((apt) => apt.client?.toLowerCase().trim() === client.name?.toLowerCase().trim())
      .sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""))),
    [appointments, client.name]
  );

  const clientInvoices = invoices.filter((i) => i.customer_id === client.id).sort((a, b) => (b.invoice_number || 0) - (a.invoice_number || 0));
  const clientPackages = packages.filter((p) => p.customer_id === client.id);
  const totalSpent = clientInvoices.filter((i) => i.status !== "voided").reduce((s: number, i) => s + Number(i.total || 0), 0);

  const saveEdit = async () => {
    try {
      const { error } = await trackSave(supabase.from("customers").update({
        name: editForm.name, phone: editForm.phone, email: editForm.email,
        birthday: editForm.birthday || null, address: editForm.address,
        notes: editForm.notes, allergies: editForm.allergies,
      }).eq("id", client.id));
      if (error) throw error;
      setCustomers((prev) => prev.map(c => c.id === client.id ? { ...c, ...editForm } : c));
      setEditing(false);
    } catch (e) { alert("Error: " + (e instanceof Error ? e.message : String(e))); }
  };

  const sendWA = (msg: string) => {
    const phone = (client.phone || "").replace(/\D/g, "");
    if (!phone) { alert("Sin teléfono."); return; }
    const url = `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  const upcomingAppt = allAppts.find((a) => a.date >= todayISO() && !a.cancelled && !a.no_show);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase mb-4" style={{ color: "#8A5A6E", fontFamily: "Lora, serif" }}>
        <ChevronLeft size={14} /> Volver a clientes
      </button>

      {editing ? (
        <ClientEditForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={() => { setEditing(false); setEditForm({ ...client }); }} />
      ) : (
        <div className="border p-6 mb-6" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF" }}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-medium flex-shrink-0" style={{ backgroundColor: "#F4E7EB", color: "#8A4A2E" }}>
              {(client.name || "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "32px", color: "#2B2024", fontWeight: 500, lineHeight: 1.1 }}>{client.name}</div>
              <div className="text-xs flex items-center gap-3 flex-wrap mt-2" style={{ color: "#786C66" }}>
                {client.phone && <span className="flex items-center gap-1"><Phone size={11} /> {client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail size={11} /> {client.email}</span>}
                {client.birthday && <span className="flex items-center gap-1"><Cake size={11} /> {client.birthday}</span>}
              </div>
              {client.address && <div className="text-xs mt-1" style={{ color: "#8A5A6E" }}>{client.address}</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {client.phone && <button onClick={() => sendWA(`Hola ${client.name}, le saluda Charm Clínica Estética.`)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> WhatsApp</button>}
              {isAdmin && <button onClick={() => setEditing(true)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: "#2B2024", color: "#2B2024" }}><Edit2 size={12} /> Editar</button>}
            </div>
          </div>

          {client.allergies && (
            <div className="mt-4 p-3 border" style={{ borderColor: "#C53A2D", backgroundColor: "#FBEAEA" }}>
              <div className="text-xs flex items-center gap-1 mb-1" style={{ color: "#C53A2D", fontWeight: 600 }}><AlertTriangle size={12} /> ALERGIAS / CONDICIONES</div>
              <div className="text-sm" style={{ color: "#2B2024" }}>{client.allergies}</div>
            </div>
          )}
          {client.notes && (
            <div className="mt-4 p-3" style={{ backgroundColor: "#FBF8F6" }}>
              <div className="text-xs tracking-[0.2em] mb-1" style={{ color: "#8A5A6E" }}>NOTAS</div>
              <div className="text-sm italic" style={{ color: "#2B2024" }}>{client.notes}</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mt-6 pt-4 border-t" style={{ borderColor: "#E8E0DB" }}>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8A5A6E" }}>VISITAS</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#2B2024", fontWeight: 500, lineHeight: 1 }}>{allAppts.filter((a) => !a.cancelled && !a.no_show).length}</div>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8A5A6E" }}>GASTADO</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#2B2024", fontWeight: 500, lineHeight: 1 }}>{fmtMoney(totalSpent)}</div>
            </div>
            <div>
              <div className="text-xs tracking-[0.2em]" style={{ color: "#8A5A6E" }}>PAQUETES</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#2B2024", fontWeight: 500, lineHeight: 1 }}>{clientPackages.filter((p) => p.used_sessions < p.total_sessions).length}</div>
            </div>
          </div>

          {upcomingAppt && client.phone && (
            <div className="mt-4 pt-4 border-t flex items-center justify-between flex-wrap gap-2" style={{ borderColor: "#E8E0DB" }}>
              <div className="text-xs" style={{ color: "#8A5A6E" }}>Próxima cita: <span style={{ color: "#2B2024", fontWeight: 500 }}>{upcomingAppt.date} a las {upcomingAppt.time}</span></div>
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
          {allAppts.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>Sin historial.</div>}
          {allAppts.map((apt) => <AppointmentNoteRow key={apt.id} apt={apt} appointmentNotes={appointmentNotes} setAppointmentNotes={setAppointmentNotes} />)}
        </div>
      )}
      {tab === "invoices" && (
        <div className="space-y-2">
          {clientInvoices.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>Sin facturas.</div>}
          {clientInvoices.map((inv) => (
            <div key={inv.id} className="border p-4 flex items-center gap-3 flex-wrap" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF" }}>
              <div className="text-xs" style={{ color: "#8A5A6E" }}>#{inv.invoice_number}</div>
              <div className="text-xs" style={{ color: "#786C66" }}>{inv.date}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm" style={{ color: "#2B2024" }}>{(inv.invoice_items || []).map((i) => i.name).join(", ")}</div>
                <div className="text-xs" style={{ color: "#8A5A6E" }}>Vendido por {inv.sold_by}</div>
              </div>
              <div className="text-sm font-medium" style={{ color: "#2B2024" }}>{fmtMoney(inv.total)}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "packages" && (
        <div className="space-y-2">
          {clientPackages.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", color: "#786C66" }}>Sin paquetes.</div>}
          {clientPackages.map((p) => {
            const remaining = p.total_sessions - p.used_sessions;
            const isDone = remaining === 0;
            return (
              <div key={p.id} className="border p-4" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", borderLeft: `4px solid ${isDone ? "#8A5A6E" : "#3A8769"}` }}>
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
                  <div className="text-sm font-medium" style={{ color: "#2B2024" }}>{p.package_name}</div>
                  <div className="text-xs" style={{ color: "#8A5A6E" }}>Comprado: {p.purchased_date}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="h-2 w-full" style={{ backgroundColor: "#EFE7E2" }}>
                      <div style={{ width: `${(p.used_sessions / p.total_sessions) * 100}%`, height: "100%", backgroundColor: isDone ? "#8A5A6E" : "#3A8769" }} />
                    </div>
                  </div>
                  <div className="text-sm" style={{ color: "#2B2024" }}>
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

function AppointmentNoteRow({ apt, appointmentNotes, setAppointmentNotes }: { apt: ApptRow; appointmentNotes: NotesMap; setAppointmentNotes: Dispatch<SetStateAction<NotesMap>> }) {
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
      setAppointmentNotes((prev) => ({ ...prev, [apt.id]: { ...draft, appointment_id: apt.id } }));
      setEditing(false);
    } catch (e) { alert("Error: " + (e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="border p-4" style={{ borderColor: "#E8E0DB", backgroundColor: "#FFFFFF", borderLeft: `4px solid ${empColor}`, opacity: dimmed ? 0.6 : 1 }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color: "#2B2024" }}>{apt.date}</span>
          <span style={{ color: "#8A5A6E" }}>{apt.time}</span>
          {apt.employee && <span className="text-xs px-2 py-0.5" style={{ backgroundColor: empColor, color: "#FFFFFF" }}>{apt.employee}</span>}
          {apt.cabin && <span className="text-xs" style={{ color: "#8A5A6E" }}>· Cabina {apt.cabin}</span>}
          {apt.cancelled && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#8A5A6E", color: "white" }}>CANCELÓ</span>}
          {apt.no_show && <span className="text-[10px] px-2 py-0.5" style={{ backgroundColor: "#C53A2D", color: "white" }}>NO ASISTIÓ</span>}
        </div>
        {past && !dimmed && !editing && (
          <button onClick={() => { setDraft(note); setEditing(true); }} className="text-xs flex items-center gap-1" style={{ color: "#8A5A6E" }}>
            <Edit2 size={11} /> {note.observations || note.treatments ? "Editar notas" : "Agregar notas"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <input type="text" value={draft.treatments || ""} onChange={e => setDraft((d) => ({ ...d, treatments: e.target.value }))} placeholder="Tratamientos: Ej. Láser axilas + bigote" className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
          <textarea value={draft.observations || ""} onChange={e => setDraft((d) => ({ ...d, observations: e.target.value }))} rows={2} placeholder="Observaciones..." className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#E8E0DB", backgroundColor: "white" }} />
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#2B2024", color: "#FBF8F6" }}>Guardar</button>
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#2B2024", color: "#2B2024" }}>Cancelar</button>
          </div>
        </div>
      ) : (
        (note.treatments || note.observations) && (
          <div className="mt-2 space-y-1">
            {note.treatments && <div className="text-xs" style={{ color: "#2B2024" }}><span style={{ color: "#8A5A6E", fontWeight: 500 }}>Tratamientos:</span> {note.treatments}</div>}
            {note.observations && <div className="text-xs italic" style={{ color: "#786C66" }}>{note.observations}</div>}
          </div>
        )
      )}
    </div>
  );
}

function sendBirthdayWA(c: Customer) {
  const phone = (c.phone || "").replace(/\D/g, "");
  const msg = `¡Feliz cumpleaños ${c.name.split(" ")[0]}! 🎂✨ Todo el equipo de Charm Clínica Estética te desea un día maravilloso. Tenemos una sorpresa especial para ti. 💕`;
  const url = phone ? `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

function sendReactivationWA(c: Customer) {
  const phone = (c.phone || "").replace(/\D/g, "");
  const msg = `Hola ${c.name.split(" ")[0]}, le saluda Charm Clínica Estética. Hace tiempo que no la vemos por acá. Tenemos novedades y promociones que le pueden interesar. ¿Le gustaría agendar una cita?`;
  const url = phone ? `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}
