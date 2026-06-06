import { useEffect, useState, useMemo } from "react";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";

type EmpKey = string;

type AptRow = {
  id: string;
  client: string;
  date: string;
  time: string;
  employee: string | null;
};

type Props = {
  isAdmin: boolean;
  employees: EmpKey[];
  onPickDate: (date: string) => void;
  onPickEmployee: (emp: EmpKey) => void;
  onOpenSwaps: () => void;
  onOpenUpload?: () => void;
  onAddWalkIn?: () => void;
  onSignOut: () => void;
  onToggleLock?: () => void;
};

const DAYS_ES_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const labelDate = (d: string) => {
  const dt = new Date(d + "T12:00:00");
  return `${DAYS_ES_SHORT[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
};

const parseDateInput = (q: string): string | null => {
  const t = q.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
};

export default function GlobalSearch({
  isAdmin,
  employees,
  onPickDate,
  onPickEmployee,
  onOpenSwaps,
  onOpenUpload,
  onAddWalkIn,
  onSignOut,
  onToggleLock,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [appts, setAppts] = useState<AptRow[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id,client,date,time,employee")
        .order("date", { ascending: false })
        .limit(1000);
      setAppts((data || []) as AptRow[]);
    })();
  }, [open]);

  const q = query.trim().toLowerCase();
  const dateMatch = useMemo(() => parseDateInput(query), [query]);

  const clientMatches = useMemo(() => {
    if (q.length < 2) return [];
    return appts
      .filter(a => a.client.toLowerCase().includes(q))
      .slice(0, 8);
  }, [appts, q]);

  const dateMatches = useMemo(() => {
    const set = new Set<string>();
    appts.forEach(a => set.add(a.date));
    const arr = Array.from(set).sort().reverse();
    if (dateMatch) return arr.filter(d => d === dateMatch).concat(arr.filter(d => d.includes(query.trim())).slice(0, 5));
    if (q.length < 2) return arr.slice(0, 6);
    return arr.filter(d => d.includes(q)).slice(0, 6);
  }, [appts, q, dateMatch, query]);

  const empMatches = useMemo(() => {
    if (!q) return employees;
    return employees.filter(e => e.toLowerCase().includes(q));
  }, [employees, q]);

  const close = () => { setOpen(false); setQuery(""); };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-2 md:px-3 py-2 text-xs font-label border border-primary text-primary flex items-center gap-2"
        title="Buscar (Ctrl/Cmd + K)"
      >
        <Search size={13} />
        <span className="hidden md:inline">Buscar</span>
        <span className="hidden md:inline opacity-60 text-[10px]">⌘K</span>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Buscar cliente, empleada, fecha…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>

          {clientMatches.length > 0 && (
            <CommandGroup heading="Clientes">
              {clientMatches.map(a => (
                <CommandItem
                  key={a.id}
                  value={`client-${a.id}-${a.client}`}
                  onSelect={() => { onPickDate(a.date); close(); }}
                >
                  <span className="flex-1">{a.client}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {labelDate(a.date)} · {a.time}{a.employee ? ` · ${a.employee}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Empleadas">
            {empMatches.map(e => (
              <CommandItem
                key={e}
                value={`emp-${e}`}
                onSelect={() => { onPickEmployee(e); close(); }}
              >
                Ver agenda de {e}
              </CommandItem>
            ))}
          </CommandGroup>

          {dateMatches.length > 0 && (
            <CommandGroup heading="Fechas">
              {dateMatches.map(d => (
                <CommandItem
                  key={d}
                  value={`date-${d}`}
                  onSelect={() => { onPickDate(d); close(); }}
                >
                  {labelDate(d)}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Acciones">
            <CommandItem value="action-swaps" onSelect={() => { onOpenSwaps(); close(); }}>
              Ver solicitudes de cambio
            </CommandItem>
            {isAdmin && onOpenUpload && (
              <CommandItem value="action-upload" onSelect={() => { onOpenUpload(); close(); }}>
                Subir Excel
              </CommandItem>
            )}
            {isAdmin && onAddWalkIn && (
              <CommandItem value="action-walkin" onSelect={() => { onAddWalkIn(); close(); }}>
                Agregar cliente sin cita
              </CommandItem>
            )}
            {isAdmin && onToggleLock && (
              <CommandItem value="action-lock" onSelect={() => { onToggleLock(); close(); }}>
                Bloquear / Desbloquear cambios
              </CommandItem>
            )}
            <CommandItem value="action-signout" onSelect={() => { onSignOut(); close(); }}>
              Cerrar sesión
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
