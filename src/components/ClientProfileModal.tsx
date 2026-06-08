import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackSave } from "@/lib/saveSync";
import { X, Phone, Mail, Calendar, MapPin, AlertCircle, MessageSquare } from "lucide-react";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  address: string | null;
  notes: string | null;
  allergies: string | null;
  source: string | null;
  created_at: string;
};

type AppointmentRow = {
  id: string;
  date: string;
  time: string;
  employee: string | null;
  cancelled: boolean;
  no_show: boolean;
  walk_in: boolean;
};

interface Props {
  clientName: string | null;
  onClose: () => void;
  noteApt?: { id: string; client: string; time: string; notes: string | null } | null;
  canEditNote?: boolean;
  onSaveNote?: (text: string) => void;
}

export default function ClientProfileModal({ clientName, onClose, noteApt, canEditNote, onSaveNote }: Props) {
  const [noteText, setNoteText] = useState("");
  useEffect(() => { setNoteText(noteApt?.notes ?? ""); }, [noteApt?.id, noteApt?.notes]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [matches, setMatches] = useState<Customer[]>([]);
  const [history, setHistory] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!clientName) return;
    setLoading(true);
    setNotFound(false);
    setCustomer(null);
    setMatches([]);
    setHistory([]);

    (async () => {
      // Try exact (case-insensitive) match first
      const trimmed = clientName.trim();
      const { data: exact } = await supabase
        .from("customers")
        .select("*")
        .ilike("name", trimmed)
        .limit(10);

      let list = exact || [];
      if (list.length === 0) {
        const { data: fuzzy } = await supabase
          .from("customers")
          .select("*")
          .ilike("name", `%${trimmed}%`)
          .limit(10);
        list = fuzzy || [];
      }

      if (list.length === 0) {
        setNotFound(true);
        // Still load appointment history by name
        const { data: appts } = await supabase
          .from("appointments")
          .select("id,date,time,employee,cancelled,no_show,walk_in")
          .ilike("client", `%${trimmed}%`)
          .order("date", { ascending: false })
          .limit(50);
        setHistory(appts || []);
      } else if (list.length === 1) {
        setCustomer(list[0]);
        const { data: appts } = await supabase
          .from("appointments")
          .select("id,date,time,employee,cancelled,no_show,walk_in")
          .ilike("client", `%${list[0].name}%`)
          .order("date", { ascending: false })
          .limit(50);
        setHistory(appts || []);
      } else {
        setMatches(list);
      }
      setLoading(false);
    })();
  }, [clientName]);

  const selectMatch = async (c: Customer) => {
    setCustomer(c);
    setMatches([]);
    const { data: appts } = await supabase
      .from("appointments")
      .select("id,date,time,employee,cancelled,no_show,walk_in")
      .ilike("client", `%${c.name}%`)
      .order("date", { ascending: false })
      .limit(50);
    setHistory(appts || []);
  };

  const createCustomer = async () => {
    if (!clientName) return;
    const { data, error } = await trackSave(supabase
      .from("customers")
      .insert({ name: clientName.trim(), source: "agenda" })
      .select()
      .single());
    if (error) {
      alert("Error: " + error.message);
      return;
    }
    setCustomer(data);
    setNotFound(false);
  };

  if (!clientName) return null;

  const totalVisits = history.filter(h => !h.cancelled && !h.no_show).length;
  const noShows = history.filter(h => h.no_show).length;
  const cancellations = history.filter(h => h.cancelled).length;
  const lastVisit = history.find(h => !h.cancelled && !h.no_show);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md h-full bg-background border-l border-border shadow-xl overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-background">
          <h2 className="text-lg font-semibold text-primary">Perfil del cliente</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {noteApt && (
            <div className="border border-accent/40 bg-card p-3">
              <div className="text-[11px] font-label text-accent mb-2">NOTA DE ESTA CITA · {noteApt.time}</div>
              {canEditNote ? (
                <>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
                    placeholder="Ej.: pendiente RD$2000, zona sensible, trae referido…"
                    className="w-full px-3 py-2 text-sm border border-border bg-background text-foreground resize-y" />
                  <div className="flex justify-end mt-2">
                    <button onClick={() => onSaveNote?.(noteText)}
                      className="px-3 py-1.5 text-xs font-label bg-primary text-primary-foreground">Guardar nota</button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-foreground whitespace-pre-wrap">{noteApt.notes || <span className="italic text-muted-foreground">Sin nota.</span>}</div>
              )}
            </div>
          )}
          {loading && <div className="text-sm text-muted-foreground">Cargando…</div>}

          {!loading && matches.length > 1 && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Se encontraron varios clientes con ese nombre. Seleccione uno:
              </div>
              {matches.map(m => (
                <button
                  key={m.id}
                  onClick={() => selectMatch(m)}
                  className="w-full text-left px-3 py-2 border border-border hover:bg-muted rounded"
                >
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.phone || "Sin teléfono"}</div>
                </button>
              ))}
            </div>
          )}

          {!loading && notFound && !customer && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-muted rounded">
                <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div className="text-sm">
                  No existe un cliente registrado con el nombre <strong>{clientName}</strong>.
                </div>
              </div>
              <button
                onClick={createCustomer}
                className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm rounded hover:opacity-90"
              >
                Crear cliente "{clientName}"
              </button>
            </div>
          )}

          {customer && (
            <>
              <div>
                <h3 className="text-xl font-bold text-primary">{customer.name}</h3>
                {customer.source && (
                  <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-muted rounded">
                    {customer.source}
                  </span>
                )}
              </div>

              <div className="space-y-2 text-sm">
                {customer.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <a href={`tel:${customer.phone}`} className="text-primary hover:underline">
                      {customer.phone}
                    </a>
                    <a
                      href={`https://wa.me/${customer.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto px-2 py-0.5 text-xs bg-green-600 text-white rounded"
                    >
                      WhatsApp
                    </a>
                  </div>
                )}
                {customer.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <a href={`mailto:${customer.email}`} className="text-primary hover:underline break-all">
                      {customer.email}
                    </a>
                  </div>
                )}
                {customer.birthday && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>{customer.birthday}</span>
                  </div>
                )}
                {customer.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{customer.address}</span>
                  </div>
                )}
              </div>

              {customer.allergies && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded">
                  <div className="text-xs font-semibold text-destructive mb-1">Alergias</div>
                  <div className="text-sm">{customer.allergies}</div>
                </div>
              )}

              {customer.notes && (
                <div className="p-3 bg-muted rounded">
                  <div className="flex items-center gap-1 text-xs font-semibold mb-1">
                    <MessageSquare className="w-3 h-3" /> Notas
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{customer.notes}</div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 border border-border rounded">
                  <div className="text-lg font-bold text-primary">{totalVisits}</div>
                  <div className="text-xs text-muted-foreground">Visitas</div>
                </div>
                <div className="p-2 border border-border rounded">
                  <div className="text-lg font-bold text-orange-600">{noShows}</div>
                  <div className="text-xs text-muted-foreground">No-show</div>
                </div>
                <div className="p-2 border border-border rounded">
                  <div className="text-lg font-bold text-muted-foreground">{cancellations}</div>
                  <div className="text-xs text-muted-foreground">Cancel.</div>
                </div>
              </div>

              {lastVisit && (
                <div className="text-xs text-muted-foreground">
                  Última visita: {lastVisit.date} a las {lastVisit.time}
                </div>
              )}
            </>
          )}

          {history.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2">Historial de citas</div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {history.map(h => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between px-2 py-1 border border-border rounded text-xs"
                  >
                    <span>{h.date} · {h.time}</span>
                    <span className="text-muted-foreground">
                      {h.employee || "—"}
                      {h.no_show && " · NO-SHOW"}
                      {h.cancelled && " · CANCELADA"}
                      {h.walk_in && " · SIN CITA"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
