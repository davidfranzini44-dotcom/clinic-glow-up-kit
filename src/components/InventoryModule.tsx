import { useState, useMemo, useEffect, type ReactNode, type Dispatch, type SetStateAction } from "react";
import {
  Box, Plus, Search, Edit2, ArrowDownCircle, ArrowUpCircle,
  AlertTriangle, TrendingDown, MessageCircle, Truck,
  History, Download, Users, DollarSign,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { trackSave } from "@/lib/saveSync";
import type { Tables } from "@/integrations/supabase/types";

type InvItem = Tables<'inventory_items'>;
type Movement = Tables<'inventory_movements'>;
type ApptRow = Tables<'appointments'>;
type InvForm = {
  id?: string; sku?: string | null; name?: string; unit?: string | null;
  category?: string | null; supplier?: string | null; supplier_phone?: string | null;
  stock?: string | number | null; cost_per_unit?: string | number | null;
  min_stock?: string | number | null; per_client_rate?: string | number | null;
};
type MoveForm = { itemId?: string; type?: string; qty?: string | number; notes?: string };
type ForecastItem = InvItem & { totalNeeded: number; dailyNeeds: number[]; deficit: number; costNeeded: number };
type Forecast = {
  next7Days: { date: string; dayName: string; dayNum: number; clients: number }[];
  totalClients: number;
  byItem: ForecastItem[];
};

const fmtMoney = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || isNaN(n as number)) return "RD$ 0.00";
  return `RD$ ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const DAYS_ES_SHORT = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const dateLabelES = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return `${["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][d.getDay()]}, ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
};

const SubNavBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="px-3 py-1.5 text-xs tracking-[0.15em] uppercase whitespace-nowrap"
    style={{ backgroundColor: active ? "#3E2A1A" : "transparent", color: active ? "#F5EFE6" : "#3E2A1A", border: "1px solid #3E2A1A", opacity: active ? 1 : 0.65, fontFamily: "Lora, serif" }}>
    {children}
  </button>
);

const Section = ({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) => (
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

const Stat = ({ label, value, icon, color }: { label: ReactNode; value: ReactNode; icon?: ReactNode; color?: string }) => (
  <div className="border p-4" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0", borderLeft: `4px solid ${color}` }}>
    <div className="text-xs tracking-[0.2em] flex items-center gap-1" style={{ color: "#8B6F47" }}>{icon} {label.toUpperCase()}</div>
    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", fontWeight: 400, color, lineHeight: 1.1, marginTop: "4px" }}>{value}</div>
  </div>
);

const DEFAULT_INVENTORY = [
  { sku: "A1",  name: "Papel camilla",     unit: "Rollo",   stock: 0, cost_per_unit: 300,    min_stock: 5,  per_client_rate: 0.0336, category: "Camilla" },
  { sku: "A2",  name: "Wipes",             unit: "Paq 80",  stock: 0, cost_per_unit: 50,     min_stock: 5,  per_client_rate: 0.0420, category: "Limpieza" },
  { sku: "A4",  name: "Papel toalla",      unit: "Pcs",     stock: 0, cost_per_unit: 116.66, min_stock: 10, per_client_rate: 0.0672, category: "Limpieza" },
  { sku: "A5",  name: "Guantes",           unit: "Paq 100", stock: 0, cost_per_unit: 300,    min_stock: 3,  per_client_rate: 0.0252, category: "Médicos" },
  { sku: "A6",  name: "Papel film",        unit: "200 Ft",  stock: 0, cost_per_unit: 100,    min_stock: 2,  per_client_rate: 0.0210, category: "Camilla" },
  { sku: "A7",  name: "Baja lengua",       unit: "Paq 100", stock: 0, cost_per_unit: 100,    min_stock: 2,  per_client_rate: 0.0084, category: "Médicos" },
  { sku: "A8",  name: "Mascarillas",       unit: "Paq 100", stock: 0, cost_per_unit: 100,    min_stock: 2,  per_client_rate: 0.0126, category: "Médicos" },
  { sku: "A11", name: "Cubre camilla",     unit: "Pcs",     stock: 0, cost_per_unit: 130,    min_stock: 5,  per_client_rate: 0.0084, category: "Camilla" },
  { sku: "A12", name: "Batas",             unit: "Pcs",     stock: 0, cost_per_unit: 70,     min_stock: 5,  per_client_rate: 0.0210, category: "Camilla" },
  { sku: "B1",  name: "Alcohol",           unit: "1 Gal",   stock: 0, cost_per_unit: 600,    min_stock: 1,  per_client_rate: 0.0126, category: "Limpieza" },
  { sku: "B2",  name: "Geles",             unit: "1 Gal",   stock: 0, cost_per_unit: 650,    min_stock: 1,  per_client_rate: 0.0042, category: "Láser" },
  { sku: "F1",  name: "Bolsas de basura",  unit: "Paq 10",  stock: 0, cost_per_unit: 50,     min_stock: 2,  per_client_rate: 0.0084, category: "Limpieza" },
  { sku: "F2",  name: "Funda Baño",        unit: "Paq 25",  stock: 0, cost_per_unit: 70,     min_stock: 3,  per_client_rate: 0.0294, category: "Baño" },
  { sku: "F3",  name: "Papel baño",        unit: "Pcs",     stock: 0, cost_per_unit: 31.66,  min_stock: 2,  per_client_rate: 0.0210, category: "Baño" },
  { sku: "F4",  name: "Botellas de agua",  unit: "Pcs",     stock: 0, cost_per_unit: 5.48,   min_stock: 10, per_client_rate: 0.0378, category: "Otros" },
];

export default function InventoryModule({ isAdmin }: { isAdmin: boolean }) {
  const [inventory, setInventory] = useState<InvItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [appointments, setAppointments] = useState<ApptRow[]>([]);
  const [view, setView] = useState<"list" | "forecast" | "movements">("list");
  const [search, setSearch] = useState("");
  const [editForm, setEditForm] = useState<InvForm | null>(null);
  const [movementForm, setMovementForm] = useState<MoveForm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: inv }, { data: mov }, { data: apt }] = await Promise.all([
          supabase.from("inventory_items").select("*").order("sku"),
          supabase.from("inventory_movements").select("*").order("created_at", { ascending: false }),
          supabase.from("appointments").select("*"),
        ]);
        setInventory(inv || []);
        setMovements(mov || []);
        setAppointments(apt || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const initDefaults = async () => {
    if (!confirm("¿Cargar la lista predeterminada (15 insumos)?")) return;
    try {
      const { data, error } = await trackSave(supabase.from("inventory_items").insert(DEFAULT_INVENTORY).select());
      if (error) throw error;
      setInventory(data || []);
    } catch (e) { alert("Error: " + (e instanceof Error ? e.message : String(e))); }
  };

  const saveItem = async () => {
    if (!editForm.name?.trim()) { alert("Nombre obligatorio."); return; }
    const item = {
      sku: editForm.sku || null, name: editForm.name, unit: editForm.unit,
      category: editForm.category, supplier: editForm.supplier, supplier_phone: editForm.supplier_phone,
      stock: parseFloat(editForm.stock as string) || 0,
      cost_per_unit: parseFloat(editForm.cost_per_unit as string) || 0,
      min_stock: parseFloat(editForm.min_stock as string) || 0,
      per_client_rate: parseFloat(editForm.per_client_rate as string) || 0,
    };
    try {
      if (editForm.id) {
        const { error } = await trackSave(supabase.from("inventory_items").update(item).eq("id", editForm.id));
        if (error) throw error;
        setInventory(prev => prev.map(i => i.id === editForm.id ? { ...i, ...item } : i));
      } else {
        const { data, error } = await trackSave(supabase.from("inventory_items").insert(item).select().single());
        if (error) throw error;
        setInventory(prev => [...prev, data]);
      }
      setEditForm(null);
    } catch (e) { alert("Error: " + (e instanceof Error ? e.message : String(e))); }
  };

  const saveMovement = async () => {
    const qty = parseFloat(movementForm.qty as string);
    if (!qty || qty <= 0) { alert("Cantidad inválida."); return; }
    const item = inventory.find(i => i.id === movementForm.itemId);
    if (!item) return;
    let newStock;
    if (movementForm.type === "in") newStock = Number(item.stock) + qty;
    else if (movementForm.type === "out") newStock = Number(item.stock) - qty;
    else newStock = qty;
    if (newStock < 0 && !confirm(`Stock quedaría en ${newStock}. ¿Continuar?`)) return;

    try {
      const { error: e1 } = await trackSave(supabase.from("inventory_items").update({ stock: newStock }).eq("id", item.id));
      if (e1) throw e1;
      const movement = {
        date: todayISO(), item_id: item.id, item_name: item.name, sku: item.sku,
        type: movementForm.type, qty, previous_stock: item.stock, new_stock: newStock,
        notes: movementForm.notes || "",
      };
      const { data, error: e2 } = await trackSave(supabase.from("inventory_movements").insert(movement).select().single());
      if (e2) throw e2;

      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, stock: newStock } : i));
      setMovements(prev => [data, ...prev]);
      setMovementForm(null);
    } catch (e) { alert("Error: " + (e instanceof Error ? e.message : String(e))); }
  };

  const forecast = useMemo(() => {
    const next7Days: { date: string; dayName: string; dayNum: number; clients: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const apts = appointments.filter(a => a.date === ds && !a.cancelled);
      next7Days.push({ date: ds, dayName: DAYS_ES_SHORT[d.getDay()], dayNum: d.getDate(), clients: apts.length });
    }
    const totalClients = next7Days.reduce((s, d) => s + d.clients, 0);
    const byItem = inventory.map(item => {
      const totalNeeded = totalClients * Number(item.per_client_rate || 0);
      const dailyNeeds = next7Days.map(d => d.clients * Number(item.per_client_rate || 0));
      const deficit = Number(item.stock) - totalNeeded;
      const costNeeded = totalNeeded * Number(item.cost_per_unit || 0);
      return { ...item, totalNeeded, dailyNeeds, deficit, costNeeded };
    });
    return { next7Days, totalClients, byItem };
  }, [inventory, appointments]);

  const filtered = inventory
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.sku || "").toLowerCase().includes(search.toLowerCase()));

  const getStatus = (item: InvItem) => {
    const s = Number(item.stock);
    if (s === 0) return { label: "Sin stock", color: "#A04040", icon: "⚠" };
    if (s < Number(item.min_stock || 0)) return { label: "Insuficiente", color: "#C8956D", icon: "↓" };
    return { label: "Suficiente", color: "#6B8E5A", icon: "✓" };
  };

  const totalValue = inventory.reduce((s, i) => s + (Number(i.stock) * Number(i.cost_per_unit || 0)), 0);
  const lowStockCount = inventory.filter(i => Number(i.stock) < Number(i.min_stock || 0)).length;
  const outOfStockCount = inventory.filter(i => Number(i.stock) === 0).length;

  const exportInventory = () => {
    const wb = XLSX.utils.book_new();
    const invRows: (string | number | null)[][] = [
      [`INVENTARIO ACTUAL — ${dateLabelES(todayISO()).toUpperCase()}`], [],
      ["SKU", "Descripción", "Unidad", "Stock", "Costo/U", "Valor", "Estado", "Proveedor"],
    ];
    inventory.forEach(i => {
      const status = getStatus(i);
      invRows.push([i.sku, i.name, i.unit, i.stock, i.cost_per_unit, Number(i.stock) * Number(i.cost_per_unit || 0), `${status.icon} ${status.label}`, i.supplier || ""]);
    });
    invRows.push([]);
    invRows.push(["VALOR TOTAL", "", "", "", "", totalValue]);
    const ws1 = XLSX.utils.aoa_to_sheet(invRows);
    XLSX.utils.book_append_sheet(wb, ws1, "Inventario Actual");

    const fcRows: (string | number | null)[][] = [
      [`PRONÓSTICO PRÓXIMOS 7 DÍAS (${forecast.totalClients} CLIENTES)`], [],
      ["Clientes:", "", "", ...forecast.next7Days.map(d => `${d.dayName} ${d.dayNum}`), "Total", "Stock", "Saldo", "Costo", "Valor Stock"],
      ["Citas →", "", "", ...forecast.next7Days.map(d => d.clients), forecast.totalClients, "", "", "", ""],
      [],
      ["SKU", "Producto", "Unidad", ...forecast.next7Days.map(d => `${d.dayName} ${d.dayNum}`), "Total", "Stock", "Saldo", "Costo", "Valor"],
    ];
    forecast.byItem.forEach(it => {
      fcRows.push([it.sku, it.name, it.unit,
        ...it.dailyNeeds.map((n: number) => parseFloat(n.toFixed(2))),
        parseFloat(it.totalNeeded.toFixed(2)), it.stock,
        parseFloat(it.deficit.toFixed(2)),
        parseFloat(it.costNeeded.toFixed(2)),
        parseFloat((Number(it.stock) * Number(it.cost_per_unit || 0)).toFixed(2)),
      ]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(fcRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Pronóstico");

    const deficits = forecast.byItem.filter(i => i.deficit < 0);
    if (deficits.length > 0) {
      const reRows: (string | number | null)[][] = [["LISTA DE REORDEN"], [], ["SKU", "Producto", "Unidad", "Stock", "Necesario", "Comprar", "Costo/U", "Total", "Proveedor", "Tel"]];
      let total = 0;
      deficits.forEach(it => {
        const toBuy = Math.ceil(-it.deficit);
        const cost = toBuy * Number(it.cost_per_unit);
        total += cost;
        reRows.push([it.sku, it.name, it.unit, it.stock, parseFloat(it.totalNeeded.toFixed(2)), toBuy, it.cost_per_unit, cost, it.supplier || "", it.supplier_phone || ""]);
      });
      reRows.push([]); reRows.push(["", "", "", "", "", "", "TOTAL", total]);
      const ws3 = XLSX.utils.aoa_to_sheet(reRows);
      XLSX.utils.book_append_sheet(wb, ws3, "Reorden");
    }
    XLSX.writeFile(wb, `INVENTARIO_CHARM_${todayISO()}.xlsx`);
  };

  if (loading) return <div className="p-12 text-center text-xs tracking-[0.3em]" style={{ color: "#8B6F47" }}>CARGANDO INVENTARIO…</div>;

  return (
    <Section title="Inventario" subtitle="INSUMOS · CONTROL DE STOCK"
      action={isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportInventory} className="px-4 py-2 text-xs tracking-[0.2em] uppercase border flex items-center gap-2" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}><Download size={14} /> Exportar</button>
          <button onClick={() => setEditForm({ sku: "", name: "", unit: "", stock: "", cost_per_unit: "", supplier: "", supplier_phone: "", min_stock: "", per_client_rate: "", category: "Limpieza" })} className="px-4 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}><Plus size={14} /> Nuevo</button>
        </div>
      )}>
      <div className="flex gap-2 mb-6 flex-wrap">
        <SubNavBtn active={view === "list"} onClick={() => setView("list")}>Stock ({inventory.length})</SubNavBtn>
        <SubNavBtn active={view === "forecast"} onClick={() => setView("forecast")}>📊 Pronóstico</SubNavBtn>
        <SubNavBtn active={view === "movements"} onClick={() => setView("movements")}>📋 Movimientos ({movements.length})</SubNavBtn>
      </div>

      {inventory.length === 0 && view === "list" && (
        <div className="border p-12 text-center" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
          <Box size={36} className="mx-auto mb-3" style={{ color: "#8B6F47" }} strokeWidth={1.2} />
          <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "24px", color: "#3E2A1A" }} className="mb-2">No hay insumos</h3>
          <p className="text-sm mb-6" style={{ color: "#6B5B47" }}>Carga la lista predeterminada o agrega manualmente.</p>
          {isAdmin && (
            <div className="flex gap-2 justify-center flex-wrap">
              <button onClick={initDefaults} className="px-6 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}>Cargar predeterminados</button>
              <button onClick={() => setEditForm({ sku: "", name: "", unit: "", stock: "", cost_per_unit: "", supplier: "", supplier_phone: "", min_stock: "", per_client_rate: "", category: "Limpieza" })} className="px-6 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Manual</button>
            </div>
          )}
        </div>
      )}

      {editForm && <ItemEditForm form={editForm} setForm={setEditForm} onSave={saveItem} onCancel={() => setEditForm(null)} />}
      {movementForm && <MovementForm form={movementForm} setForm={setMovementForm} item={inventory.find(i => i.id === movementForm.itemId)} onSave={saveMovement} onCancel={() => setMovementForm(null)} />}

      {view === "list" && inventory.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Total" value={inventory.length} icon={<Box size={14} />} color="#3E2A1A" />
            <Stat label="Sin Stock" value={outOfStockCount} icon={<AlertTriangle size={14} />} color="#A04040" />
            <Stat label="Stock Bajo" value={lowStockCount} icon={<TrendingDown size={14} />} color="#C8956D" />
            <Stat label="Valor Total" value={fmtMoney(totalValue)} icon={<DollarSign size={14} />} color="#6B8E5A" />
          </div>

          <div className="border p-3 mb-4 flex items-center gap-2" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
            <Search size={14} style={{ color: "#8B6F47" }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…" className="flex-1 px-2 py-1 text-sm bg-transparent outline-none" style={{ color: "#3E2A1A" }} />
          </div>

          <div className="border" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
            <div className="hidden md:grid gap-3 px-4 py-3 text-xs tracking-[0.2em] uppercase border-b" style={{ borderColor: "#D4C4A8", color: "#8B6F47", gridTemplateColumns: "60px 1fr 90px 100px 100px 110px 100px 130px" }}>
              <div>SKU</div><div>Producto</div><div>Unidad</div><div className="text-right">Stock</div><div className="text-right">Costo/U</div><div className="text-right">Valor</div><div>Estado</div><div className="text-right">Acciones</div>
            </div>
            {filtered.map((item, idx) => {
              const status = getStatus(item);
              return (
                <div key={item.id}>
                  <div className="hidden md:grid gap-3 px-4 py-3 border-b items-center" style={{ borderColor: "#EAE0CC", backgroundColor: idx % 2 === 0 ? "transparent" : "#F5EFE6", gridTemplateColumns: "60px 1fr 90px 100px 100px 110px 100px 130px" }}>
                    <div className="text-xs" style={{ color: "#8B6F47" }}>{item.sku}</div>
                    <div className="text-sm" style={{ color: "#3E2A1A" }}>{item.name}</div>
                    <div className="text-xs" style={{ color: "#6B5B47" }}>{item.unit}</div>
                    <div className="text-right text-sm font-medium" style={{ color: status.color }}>{item.stock}</div>
                    <div className="text-right text-xs" style={{ color: "#6B5B47" }}>{fmtMoney(item.cost_per_unit)}</div>
                    <div className="text-right text-sm" style={{ color: "#3E2A1A" }}>{fmtMoney(Number(item.stock) * Number(item.cost_per_unit || 0))}</div>
                    <div className="text-xs" style={{ color: status.color }}>{status.icon} {status.label}</div>
                    <div className="flex justify-end gap-1">
                      {isAdmin && (
                        <>
                          <button onClick={() => setMovementForm({ itemId: item.id, type: "in", qty: "", notes: "" })} className="p-1.5"><ArrowDownCircle size={16} style={{ color: "#6B8E5A" }} /></button>
                          <button onClick={() => setMovementForm({ itemId: item.id, type: "out", qty: "", notes: "" })} className="p-1.5"><ArrowUpCircle size={16} style={{ color: "#A04040" }} /></button>
                          <button onClick={() => setEditForm(item)} className="p-1.5"><Edit2 size={14} style={{ color: "#3E2A1A" }} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="md:hidden border-b p-3" style={{ borderColor: "#EAE0CC", backgroundColor: idx % 2 === 0 ? "transparent" : "#F5EFE6" }}>
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs" style={{ color: "#8B6F47" }}>{item.sku} · {item.unit}</div>
                        <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{item.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs" style={{ color: status.color }}>{status.icon} {status.label}</div>
                        <div className="text-lg font-medium" style={{ color: status.color }}>{item.stock}</div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setMovementForm({ itemId: item.id, type: "in", qty: "", notes: "" })} className="p-1.5"><ArrowDownCircle size={18} style={{ color: "#6B8E5A" }} /></button>
                        <button onClick={() => setMovementForm({ itemId: item.id, type: "out", qty: "", notes: "" })} className="p-1.5"><ArrowUpCircle size={18} style={{ color: "#A04040" }} /></button>
                        <button onClick={() => setEditForm(item)} className="p-1.5"><Edit2 size={14} style={{ color: "#3E2A1A" }} /></button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "forecast" && inventory.length > 0 && <ForecastView forecast={forecast} totalValue={totalValue} />}
      {view === "movements" && <MovementsHistory movements={movements} />}
    </Section>
  );
}

function ItemEditForm({ form, setForm, onSave, onCancel }: { form: InvForm; setForm: Dispatch<SetStateAction<InvForm | null>>; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="border p-5 mb-6" style={{ borderColor: "#8B6F47", backgroundColor: "#FBF7F0" }}>
      <div className="text-xs tracking-[0.25em] mb-4" style={{ color: "#8B6F47" }}>{form.id ? "EDITAR" : "NUEVO"} INSUMO</div>
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>SKU</label>
          <input type="text" value={form.sku || ""} onChange={e => setForm((f) => ({ ...f, sku: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Nombre *</label>
          <input type="text" value={form.name || ""} onChange={e => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Unidad</label>
          <input type="text" value={form.unit || ""} onChange={e => setForm((f) => ({ ...f, unit: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Categoría</label>
          <select value={form.category || "Limpieza"} onChange={e => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }}>
            <option>Camilla</option><option>Limpieza</option><option>Médicos</option><option>Láser</option><option>Baño</option><option>Otros</option>
          </select>
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Stock</label>
          <input type="number" step="0.01" value={form.stock || ""} onChange={e => setForm((f) => ({ ...f, stock: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Costo/U (RD$)</label>
          <input type="number" step="0.01" value={form.cost_per_unit || ""} onChange={e => setForm((f) => ({ ...f, cost_per_unit: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Stock mínimo</label>
          <input type="number" step="0.1" value={form.min_stock || ""} onChange={e => setForm((f) => ({ ...f, min_stock: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Tasa por cliente</label>
          <input type="number" step="0.0001" value={form.per_client_rate || ""} onChange={e => setForm((f) => ({ ...f, per_client_rate: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Proveedor</label>
          <input type="text" value={form.supplier || ""} onChange={e => setForm((f) => ({ ...f, supplier: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
        <div>
          <label className="block text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#6B5B47" }}>Tel. proveedor</label>
          <input type="tel" value={form.supplier_phone || ""} onChange={e => setForm((f) => ({ ...f, supplier_phone: e.target.value }))} className="w-full px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: "#3E2A1A", color: "#F5EFE6" }}>Guardar</button>
        <button onClick={onCancel} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Cancelar</button>
      </div>
    </div>
  );
}

function MovementForm({ form, setForm, item, onSave, onCancel }: { form: MoveForm; setForm: Dispatch<SetStateAction<MoveForm | null>>; item: InvItem; onSave: () => void; onCancel: () => void }) {
  if (!item) return null;
  const titles: Record<string, string> = { in: "↓ ENTRADA", out: "↑ SALIDA", adjust: "⚖ AJUSTE" };
  const colors: Record<string, string> = { in: "#6B8E5A", out: "#A04040", adjust: "#8B6F47" };
  const helps: Record<string, string> = {
    in: `Se SUMARÁ al stock actual (${item.stock} ${item.unit}).`,
    out: `Se RESTARÁ del stock actual (${item.stock} ${item.unit}).`,
    adjust: `REEMPLAZARÁ el stock actual (${item.stock} ${item.unit}).`,
  };
  return (
    <div className="border p-5 mb-6" style={{ borderColor: colors[form.type], backgroundColor: "#FBF7F0", borderLeftWidth: "4px" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs tracking-[0.25em]" style={{ color: colors[form.type] }}>{titles[form.type]}</div>
          <div className="text-sm mt-1" style={{ color: "#3E2A1A" }}>{item.name}</div>
        </div>
        <div className="flex gap-1">
          {["in", "out", "adjust"].map(t => (
            <button key={t} onClick={() => setForm((f) => ({ ...f, type: t }))} className="px-3 py-1 text-xs tracking-[0.15em] uppercase border" style={{ backgroundColor: form.type === t ? colors[t] : "transparent", color: form.type === t ? "white" : colors[t], borderColor: colors[t] }}>
              {t === "in" ? "Entrada" : t === "out" ? "Salida" : "Ajuste"}
            </button>
          ))}
        </div>
      </div>
      <div className="text-xs italic mb-3" style={{ color: "#6B5B47" }}>{helps[form.type]}</div>
      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <input type="number" step="0.01" value={form.qty || ""} onChange={e => setForm((f) => ({ ...f, qty: e.target.value }))} placeholder="Cantidad *" className="px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} autoFocus />
        <input type="text" value={form.notes || ""} onChange={e => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notas (opcional)" className="px-3 py-2 border text-sm" style={{ borderColor: "#D4C4A8", backgroundColor: "white" }} />
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="px-5 py-2 text-xs tracking-[0.2em] uppercase" style={{ backgroundColor: colors[form.type], color: "white" }}>Confirmar</button>
        <button onClick={onCancel} className="px-5 py-2 text-xs tracking-[0.2em] uppercase border" style={{ borderColor: "#3E2A1A", color: "#3E2A1A" }}>Cancelar</button>
      </div>
    </div>
  );
}

function ForecastView({ forecast, totalValue }: { forecast: Forecast; totalValue: number }) {
  const deficits = forecast.byItem.filter((i) => i.deficit < 0);
  const reorderTotal = deficits.reduce((s: number, i) => s + (Math.ceil(-i.deficit) * Number(i.cost_per_unit || 0)), 0);

  const sendReorderWA = (item: ForecastItem) => {
    const phone = (item.supplier_phone || "").replace(/\D/g, "");
    const toBuy = Math.ceil(-item.deficit);
    const msg = `Hola, soy de Charm Clínica Estética. Necesito hacer un pedido:\n\n${item.name} (${item.sku}): ${toBuy} ${item.unit}\n\nGracias.`;
    const url = phone ? `https://wa.me/${phone.startsWith("1") ? phone : "1" + phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Clientes Próx. 7 Días" value={forecast.totalClients} icon={<Users size={14} />} color="#3E2A1A" />
        <Stat label="A Reordenar" value={deficits.length} icon={<AlertTriangle size={14} />} color="#A04040" />
        <Stat label="Costo Reorden" value={fmtMoney(reorderTotal)} icon={<Truck size={14} />} color="#C8956D" />
        <Stat label="Valor Inventario" value={fmtMoney(totalValue)} icon={<DollarSign size={14} />} color="#6B8E5A" />
      </div>

      <div className="border p-4 mb-6" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
        <div className="text-xs tracking-[0.25em] mb-3" style={{ color: "#8B6F47" }}>CITAS PRÓXIMOS 7 DÍAS</div>
        <div className="grid grid-cols-7 gap-2">
          {forecast.next7Days.map((d) => (
            <div key={d.date} className="text-center">
              <div className="text-xs" style={{ color: "#8B6F47" }}>{d.dayName}</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "24px", color: "#3E2A1A", fontWeight: 500 }}>{d.clients}</div>
              <div className="text-[10px]" style={{ color: "#6B5B47" }}>{d.dayNum}</div>
            </div>
          ))}
        </div>
      </div>

      {deficits.length > 0 && (
        <div className="border mb-6" style={{ borderColor: "#A04040", backgroundColor: "#FBF7F0", borderLeftWidth: "4px" }}>
          <div className="p-4 border-b" style={{ borderColor: "#D4C4A8" }}>
            <div className="text-xs tracking-[0.25em] flex items-center gap-2" style={{ color: "#A04040" }}><AlertTriangle size={12} /> LISTA DE REORDEN</div>
            <div className="text-sm mt-1" style={{ color: "#3E2A1A" }}>{deficits.length} producto{deficits.length === 1 ? "" : "s"} no alcanza{deficits.length === 1 ? "" : "n"}</div>
          </div>
          {deficits.map((item) => {
            const toBuy = Math.ceil(-item.deficit);
            const cost = toBuy * Number(item.cost_per_unit || 0);
            return (
              <div key={item.id} className="px-4 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "#EAE0CC" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{item.name}</div>
                  <div className="text-xs" style={{ color: "#8B6F47" }}>Stock: {item.stock} · Necesario: {item.totalNeeded.toFixed(1)} · Comprar: <span style={{ color: "#A04040", fontWeight: 600 }}>{toBuy} {item.unit}</span></div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium" style={{ color: "#3E2A1A" }}>{fmtMoney(cost)}</div>
                </div>
                {item.supplier_phone && <button onClick={() => sendReorderWA(item)} className="px-3 py-2 text-xs tracking-[0.2em] uppercase flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}><MessageCircle size={12} /> Pedir</button>}
              </div>
            );
          })}
          <div className="p-4 flex items-baseline justify-between" style={{ backgroundColor: "#F5EFE6" }}>
            <span className="text-xs tracking-[0.2em]" style={{ color: "#8B6F47" }}>TOTAL</span>
            <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: "28px", color: "#A04040", fontWeight: 500 }}>{fmtMoney(reorderTotal)}</span>
          </div>
        </div>
      )}

      <div className="border" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
        <div className="hidden md:grid gap-3 px-4 py-3 text-xs tracking-[0.2em] uppercase border-b" style={{ borderColor: "#D4C4A8", color: "#8B6F47", gridTemplateColumns: "60px 1fr 90px 100px 100px 110px" }}>
          <div>SKU</div><div>Producto</div><div>Stock</div><div className="text-right">Necesario</div><div className="text-right">Saldo</div><div className="text-right">Costo</div>
        </div>
        {forecast.byItem.map((item, idx: number) => {
          const isDeficit = item.deficit < 0;
          return (
            <div key={item.id} className="hidden md:grid gap-3 px-4 py-3 border-b items-center" style={{ borderColor: "#EAE0CC", backgroundColor: idx % 2 === 0 ? "transparent" : "#F5EFE6", gridTemplateColumns: "60px 1fr 90px 100px 100px 110px" }}>
              <div className="text-xs" style={{ color: "#8B6F47" }}>{item.sku}</div>
              <div className="text-sm" style={{ color: "#3E2A1A" }}>{item.name}</div>
              <div className="text-sm" style={{ color: "#3E2A1A" }}>{item.stock}</div>
              <div className="text-right text-sm" style={{ color: "#6B5B47" }}>{item.totalNeeded.toFixed(1)}</div>
              <div className="text-right text-sm font-medium" style={{ color: isDeficit ? "#A04040" : "#6B8E5A" }}>{isDeficit ? "" : "+"}{item.deficit.toFixed(1)}</div>
              <div className="text-right text-xs" style={{ color: "#6B5B47" }}>{fmtMoney(item.costNeeded)}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function MovementsHistory({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) {
    return (
      <div className="border p-12 text-center" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
        <History size={32} className="mx-auto mb-3" style={{ color: "#8B6F47" }} strokeWidth={1.2} />
        <p className="text-sm italic" style={{ color: "#6B5B47" }}>Sin movimientos.</p>
      </div>
    );
  }
  const labels: Record<string, string> = { in: "Entrada", out: "Salida", adjust: "Ajuste" };
  const colors: Record<string, string> = { in: "#6B8E5A", out: "#A04040", adjust: "#8B6F47" };
  const symbols: Record<string, string> = { in: "↓", out: "↑", adjust: "⚖" };
  return (
    <div className="border" style={{ borderColor: "#D4C4A8", backgroundColor: "#FBF7F0" }}>
      {movements.map((m, idx: number) => (
        <div key={m.id} className="px-4 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "#EAE0CC", backgroundColor: idx % 2 === 0 ? "transparent" : "#F5EFE6" }}>
          <div className="text-xs" style={{ color: "#8B6F47", minWidth: "90px" }}>{m.date}</div>
          <div className="px-2 py-0.5 text-xs tracking-[0.15em] uppercase" style={{ backgroundColor: colors[m.type], color: "white", minWidth: "70px", textAlign: "center" }}>{symbols[m.type]} {labels[m.type]}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm" style={{ color: "#3E2A1A" }}>{m.item_name} <span style={{ color: "#8B6F47" }}>· {m.sku}</span></div>
            {m.notes && <div className="text-xs italic" style={{ color: "#6B5B47" }}>{m.notes}</div>}
          </div>
          <div className="text-right">
            <div className="text-sm font-medium" style={{ color: colors[m.type] }}>{m.type === "in" ? "+" : m.type === "out" ? "−" : "="}{m.qty}</div>
            <div className="text-[10px]" style={{ color: "#8B6F47" }}>{m.previous_stock} → {m.new_stock}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
