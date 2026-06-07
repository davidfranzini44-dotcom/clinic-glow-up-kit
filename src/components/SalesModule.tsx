import { useState, useMemo, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import {
  ShoppingBag, Plus, Search, Edit2, Trash2, X, Check, Tag, Package,
  Receipt, FileText, Wallet, Calculator, Banknote, CreditCard,
  TrendingUp, Camera, AlertTriangle, Save, FileSpreadsheet, Download,
  Copy, MessageCircle, DollarSign
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { fetchAll } from '@/lib/fetchAll';
import { trackSave } from '@/lib/saveSync';
import type { Tables } from '@/integrations/supabase/types';
import { useRoster } from '@/lib/roster';

type CatalogItem = Tables<'catalog_items'>;
type Customer = Tables<'customers'>;
type Invoice = Tables<'invoices'> & {
  invoice_items: Tables<'invoice_items'>[];
  invoice_payments: Tables<'invoice_payments'>[];
};
type CustomerPackage = Tables<'customer_packages'>;
type Expense = Tables<'expenses'>;
type CashClosureRow = Tables<'cash_closures'>;
type SalesProfile = { id: string; display_name: string | null; employee_name: string | null };
type CartItem = {
  tempId: string; catalogId: string; name: string; qty: number;
  unitPrice: number; total: number; isPackage: boolean; packageSessions: number | null;
};


const fmtMoney = (n) => {
  if (n === null || n === undefined || isNaN(n)) return 'RD$ 0.00';
  return `RD$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const dateLabelES = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
};

const dateLabelShortES = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return `${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]} ${d.getDate()}`;
};

const labelMethod = (m) => ({
  cash: 'Efectivo', transfer: 'Transferencia', azul: 'Azul Link', card_terminal: 'Tarjeta Terminal'
}[m] || m);

const SubNavBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="px-3 py-1.5 text-xs tracking-[0.15em] uppercase whitespace-nowrap"
    style={{ backgroundColor: active ? '#2B2024' : 'transparent', color: active ? '#FBF8F6' : '#2B2024', border: '1px solid #2B2024', opacity: active ? 1 : 0.65, fontFamily: 'Lora, serif' }}>
    {children}
  </button>
);

const Section = ({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <>
    <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
      <div>
        {subtitle && <div className="text-xs tracking-[0.3em]" style={{ color: '#8A5A6E' }}>{subtitle}</div>}
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 'clamp(28px, 5vw, 44px)', color: '#2B2024', fontWeight: 400, lineHeight: 1.1 }}>{title}</h2>
      </div>
      {action}
    </div>
    {children}
  </>
);

const Stat = ({ label, value, icon, color }: { label: ReactNode; value: ReactNode; icon?: ReactNode; color?: string }) => (
  <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF', borderLeft: `4px solid ${color}` }}>
    <div className="text-xs tracking-[0.2em] flex items-center gap-1" style={{ color: '#8A5A6E' }}>{icon} {String(label).toUpperCase()}</div>
    <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', fontWeight: 400, color, lineHeight: 1.1, marginTop: '4px' }}>{value}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SALES MODULE
// ═══════════════════════════════════════════════════════════════════════════
export default function SalesModule({ profile, isAdmin, cajaOnly = false }: { profile: SalesProfile; isAdmin: boolean; cajaOnly?: boolean }) {
  const [view, setView] = useState(cajaOnly ? 'expenses' : 'overview');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [packages, setPackages] = useState<CustomerPackage[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [closures, setClosures] = useState<CashClosureRow[]>([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, cu, i, p, e, cl] = await Promise.all([
          supabase.from('catalog_items').select('*').eq('active', true).order('name'),
          fetchAll<Customer>('customers'),
          fetchAll<Invoice>('invoices', '*, invoice_items(*), invoice_payments(*)', { column: 'invoice_number', ascending: false }),
          fetchAll<CustomerPackage>('customer_packages'),
          fetchAll<Expense>('expenses', '*', { column: 'created_at', ascending: false }),
          fetchAll<CashClosureRow>('cash_closures', '*', { column: 'date', ascending: false }),
        ]);
        setCatalog(c.data || []);
        setCustomers(cu || []);
        setInvoices(i || []);
        setPackages(p || []);
        setExpenses(e || []);
        setClosures(cl || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-xs tracking-[0.3em]" style={{ color: '#8A5A6E' }}>CARGANDO VENTAS…</div>;

  return (
    <>
      <div className="flex gap-2 mb-6 flex-wrap">
        {!cajaOnly && <SubNavBtn active={view === 'overview'} onClick={() => setView('overview')}>Resumen</SubNavBtn>}
        {isAdmin && !cajaOnly && <SubNavBtn active={view === 'new-sale'} onClick={() => setView('new-sale')}>Nueva Venta</SubNavBtn>}
        {!cajaOnly && <SubNavBtn active={view === 'invoices'} onClick={() => setView('invoices')}>Facturas</SubNavBtn>}
        {isAdmin && !cajaOnly && <SubNavBtn active={view === 'catalog'} onClick={() => setView('catalog')}>Catálogo</SubNavBtn>}
        {(isAdmin || cajaOnly) && <SubNavBtn active={view === 'expenses'} onClick={() => setView('expenses')}>Gastos</SubNavBtn>}
        {(isAdmin || cajaOnly) && <SubNavBtn active={view === 'closure'} onClick={() => setView('closure')}>Cierre Caja</SubNavBtn>}
      </div>

      {view === 'overview' && <Overview invoices={invoices} expenses={expenses} packages={packages} setView={setView} />}
      {view === 'new-sale' && isAdmin && <NewSale catalog={catalog} customers={customers} setCustomers={setCustomers} setInvoices={setInvoices} setPackages={setPackages} setView={setView} profile={profile} />}
      {view === 'invoices' && <InvoicesList invoices={invoices} packages={packages} profile={profile} isAdmin={isAdmin} />}
      {view === 'catalog' && isAdmin && <CatalogManager catalog={catalog} setCatalog={setCatalog} />}
      {view === 'expenses' && (isAdmin || cajaOnly) && <ExpensesManager expenses={expenses} setExpenses={setExpenses} />}
      {view === 'closure' && (isAdmin || cajaOnly) && <CashClosure invoices={invoices} expenses={expenses} closures={closures} setClosures={setClosures} profile={profile} />}
    </>
  );
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────
function Overview({ invoices, expenses, packages, setView }: { invoices: Invoice[]; expenses: Expense[]; packages: CustomerPackage[]; setView: (view: string) => void }) {
  const today = todayISO();
  const todayInvoices = invoices.filter(i => i.date === today && i.status !== 'voided');
  const todayExpenses = expenses.filter(e => e.date === today);
  const todayIncome = todayInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const todayExpensesTotal = todayExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const activePackages = packages.filter(p => p.active && p.used_sessions < p.total_sessions).length;

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dayIncome = invoices.filter(inv => inv.date === ds && inv.status !== 'voided').reduce((s, inv) => s + Number(inv.total || 0), 0);
    last7Days.push({ date: ds, income: dayIncome, label: dateLabelShortES(ds) });
  }
  const maxIncome = Math.max(1, ...last7Days.map(d => d.income));

  return (
    <Section title="Resumen de Ventas" subtitle="VENTAS · HOY">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Ingreso Hoy" value={fmtMoney(todayIncome)} icon={<TrendingUp size={14} />} color="#3A8769" />
        <Stat label="Facturas Hoy" value={todayInvoices.length} icon={<Receipt size={14} />} color="#2B2024" />
        <Stat label="Gastos Hoy" value={fmtMoney(todayExpensesTotal)} icon={<Wallet size={14} />} color="#C53A2D" />
        <Stat label="Paquetes Activos" value={activePackages} icon={<Package size={14} />} color="#8A5A6E" />
      </div>

      <div className="border p-5 mb-6" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        <div className="text-xs tracking-[0.25em] mb-4" style={{ color: '#8A5A6E' }}>INGRESOS ÚLTIMOS 7 DÍAS</div>
        <div className="flex items-end gap-2" style={{ minHeight: '160px' }}>
          {last7Days.map(d => (
            <div key={d.date} className="flex-1 flex flex-col items-center">
              <div className="text-[10px] mb-1" style={{ color: '#2B2024' }}>{d.income > 0 ? fmtMoney(d.income).replace('RD$', '').trim() : ''}</div>
              <div className="w-full" style={{ height: `${(d.income / maxIncome) * 120}px`, backgroundColor: '#8A5A6E', minHeight: d.income > 0 ? '4px' : '0' }} />
              <div className="text-[10px] mt-1 tracking-wide" style={{ color: '#786C66' }}>{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <ActionCard title="Nueva Venta" desc="Crear factura de servicio o producto" icon={<Plus size={20} />} onClick={() => setView('new-sale')} />
        <ActionCard title="Registrar Gasto" desc="Agregar un gasto del día" icon={<Receipt size={20} />} onClick={() => setView('expenses')} />
        <ActionCard title="Cierre de Caja" desc="Conteo nocturno y cuadre" icon={<Calculator size={20} />} onClick={() => setView('closure')} />
      </div>
    </Section>
  );
}

function ActionCard({ title, desc, icon, onClick }: { title: ReactNode; desc: ReactNode; icon?: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="border p-5 text-left hover:opacity-80 transition-opacity" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: '#8A5A6E' }}>{icon}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '22px', color: '#2B2024', fontWeight: 500 }}>{title}</div>
      <div className="text-xs mt-1" style={{ color: '#786C66' }}>{desc}</div>
    </button>
  );
}

// ─── CATALOG MANAGER ──────────────────────────────────────────────────────
function CatalogManager({ catalog, setCatalog }: { catalog: CatalogItem[]; setCatalog: Dispatch<SetStateAction<CatalogItem[]>> }) {
  const [form, setForm] = useState(null);

  const save = async () => {
    if (!form.name?.trim() || !form.price) { alert('Completa nombre y precio.'); return; }
    const item = {
      type: form.type, name: form.name.trim(),
      price: parseFloat(form.price),
      sessions: form.type === 'package' ? (parseInt(form.sessions) || 1) : 1,
      active: true,
    };
    try {
      if (form.id) {
        const { error } = await trackSave(supabase.from('catalog_items').update(item).eq('id', form.id));
        if (error) throw error;
        setCatalog(prev => prev.map(c => c.id === form.id ? { ...c, ...item } : c));
      } else {
        const { data, error } = await trackSave(supabase.from('catalog_items').insert(item).select().single());
        if (error) throw error;
        setCatalog(prev => [...prev, data]);
      }
      setForm(null);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const remove = async (id) => {
    if (!confirm('¿Eliminar este item?')) return;
    try {
      const { error } = await trackSave(supabase.from('catalog_items').update({ active: false }).eq('id', id));
      if (error) throw error;
      setCatalog(prev => prev.filter(c => c.id !== id));
    } catch (e) { alert('Error: ' + e.message); }
  };

  const grouped = { service: [], product: [], package: [] };
  catalog.forEach(c => grouped[c.type]?.push(c));

  return (
    <Section title="Catálogo" subtitle="PRODUCTOS · SERVICIOS · PAQUETES"
      action={<button onClick={() => setForm({ type: 'service', name: '', price: '', sessions: 1 })} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}><Plus size={14} /> Agregar</button>}>

      {form && (
        <div className="border p-5 mb-6" style={{ borderColor: '#8A5A6E', backgroundColor: '#FFFFFF' }}>
          <div className="text-xs tracking-[0.25em] mb-4" style={{ color: '#8A5A6E' }}>{form.id ? 'EDITAR' : 'NUEVO'} ITEM</div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#786C66' }}>Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }}>
                <option value="service">Servicio</option>
                <option value="product">Producto</option>
                <option value="package">Paquete (con sesiones)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#786C66' }}>Nombre</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            </div>
            <div>
              <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#786C66' }}>Precio (RD$)</label>
              <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            </div>
            {form.type === 'package' && (
              <div>
                <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#786C66' }}>Sesiones</label>
                <input type="number" value={form.sessions} onChange={e => setForm(f => ({ ...f, sessions: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}>Guardar</button>
            <button onClick={() => setForm(null)} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>Cancelar</button>
          </div>
        </div>
      )}

      {catalog.length === 0 && !form && (
        <div className="border p-12 text-center" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
          <Tag size={36} className="mx-auto mb-3" style={{ color: '#8A5A6E' }} strokeWidth={1.2} />
          <p className="text-sm" style={{ color: '#786C66' }}>Aún no hay items en el catálogo.</p>
        </div>
      )}

      {['service', 'product', 'package'].map(type => grouped[type].length > 0 && (
        <div key={type} className="mb-6">
          <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>
            {type === 'service' && 'SERVICIOS'}{type === 'product' && 'PRODUCTOS'}{type === 'package' && 'PAQUETES'}
          </div>
          <div className="border" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            {grouped[type].map((item, idx) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#EFE7E2', backgroundColor: idx % 2 === 0 ? 'transparent' : '#FBF8F6' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: '#2B2024' }}>{item.name}</div>
                  {item.type === 'package' && <div className="text-xs italic" style={{ color: '#8A5A6E' }}>{item.sessions} sesión{item.sessions === 1 ? '' : 'es'}</div>}
                </div>
                <div className="text-sm font-medium" style={{ color: '#2B2024', minWidth: '110px', textAlign: 'right' }}>{fmtMoney(item.price)}</div>
                <button onClick={() => setForm(item)} className="p-2"><Edit2 size={14} style={{ color: '#2B2024' }} /></button>
                <button onClick={() => remove(item.id)} className="p-2"><Trash2 size={14} style={{ color: '#C53A2D' }} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ─── NEW SALE ─────────────────────────────────────────────────────────────
function NewSale({ catalog, customers, setCustomers, setInvoices, setPackages, setView, profile }: { catalog: CatalogItem[]; customers: Customer[]; setCustomers: Dispatch<SetStateAction<Customer[]>>; setInvoices: Dispatch<SetStateAction<Invoice[]>>; setPackages: Dispatch<SetStateAction<CustomerPackage[]>>; setView: (view: string) => void; profile: SalesProfile }) {
  const { employees: rosterEmployees } = useRoster();
  const empNames = rosterEmployees.map((e) => e.name);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [items, setItems] = useState<CartItem[]>([]);
  const [soldBy, setSoldBy] = useState(profile?.employee_name || 'Lisa');
  const [payments, setPayments] = useState([{ method: 'cash', amount: '' }]);
  const [notes, setNotes] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [showSugg, setShowSugg] = useState(false);

  const filteredCustomers = customers.filter(c =>
    c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || '').includes(customerSearch)
  ).slice(0, 5);

  const filteredCatalog = catalog.filter(c => c.name.toLowerCase().includes(itemSearch.toLowerCase()));

  const addItem = (catItem) => {
    setItems(prev => [...prev, {
      tempId: `item-${Date.now()}-${Math.random()}`,
      catalogId: catItem.id, name: catItem.name, qty: 1,
      unitPrice: catItem.price, total: catItem.price,
      isPackage: catItem.type === 'package', packageSessions: catItem.sessions,
    }]);
    setItemSearch('');
  };

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const remaining = subtotal - totalPaid;

  const completeSale = async () => {
    if (!customer.name.trim()) { alert('Falta nombre.'); return; }
    if (items.length === 0) { alert('Agrega items.'); return; }
    if (totalPaid < subtotal - 0.01) { alert(`Falta ${fmtMoney(remaining)}.`); return; }

    try {
      // Find or create customer
      let customerId;
      const existing = customers.find(c => c.name?.toLowerCase().trim() === customer.name.trim().toLowerCase());
      if (existing) {
        customerId = existing.id;
      } else {
        const { data, error } = await trackSave(supabase.from('customers').insert({
          name: customer.name.trim(), phone: customer.phone, email: customer.email, source: 'sale',
        }).select().single());
        if (error) throw error;
        customerId = data.id;
        setCustomers(prev => [...prev, data]);
      }

      // Create invoice
      const { data: inv, error: invError } = await trackSave(supabase.from('invoices').insert({
        customer_id: customerId, customer_name: customer.name.trim(),
        customer_phone: customer.phone, customer_email: customer.email,
        sold_by: soldBy, subtotal, total: subtotal, notes,
        date: todayISO(),
      }).select().single());
      if (invError) throw invError;

      // Create items
      const itemsToInsert = items.map(i => ({
        invoice_id: inv.id, catalog_item_id: i.catalogId, name: i.name,
        quantity: i.qty, unit_price: i.unitPrice, total: i.total,
        is_package: i.isPackage, package_sessions: i.isPackage ? i.packageSessions : null,
      }));
      const { data: insertedItems, error: itemsError } = await trackSave(supabase.from('invoice_items').insert(itemsToInsert).select());
      if (itemsError) throw itemsError;

      // Create payments
      const paymentsToInsert = payments.filter(p => parseFloat(p.amount) > 0).map(p => ({
        invoice_id: inv.id, method: p.method, amount: parseFloat(p.amount),
      }));
      const { error: payError } = await trackSave(supabase.from('invoice_payments').insert(paymentsToInsert));
      if (payError) throw payError;

      // Create packages
      const newPackages = [];
      for (const item of items.filter(i => i.isPackage)) {
        const insertedItem = insertedItems.find(ii => ii.name === item.name);
        const { data: pkg, error: pkgError } = await trackSave(supabase.from('customer_packages').insert({
          customer_id: customerId, invoice_item_id: insertedItem?.id,
          package_name: item.name,
          total_sessions: item.packageSessions * item.qty,
          used_sessions: 0, active: true,
          purchased_date: todayISO(),
        }).select().single());
        if (!pkgError && pkg) newPackages.push(pkg);
      }

      // Refresh full invoice
      const { data: fullInv } = await supabase.from('invoices').select('*, invoice_items(*), invoice_payments(*)').eq('id', inv.id).single();
      setInvoices(prev => [fullInv, ...prev]);
      setPackages(prev => [...prev, ...newPackages]);

      // Show PDF
      showInvoicePdf({
        ...fullInv,
        items: fullInv.invoice_items,
        payments: fullInv.invoice_payments,
      });

      // Reset & navigate
      setCustomer({ name: '', phone: '', email: '' });
      setCustomerSearch(''); setItems([]);
      setPayments([{ method: 'cash', amount: '' }]); setNotes('');
      setView('invoices');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  return (
    <Section title="Nueva Venta" subtitle="REGISTRAR FACTURA">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          {/* Customer */}
          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>CLIENTE</div>
            <div className="relative mb-3">
              <input type="text" value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setCustomer(c => ({ ...c, name: e.target.value })); setShowSugg(true); }}
                onFocus={() => setShowSugg(true)}
                onBlur={() => setTimeout(() => setShowSugg(false), 200)}
                placeholder="Buscar o crear cliente…" className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              {showSugg && filteredCustomers.length > 0 && customerSearch && (
                <div className="absolute z-20 w-full mt-1 border max-h-48 overflow-y-auto" style={{ borderColor: '#8A5A6E', backgroundColor: 'white' }}>
                  {filteredCustomers.map(c => (
                    <button key={c.id} onClick={() => { setCustomer({ name: c.name, phone: c.phone || '', email: c.email || '' }); setCustomerSearch(c.name); setShowSugg(false); }} className="w-full text-left px-3 py-2 text-sm border-b" style={{ borderColor: '#EFE7E2' }}>
                      <div style={{ color: '#2B2024' }}>{c.name}</div>
                      {c.phone && <div className="text-xs" style={{ color: '#8A5A6E' }}>{c.phone}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="tel" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} placeholder="Teléfono" className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              <input type="email" value={customer.email} onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))} placeholder="Correo (opcional)" className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            </div>
          </div>

          {/* Items */}
          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>PRODUCTOS Y SERVICIOS</div>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8A5A6E' }} />
              <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                placeholder={catalog.length === 0 ? 'Agrega items al catálogo primero' : 'Buscar en catálogo…'}
                disabled={catalog.length === 0}
                className="w-full pl-9 pr-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              {itemSearch && filteredCatalog.length > 0 && (
                <div className="absolute z-20 w-full mt-1 border max-h-48 overflow-y-auto" style={{ borderColor: '#8A5A6E', backgroundColor: 'white' }}>
                  {filteredCatalog.map(c => (
                    <button key={c.id} onClick={() => addItem(c)} className="w-full text-left px-3 py-2 text-sm border-b flex justify-between" style={{ borderColor: '#EFE7E2' }}>
                      <div>
                        <div style={{ color: '#2B2024' }}>{c.name}</div>
                        {c.type === 'package' && <div className="text-xs" style={{ color: '#8A5A6E' }}>📦 {c.sessions} sesiones</div>}
                      </div>
                      <div style={{ color: '#2B2024', fontWeight: 500 }}>{fmtMoney(c.price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {items.length === 0 && <div className="text-xs italic text-center py-4" style={{ color: '#8A5A6E' }}>Aún no hay items.</div>}
            {items.map(item => (
              <div key={item.tempId} className="flex items-center gap-2 py-2 border-b" style={{ borderColor: '#EFE7E2' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: '#2B2024' }}>{item.name}</div>
                  {item.isPackage && <div className="text-[10px]" style={{ color: '#8A5A6E' }}>📦 {item.packageSessions} ses. × {item.qty}</div>}
                </div>
                <input type="number" value={item.qty} min="1" onChange={e => {
                  const q = Math.max(1, parseInt(e.target.value) || 1);
                  setItems(prev => prev.map(i => i.tempId === item.tempId ? { ...i, qty: q, total: q * i.unitPrice } : i));
                }} className="w-14 px-2 py-1 border text-sm text-center" style={{ borderColor: '#E8E0DB' }} />
                <div className="w-24 text-right text-sm" style={{ color: '#2B2024' }}>{fmtMoney(item.total)}</div>
                <button onClick={() => setItems(prev => prev.filter(i => i.tempId !== item.tempId))} className="p-1"><X size={14} style={{ color: '#C53A2D' }} /></button>
              </div>
            ))}
          </div>

          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-2" style={{ color: '#8A5A6E' }}>NOTAS (OPCIONAL)</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>VENDIDO POR</div>
            <select value={soldBy} onChange={e => setSoldBy(e.target.value)} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }}>
              {empNames.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>TOTAL</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '40px', color: '#2B2024', fontWeight: 400, lineHeight: 1 }}>{fmtMoney(subtotal)}</div>
          </div>

          <div className="border p-4" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs tracking-[0.25em]" style={{ color: '#8A5A6E' }}>PAGOS</div>
              <button onClick={() => setPayments(p => [...p, { method: 'cash', amount: '' }])} className="text-xs flex items-center gap-1" style={{ color: '#2B2024' }}><Plus size={12} /> Agregar</button>
            </div>
            {payments.map((p, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select value={p.method} onChange={e => setPayments(prev => prev.map((x, i) => i === idx ? { ...x, method: e.target.value } : x))} className="px-2 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }}>
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                  <option value="azul">Azul Link</option>
                  <option value="card_terminal">Terminal Tarjeta</option>
                </select>
                <input type="number" value={p.amount} onChange={e => setPayments(prev => prev.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} placeholder="0.00" className="flex-1 px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
                {payments.length > 1 && <button onClick={() => setPayments(prev => prev.filter((_, i) => i !== idx))} className="p-2"><X size={14} style={{ color: '#C53A2D' }} /></button>}
              </div>
            ))}
            <div className="text-xs flex justify-between mt-3 pt-2 border-t" style={{ borderColor: '#EFE7E2' }}>
              <span style={{ color: '#786C66' }}>Pagado:</span>
              <span style={{ color: totalPaid >= subtotal - 0.01 ? '#3A8769' : '#C53A2D', fontWeight: 500 }}>{fmtMoney(totalPaid)}</span>
            </div>
            {Math.abs(remaining) > 0.01 && (
              <div className="text-xs flex justify-between mt-1">
                <span style={{ color: '#786C66' }}>{remaining > 0 ? 'Falta:' : 'Sobra:'}</span>
                <span style={{ color: '#C53A2D', fontWeight: 500 }}>{fmtMoney(Math.abs(remaining))}</span>
              </div>
            )}
          </div>

          <button onClick={completeSale} disabled={items.length === 0} className="w-full px-5 py-4 text-xs tracking-[0.25em] uppercase flex items-center justify-center gap-2" style={{ backgroundColor: items.length === 0 ? '#E8E0DB' : '#2B2024', color: '#FBF8F6', cursor: items.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Check size={16} /> Completar Venta
          </button>
        </div>
      </div>
    </Section>
  );
}

// ─── INVOICES LIST ────────────────────────────────────────────────────────
function InvoicesList({ invoices, packages, profile, isAdmin }: { invoices: Invoice[]; packages: CustomerPackage[]; profile: SalesProfile; isAdmin: boolean }) {
  const [search, setSearch] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [selected, setSelected] = useState(null);

  const myEmployee = profile?.employee_name;

  const filtered = invoices
    .filter(i => isAdmin || i.sold_by === myEmployee)
    .filter(i => !search || i.customer_name?.toLowerCase().includes(search.toLowerCase()) || String(i.invoice_number).includes(search))
    .filter(i => !filterFrom || i.date >= filterFrom)
    .filter(i => !filterTo || i.date <= filterTo);

  const exportInvoices = () => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [['#', 'Fecha', 'Cliente', 'Teléfono', 'Vendedor', 'Total', 'Estado']];
    filtered.forEach(i => rows.push([i.invoice_number, i.date, i.customer_name, i.customer_phone || '', i.sold_by, i.total, i.status]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
    XLSX.writeFile(wb, `FACTURAS_CHARM_${todayISO()}.xlsx`);
  };

  return (
    <Section title="Facturas" subtitle="HISTORIAL DE VENTAS"
      action={<button onClick={exportInvoices} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}><Download size={14} /> Exportar</button>}>

      <div className="border p-4 mb-6" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8A5A6E' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="w-full pl-9 pr-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
          </div>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
        </div>
      </div>

      {filtered.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF', color: '#786C66' }}>No hay facturas.</div>}

      <div className="border" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        {filtered.map((inv, idx) => (
          <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#EFE7E2', backgroundColor: idx % 2 === 0 ? 'transparent' : '#FBF8F6' }}>
            <div className="text-xs" style={{ color: '#8A5A6E', minWidth: '50px' }}>#{inv.invoice_number}</div>
            <div className="text-xs" style={{ color: '#786C66', minWidth: '90px' }}>{inv.date}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate" style={{ color: '#2B2024' }}>{inv.customer_name}</div>
              <div className="text-xs" style={{ color: '#8A5A6E' }}>{inv.sold_by} · {(inv.invoice_items || []).length} item{(inv.invoice_items || []).length === 1 ? '' : 's'}</div>
            </div>
            <div className="text-sm font-medium" style={{ color: '#2B2024' }}>{fmtMoney(inv.total)}</div>
            <button onClick={() => setSelected(inv)} className="px-3 py-1 text-xs tracking-[0.15em] uppercase border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>Ver</button>
          </div>
        ))}
      </div>

      {selected && <InvoiceDetail invoice={selected} packages={packages} onClose={() => setSelected(null)} />}
    </Section>
  );
}

function InvoiceDetail({ invoice, packages, onClose }: { invoice: Invoice; packages: CustomerPackage[]; onClose: () => void }) {
  const items = invoice.invoice_items || [];
  const pays = invoice.invoice_payments || [];
  const pkgs = packages.filter(p => items.some(i => i.id === p.invoice_item_id));

  const downloadPdf = () => showInvoicePdf({ ...invoice, items, payments: pays });
  const sendWhatsApp = () => {
    const msg = `Hola ${invoice.customer_name}, aquí su factura #${String(invoice.invoice_number).padStart(5, '0')} de Charm Clínica Estética.\nTotal: ${fmtMoney(invoice.total)}\n¡Gracias!`;
    const phone = (invoice.customer_phone || '').replace(/\D/g, '');
    const url = phone ? `https://wa.me/${phone.startsWith('1') ? phone : '1' + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(62, 42, 26, 0.6)' }}>
      <div onClick={e => e.stopPropagation()} className="max-w-2xl w-full max-h-[90vh] overflow-y-auto" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E8E0DB' }}>
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="text-xs tracking-[0.3em]" style={{ color: '#8A5A6E' }}>FACTURA</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '36px', color: '#2B2024', fontWeight: 400, lineHeight: 1 }}>#{String(invoice.invoice_number).padStart(5, '0')}</div>
              <div className="text-xs mt-1" style={{ color: '#786C66' }}>{invoice.date} · Vendida por {invoice.sold_by}</div>
            </div>
            <button onClick={onClose} className="p-1"><X size={20} style={{ color: '#2B2024' }} /></button>
          </div>

          <div className="mb-6 pb-4 border-b" style={{ borderColor: '#E8E0DB' }}>
            <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: '#8A5A6E' }}>Cliente</div>
            <div className="text-sm font-medium" style={{ color: '#2B2024' }}>{invoice.customer_name}</div>
            {invoice.customer_phone && <div className="text-xs" style={{ color: '#786C66' }}>{invoice.customer_phone}</div>}
            {invoice.customer_email && <div className="text-xs" style={{ color: '#786C66' }}>{invoice.customer_email}</div>}
          </div>

          <div className="mb-6">
            <div className="text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: '#8A5A6E' }}>Detalle</div>
            {items.map(item => (
              <div key={item.id} className="flex items-baseline justify-between py-2 border-b" style={{ borderColor: '#EFE7E2' }}>
                <div className="flex-1">
                  <div className="text-sm" style={{ color: '#2B2024' }}>{item.name} {item.quantity > 1 && `× ${item.quantity}`}</div>
                  {item.is_package && <div className="text-[10px]" style={{ color: '#8A5A6E' }}>📦 Paquete con {item.package_sessions} sesiones</div>}
                </div>
                <div className="text-sm" style={{ color: '#2B2024' }}>{fmtMoney(item.total)}</div>
              </div>
            ))}
            <div className="flex items-baseline justify-between py-3 mt-2 border-t-2" style={{ borderColor: '#2B2024' }}>
              <div className="text-sm tracking-[0.2em] uppercase" style={{ color: '#2B2024' }}>Total</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '32px', color: '#2B2024', fontWeight: 500, lineHeight: 1 }}>{fmtMoney(invoice.total)}</div>
            </div>
          </div>

          <div className="mb-6">
            <div className="text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: '#8A5A6E' }}>Pagos</div>
            {pays.map((p, idx) => (
              <div key={idx} className="flex justify-between text-sm py-1">
                <span style={{ color: '#786C66' }}>{labelMethod(p.method)}</span>
                <span style={{ color: '#2B2024' }}>{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>

          {pkgs.length > 0 && (
            <div className="mb-6 p-3 border" style={{ borderColor: '#8A5A6E', backgroundColor: '#FBF8F6' }}>
              <div className="text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: '#8A5A6E' }}>📦 Paquetes Activos</div>
              {pkgs.map(p => (
                <div key={p.id} className="text-xs flex justify-between" style={{ color: '#2B2024' }}>
                  <span>{p.package_name}</span>
                  <span>{p.total_sessions - p.used_sessions} de {p.total_sessions} disponibles</span>
                </div>
              ))}
            </div>
          )}

          {invoice.notes && <div className="mb-6 text-xs italic" style={{ color: '#786C66' }}>"{invoice.notes}"</div>}

          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadPdf} className="flex-1 px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center justify-center gap-2" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}>
              <FileText size={14} /> Ver PDF
            </button>
            <button onClick={sendWhatsApp} className="flex-1 px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center justify-center gap-2 border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>
              <MessageCircle size={14} /> WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// PDF generator (printable HTML)
function showInvoicePdf(invoice) {
  const items = invoice.items || [];
  const payments = invoice.payments || [];
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Factura #${invoice.invoice_number}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Lora:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Lora',serif;color:#2B2024;padding:40px;max-width:700px;margin:0 auto;background:white}
.header{text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:2px solid #2B2024}
.brand{font-family:'Cormorant Garamond',serif;font-size:48px;font-weight:300}
.tag{font-size:10px;letter-spacing:0.4em;color:#8A5A6E;margin-top:4px}
.meta{display:flex;justify-content:space-between;margin:30px 0 20px}
.meta-block{font-size:12px}
.meta-label{font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:#8A5A6E;margin-bottom:4px}
.invoice-num{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:500}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#8A5A6E;padding:8px 4px;border-bottom:1px solid #E8E0DB;text-align:left}
th:last-child,td:last-child{text-align:right}
td{padding:12px 4px;border-bottom:1px solid #EFE7E2;font-size:13px}
.total-row td{border-top:2px solid #2B2024;border-bottom:none;font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:500;padding-top:16px}
.payments{margin-top:30px;padding-top:20px;border-top:1px solid #E8E0DB}
.payment-row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0}
.footer{text-align:center;margin-top:50px;padding-top:20px;border-top:1px solid #E8E0DB;font-size:10px;color:#8A5A6E;letter-spacing:0.2em}
@media print{body{padding:20px}}
</style></head><body>
<div class="header"><div class="brand">Charm</div><div class="tag">CLÍNICA ESTÉTICA</div></div>
<div class="meta">
  <div class="meta-block">
    <div class="meta-label">Factura para</div>
    <div style="font-weight:500;font-size:14px">${invoice.customer_name}</div>
    ${invoice.customer_phone ? `<div style="font-size:11px;color:#786C66">${invoice.customer_phone}</div>` : ''}
    ${invoice.customer_email ? `<div style="font-size:11px;color:#786C66">${invoice.customer_email}</div>` : ''}
  </div>
  <div class="meta-block" style="text-align:right">
    <div class="meta-label">Factura N°</div>
    <div class="invoice-num">#${String(invoice.invoice_number).padStart(5, '0')}</div>
    <div style="font-size:11px;color:#786C66;margin-top:4px">${invoice.date}</div>
    <div style="font-size:11px;color:#786C66">Vendida por ${invoice.sold_by}</div>
  </div>
</div>
<table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>
${items.map(i => `<tr><td>${i.name}${i.is_package ? `<div style="font-size:10px;color:#8A5A6E;font-style:italic">📦 Paquete con ${i.package_sessions} sesiones</div>` : ''}</td><td>${i.quantity}</td><td>${fmtMoney(i.unit_price)}</td><td>${fmtMoney(i.total)}</td></tr>`).join('')}
<tr class="total-row"><td colspan="3">TOTAL</td><td>${fmtMoney(invoice.total)}</td></tr>
</tbody></table>
<div class="payments">
  <div class="meta-label" style="margin-bottom:8px">Métodos de pago</div>
  ${payments.map(p => `<div class="payment-row"><span>${labelMethod(p.method)}</span><span>${fmtMoney(p.amount)}</span></div>`).join('')}
</div>
${invoice.notes ? `<div style="margin-top:30px;font-size:11px;font-style:italic;color:#786C66">Notas: ${invoice.notes}</div>` : ''}
<div class="footer">CHARM CLÍNICA ESTÉTICA · GRACIAS POR SU PREFERENCIA</div>
<script>setTimeout(()=>window.print(),500)</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Permite ventanas emergentes.');
}

// ─── EXPENSES ─────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = ['Suministros','Servicios','Mantenimiento','Personal','Marketing','Otros'];

function ExpensesManager({ expenses, setExpenses }: { expenses: Expense[]; setExpenses: Dispatch<SetStateAction<Expense[]>> }) {
  const [form, setForm] = useState(null);
  const [filterDate, setFilterDate] = useState(todayISO());

  const filtered = expenses.filter(e => !filterDate || e.date === filterDate);
  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, receipt_url: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.description?.trim() || !form.amount) { alert('Completa descripción y monto.'); return; }
    const exp = {
      date: form.date, category: form.category,
      description: form.description.trim(), amount: parseFloat(form.amount),
      receipt_url: form.receipt_url || null,
    };
    try {
      if (form.id) {
        const { error } = await trackSave(supabase.from('expenses').update(exp).eq('id', form.id));
        if (error) throw error;
        setExpenses(prev => prev.map(e => e.id === form.id ? { ...e, ...exp } : e));
      } else {
        const { data, error } = await trackSave(supabase.from('expenses').insert(exp).select().single());
        if (error) throw error;
        setExpenses(prev => [data, ...prev]);
      }
      setForm(null);
    } catch (e) { alert('Error: ' + e.message); }
  };

  const remove = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
      const { error } = await trackSave(supabase.from('expenses').delete().eq('id', id));
      if (error) throw error;
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch (e) { alert('Error: ' + e.message); }
  };

  const exportExpenses = () => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [['Fecha', 'Categoría', 'Descripción', 'Monto']];
    filtered.forEach(e => rows.push([e.date, e.category, e.description, e.amount]));
    rows.push([]);
    rows.push(['', '', 'TOTAL', total]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
    XLSX.writeFile(wb, `GASTOS_CHARM_${filterDate || 'todos'}.xlsx`);
  };

  return (
    <Section title="Gastos" subtitle="REGISTRO DE GASTOS"
      action={
        <div className="flex gap-2">
          <button onClick={exportExpenses} className="px-4 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: '#2B2024', color: '#2B2024' }}><Download size={14} /> Exportar</button>
          <button onClick={() => setForm({ date: todayISO(), category: 'Suministros', description: '', amount: '', receipt_url: '' })} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}><Plus size={14} /> Nuevo</button>
        </div>
      }>

      <div className="border p-4 mb-6 flex items-center justify-between flex-wrap gap-3" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>FECHA:</span>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
          <button onClick={() => setFilterDate('')} className="text-xs underline" style={{ color: '#8A5A6E' }}>Ver todos</button>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>TOTAL:</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: '#C53A2D', fontWeight: 500 }}>{fmtMoney(total)}</span>
        </div>
      </div>

      {form && (
        <div className="border p-5 mb-6" style={{ borderColor: '#8A5A6E', backgroundColor: '#FFFFFF' }}>
          <div className="text-xs tracking-[0.25em] mb-4" style={{ color: '#8A5A6E' }}>{form.id ? 'EDITAR' : 'NUEVO'} GASTO</div>
          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción" className="md:col-span-2 px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Monto" className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <input type="file" accept="image/*" onChange={handlePhoto} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: '100px' }} />
              <span className="block w-full px-3 py-2 border text-sm flex items-center gap-2 pointer-events-none" style={{ borderColor: '#E8E0DB', backgroundColor: 'white', color: '#786C66' }}>
                <Camera size={14} /> {form.receipt_url ? '✓ Foto cargada' : 'Foto recibo'}
              </span>
            </div>
          </div>
          {form.receipt_url && <img src={form.receipt_url} alt="Recibo" className="max-h-40 mb-3 border" style={{ borderColor: '#E8E0DB' }} />}
          <div className="flex gap-2">
            <button onClick={save} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}>Guardar</button>
            <button onClick={() => setForm(null)} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>Cancelar</button>
          </div>
        </div>
      )}

      {filtered.length === 0 && <div className="border p-12 text-center text-sm italic" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF', color: '#786C66' }}>No hay gastos.</div>}

      <div className="border" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        {filtered.map((e, idx) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#EFE7E2', backgroundColor: idx % 2 === 0 ? 'transparent' : '#FBF8F6' }}>
            <div className="text-xs px-2 py-1" style={{ backgroundColor: '#F4E7EB', color: '#8A4A2E', minWidth: '90px', textAlign: 'center' }}>{e.category}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm" style={{ color: '#2B2024' }}>{e.description}</div>
              <div className="text-xs" style={{ color: '#8A5A6E' }}>{e.date}</div>
            </div>
            {e.receipt_url && <img src={e.receipt_url} alt="Recibo" className="h-10 border" style={{ borderColor: '#E8E0DB' }} />}
            <div className="text-sm font-medium" style={{ color: '#C53A2D' }}>{fmtMoney(e.amount)}</div>
            <button onClick={() => remove(e.id)} className="p-1"><Trash2 size={14} style={{ color: '#C53A2D' }} /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── CASH CLOSURE ─────────────────────────────────────────────────────────
const DENOMINATIONS = [
  { key: 'bills_2000', label: 'RD$ 2,000', value: 2000 },
  { key: 'bills_1000', label: 'RD$ 1,000', value: 1000 },
  { key: 'bills_500', label: 'RD$ 500', value: 500 },
  { key: 'bills_200', label: 'RD$ 200', value: 200 },
  { key: 'bills_100', label: 'RD$ 100', value: 100 },
  { key: 'bills_50', label: 'RD$ 50', value: 50 },
  { key: 'coins_25', label: 'RD$ 25', value: 25 },
  { key: 'coins_10', label: 'RD$ 10', value: 10 },
  { key: 'coins_5', label: 'RD$ 5', value: 5 },
  { key: 'coins_1', label: 'RD$ 1', value: 1 },
];

function CashClosure({ invoices, expenses, closures, setClosures, profile }: { invoices: Invoice[]; expenses: Expense[]; closures: CashClosureRow[]; setClosures: Dispatch<SetStateAction<CashClosureRow[]>>; profile: SalesProfile }) {
  const [closureDate, setClosureDate] = useState(todayISO());
  const [counts, setCounts] = useState(Object.fromEntries(DENOMINATIONS.map(d => [d.key, ''])));
  const [transfers, setTransfers] = useState('');
  const [azul, setAzul] = useState('');
  const [cardTerminal, setCardTerminal] = useState('');
  const [notes, setNotes] = useState('');

  const existingClosure = closures.find(c => c.date === closureDate);

  useEffect(() => {
    if (existingClosure) {
      setCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.key, String(existingClosure[d.key] || '')])));
      setTransfers(String(existingClosure.transfers_counted || ''));
      setAzul(String(existingClosure.azul_counted || ''));
      setCardTerminal(String(existingClosure.card_terminal_counted || ''));
      setNotes(existingClosure.notes || '');
    } else {
      setCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.key, ''])));
      setTransfers(''); setAzul(''); setCardTerminal(''); setNotes('');
    }
  }, [closureDate, existingClosure]);

  const dayInvoices = invoices.filter(i => i.date === closureDate && i.status !== 'voided');
  const dayExpenses = expenses.filter(e => e.date === closureDate);
  const systemTotals = { cash: 0, transfer: 0, azul: 0, card_terminal: 0 };
  dayInvoices.forEach(i => (i.invoice_payments || []).forEach(p => {
    systemTotals[p.method] = (systemTotals[p.method] || 0) + Number(p.amount || 0);
  }));

  const cashCounted = DENOMINATIONS.reduce((s, d) => s + (parseFloat(counts[d.key]) || 0) * d.value, 0);
  const transfersCounted = parseFloat(transfers) || 0;
  const azulCounted = parseFloat(azul) || 0;
  const cardTerminalCounted = parseFloat(cardTerminal) || 0;
  const totalCounted = cashCounted + transfersCounted + azulCounted + cardTerminalCounted;
  const totalSystem = systemTotals.cash + systemTotals.transfer + systemTotals.azul + systemTotals.card_terminal;
  const cashDiff = cashCounted - systemTotals.cash;
  const totalExpenses = dayExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const netTotal = totalSystem - totalExpenses;

  const saveClosure = async () => {
    const closure = {
      date: closureDate,
      ...Object.fromEntries(DENOMINATIONS.map(d => [d.key, parseInt(counts[d.key]) || 0])),
      cash_counted: cashCounted, transfers_counted: transfersCounted,
      azul_counted: azulCounted, card_terminal_counted: cardTerminalCounted,
      cash_system: systemTotals.cash, transfers_system: systemTotals.transfer,
      azul_system: systemTotals.azul, card_terminal_system: systemTotals.card_terminal,
      cash_difference: cashDiff, total_income: totalSystem,
      total_expenses: totalExpenses, net_total: netTotal,
      notes, closed_by: profile?.employee_name || 'admin',
    };
    try {
      if (existingClosure) {
        const { error } = await trackSave(supabase.from('cash_closures').update(closure).eq('id', existingClosure.id));
        if (error) throw error;
        setClosures(prev => prev.map(c => c.id === existingClosure.id ? { ...c, ...closure } : c));
      } else {
        const { data, error } = await trackSave(supabase.from('cash_closures').insert(closure).select().single());
        if (error) throw error;
        setClosures(prev => [data, ...prev]);
      }
      alert('Cierre guardado.');
    } catch (e) { alert('Error: ' + e.message); }
  };

  const exportClosureExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ['CIERRE DE CAJA — CHARM CLÍNICA ESTÉTICA'],
      ['Fecha:', closureDate], ['Cerrado:', new Date().toLocaleString('es-DO')], [],
      ['CONTEO EFECTIVO', '', 'Cantidad', 'Total'],
      ...DENOMINATIONS.map(d => [d.label, '', parseInt(counts[d.key]) || 0, ((parseInt(counts[d.key]) || 0) * d.value)]),
      ['', '', 'TOTAL EFECTIVO', cashCounted], [],
      ['MÉTODO', 'CONTADO', 'SISTEMA', 'DIFERENCIA'],
      ['Efectivo', cashCounted, systemTotals.cash, cashDiff],
      ['Transferencias', transfersCounted, systemTotals.transfer, transfersCounted - systemTotals.transfer],
      ['Azul Link', azulCounted, systemTotals.azul, azulCounted - systemTotals.azul],
      ['Tarjeta', cardTerminalCounted, systemTotals.card_terminal, cardTerminalCounted - systemTotals.card_terminal],
      ['TOTAL', totalCounted, totalSystem, totalCounted - totalSystem], [],
      ['Total Gastos:', '', '', totalExpenses],
      ['NETO DEL DÍA:', '', '', netTotal], [],
      ['Notas:', notes],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Cierre');
    XLSX.writeFile(wb, `CIERRE_CHARM_${closureDate}.xlsx`);
  };

  const exportClosurePdf = () => {
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cierre ${closureDate}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Lora:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Lora',serif;color:#2B2024;padding:30px;max-width:700px;margin:0 auto}
.header{text-align:center;margin-bottom:25px;padding-bottom:15px;border-bottom:2px solid #2B2024}
.brand{font-family:'Cormorant Garamond',serif;font-size:38px;font-weight:300}
.subtitle{font-size:10px;letter-spacing:0.4em;color:#8A5A6E;margin-top:4px}
h2{font-family:'Cormorant Garamond',serif;font-size:22px;margin:25px 0 10px;font-weight:500}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#8A5A6E;padding:8px 4px;border-bottom:1px solid #E8E0DB;text-align:right}
th:first-child{text-align:left}
td{padding:6px 4px;border-bottom:1px solid #EFE7E2;font-size:12px;text-align:right}
td:first-child{text-align:left}
.total-row td{font-weight:600;border-top:2px solid #2B2024;padding-top:10px}
.footer{text-align:center;margin-top:30px;padding-top:15px;border-top:1px solid #E8E0DB;font-size:9px;letter-spacing:0.2em;color:#8A5A6E}
@media print{body{padding:15px}}
</style></head><body>
<div class="header"><div class="brand">Charm</div><div class="subtitle">CIERRE DE CAJA</div><div style="font-size:13px;margin-top:8px">${dateLabelES(closureDate)}</div></div>
<h2>Conteo de Efectivo</h2>
<table><thead><tr><th>Denominación</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>
${DENOMINATIONS.map(d => `<tr><td>${d.label}</td><td>${parseInt(counts[d.key]) || 0}</td><td>${fmtMoney((parseInt(counts[d.key]) || 0) * d.value)}</td></tr>`).join('')}
<tr class="total-row"><td colspan="2">Total efectivo</td><td>${fmtMoney(cashCounted)}</td></tr>
</tbody></table>
<h2>Cuadre por Método</h2>
<table><thead><tr><th>Método</th><th>Contado</th><th>Sistema</th><th>Diferencia</th></tr></thead><tbody>
<tr><td>Efectivo</td><td>${fmtMoney(cashCounted)}</td><td>${fmtMoney(systemTotals.cash)}</td><td>${cashDiff >= 0 ? '+' : ''}${fmtMoney(cashDiff)}</td></tr>
<tr><td>Transferencias</td><td>${fmtMoney(transfersCounted)}</td><td>${fmtMoney(systemTotals.transfer)}</td><td>${(transfersCounted - systemTotals.transfer) >= 0 ? '+' : ''}${fmtMoney(transfersCounted - systemTotals.transfer)}</td></tr>
<tr><td>Azul Link</td><td>${fmtMoney(azulCounted)}</td><td>${fmtMoney(systemTotals.azul)}</td><td>${(azulCounted - systemTotals.azul) >= 0 ? '+' : ''}${fmtMoney(azulCounted - systemTotals.azul)}</td></tr>
<tr><td>Tarjeta</td><td>${fmtMoney(cardTerminalCounted)}</td><td>${fmtMoney(systemTotals.card_terminal)}</td><td>${(cardTerminalCounted - systemTotals.card_terminal) >= 0 ? '+' : ''}${fmtMoney(cardTerminalCounted - systemTotals.card_terminal)}</td></tr>
<tr class="total-row"><td>Total Ingresos</td><td>${fmtMoney(totalCounted)}</td><td>${fmtMoney(totalSystem)}</td><td>—</td></tr>
</tbody></table>
<h2>Resumen del Día</h2>
<table>
<tr><td>Total Ingresos</td><td>${fmtMoney(totalSystem)}</td></tr>
<tr><td>Total Gastos</td><td>−${fmtMoney(totalExpenses)}</td></tr>
<tr class="total-row"><td>NETO DEL DÍA</td><td>${fmtMoney(netTotal)}</td></tr>
</table>
${notes ? `<div style="margin-top:20px;font-size:11px;font-style:italic">Notas: ${notes}</div>` : ''}
<div class="footer">CHARM CLÍNICA ESTÉTICA · Generado ${new Date().toLocaleString('es-DO')}</div>
<script>setTimeout(()=>window.print(),500)</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <Section title="Cierre de Caja" subtitle="CONTEO NOCTURNO">
      <div className="border p-4 mb-6 flex items-center gap-3 flex-wrap" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
        <span className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>FECHA:</span>
        <input type="date" value={closureDate} onChange={e => setClosureDate(e.target.value)} className="px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
        {existingClosure && <span className="text-xs italic" style={{ color: '#3A8769' }}>✓ Ya existe cierre (editable)</span>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border p-5" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
          <div className="text-xs tracking-[0.25em] mb-4" style={{ color: '#8A5A6E' }}>CONTEO DE EFECTIVO</div>
          <div className="space-y-2">
            {DENOMINATIONS.map(d => {
              const qty = parseInt(counts[d.key]) || 0;
              const subtotal = qty * d.value;
              return (
                <div key={d.key} className="flex items-center gap-3">
                  <span className="text-sm" style={{ color: '#2B2024', minWidth: '85px' }}>{d.label}</span>
                  <span className="text-xs" style={{ color: '#8A5A6E' }}>×</span>
                  <input type="number" min="0" value={counts[d.key]} onChange={e => setCounts(c => ({ ...c, [d.key]: e.target.value }))} placeholder="0" className="w-20 px-2 py-1 border text-sm text-center" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
                  <span className="flex-1 text-right text-sm" style={{ color: subtotal > 0 ? '#2B2024' : '#8A5A6E' }}>{fmtMoney(subtotal)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-baseline justify-between pt-3 mt-3 border-t" style={{ borderColor: '#2B2024' }}>
            <span className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>TOTAL EFECTIVO</span>
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: '#2B2024', fontWeight: 500 }}>{fmtMoney(cashCounted)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border p-5" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>OTROS MÉTODOS</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs flex items-center gap-2 mb-1" style={{ color: '#786C66' }}><Banknote size={12} /> Transferencias bancarias</label>
                <input type="number" value={transfers} onChange={e => setTransfers(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              </div>
              <div>
                <label className="text-xs flex items-center gap-2 mb-1" style={{ color: '#786C66' }}><CreditCard size={12} /> Azul Payment Links</label>
                <input type="number" value={azul} onChange={e => setAzul(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              </div>
              <div>
                <label className="text-xs flex items-center gap-2 mb-1" style={{ color: '#786C66' }}><CreditCard size={12} /> Terminal de tarjeta</label>
                <input type="number" value={cardTerminal} onChange={e => setCardTerminal(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
              </div>
            </div>
          </div>

          <div className="border p-5" style={{ borderColor: '#E8E0DB', backgroundColor: '#FFFFFF' }}>
            <div className="text-xs tracking-[0.25em] mb-3" style={{ color: '#8A5A6E' }}>NOTAS</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 border text-sm" style={{ borderColor: '#E8E0DB', backgroundColor: 'white' }} />
          </div>
        </div>
      </div>

      <div className="border p-5 mt-6" style={{ borderColor: '#2B2024', backgroundColor: '#FFFFFF' }}>
        <div className="text-xs tracking-[0.25em] mb-4" style={{ color: '#8A5A6E' }}>CUADRE — CONTADO VS. SISTEMA</div>
        <div className="space-y-2">
          <CuadreRow label="Efectivo" counted={cashCounted} system={systemTotals.cash} />
          <CuadreRow label="Transferencias" counted={transfersCounted} system={systemTotals.transfer} />
          <CuadreRow label="Azul Link" counted={azulCounted} system={systemTotals.azul} />
          <CuadreRow label="Tarjeta Terminal" counted={cardTerminalCounted} system={systemTotals.card_terminal} />
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 mt-4 border-t" style={{ borderColor: '#2B2024' }}>
          <div>
            <div className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>TOTAL INGRESOS</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: '#2B2024', fontWeight: 500 }}>{fmtMoney(totalSystem)}</div>
          </div>
          <div>
            <div className="text-xs tracking-[0.2em]" style={{ color: '#8A5A6E' }}>TOTAL GASTOS</div>
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: '#C53A2D', fontWeight: 500 }}>−{fmtMoney(totalExpenses)}</div>
          </div>
        </div>
        <div className="pt-4 mt-4 border-t flex items-baseline justify-between" style={{ borderColor: '#2B2024' }}>
          <span className="text-xs tracking-[0.25em]" style={{ color: '#2B2024', fontWeight: 600 }}>NETO DEL DÍA</span>
          <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '40px', color: netTotal >= 0 ? '#3A8769' : '#C53A2D', fontWeight: 500, lineHeight: 1 }}>{fmtMoney(netTotal)}</span>
        </div>
      </div>

      <div className="flex gap-2 mt-6 flex-wrap">
        <button onClick={saveClosure} className="px-5 py-3 text-xs tracking-[0.25em] uppercase flex items-center gap-2" style={{ backgroundColor: '#2B2024', color: '#FBF8F6' }}>
          <Save size={14} /> {existingClosure ? 'Actualizar' : 'Guardar'} Cierre
        </button>
        <button onClick={exportClosureExcel} className="px-5 py-3 text-xs tracking-[0.25em] uppercase flex items-center gap-2 border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button onClick={exportClosurePdf} className="px-5 py-3 text-xs tracking-[0.25em] uppercase flex items-center gap-2 border" style={{ borderColor: '#2B2024', color: '#2B2024' }}>
          <FileText size={14} /> PDF
        </button>
      </div>
    </Section>
  );
}

function CuadreRow({ label, counted, system }: { label: ReactNode; counted: number; system: number }) {
  const diff = counted - system;
  const isOk = Math.abs(diff) < 0.01;
  return (
    <div className="grid gap-2 items-center text-sm" style={{ gridTemplateColumns: '1fr 100px 100px 100px' }}>
      <span style={{ color: '#2B2024' }}>{label}</span>
      <span className="text-right" style={{ color: '#786C66' }}>{fmtMoney(counted)}</span>
      <span className="text-right" style={{ color: '#786C66' }}>{fmtMoney(system)}</span>
      <span className="text-right" style={{ color: isOk ? '#3A8769' : (diff > 0 ? '#C2566E' : '#C53A2D'), fontWeight: 500 }}>
        {isOk ? '✓' : (diff > 0 ? '+' : '') + fmtMoney(diff)}
      </span>
    </div>
  );
}
