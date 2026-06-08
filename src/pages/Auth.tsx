import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, AlertCircle, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

const FALLBACK_NAMES = ["Yaira", "Belkis", "Lisa", "Altagracia", "Angelica"];

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [employeeName, setEmployeeName] = useState<string>("");
  const [role, setRole] = useState<"employee" | "secretary">("employee");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [empNames, setEmpNames] = useState<string[]>(FALLBACK_NAMES);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("employee_settings").select("name").eq("active", true).order("sort_order");
        const names = (data || []).map((r: { name: string }) => r.name);
        if (names.length) setEmpNames(names);
      } catch { /* keep fallback */ }
    })();
  }, []);

  useEffect(() => {
    // CRITICAL: subscribe FIRST, then check existing session (avoids missed auth events)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session) navigate("/", { replace: true });
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/", { replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo(""); setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              display_name: displayName || (role === "secretary" ? "Secretaria" : employeeName) || email.split("@")[0],
              employee_name: role === "secretary" ? null : (employeeName || null),
            },
          },
        });
        if (error) throw error;
        if (role === "secretary") {
          try { await supabase.rpc("apply_signup_role", { role_key: "secretary" }); } catch { /* admin can set later */ }
        }
        setInfo("Cuenta creada. Iniciando sesión…");
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : "") || "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-md">
        <header className="text-center mb-10">
          <div className="text-xs font-label text-accent">CLÍNICA ESTÉTICA</div>
          <h1 className="font-display text-primary mt-2" style={{ fontSize: "clamp(56px, 12vw, 96px)", lineHeight: 1 }}>
            Charm
          </h1>
          <div className="h-px w-32 mx-auto mt-4 bg-accent" />
          <div className="text-xs font-label text-accent mt-3">AGENDA DIARIA</div>
        </header>

        <form onSubmit={handleSubmit} className="border border-border bg-card p-8">
          <div className="flex gap-2 mb-6">
            <button type="button" onClick={() => setMode("signin")}
              className="flex-1 text-xs font-label py-2 border-b-2 transition-opacity"
              style={{ borderColor: mode === "signin" ? "hsl(var(--primary))" : "transparent",
                       color: "hsl(var(--primary))", opacity: mode === "signin" ? 1 : 0.5 }}>
              Entrar
            </button>
            <button type="button" onClick={() => setMode("signup")}
              className="flex-1 text-xs font-label py-2 border-b-2 transition-opacity"
              style={{ borderColor: mode === "signup" ? "hsl(var(--primary))" : "transparent",
                       color: "hsl(var(--primary))", opacity: mode === "signup" ? 1 : 0.5 }}>
              Crear cuenta
            </button>
          </div>

          {mode === "signup" && (
            <>
              <Field label="Nombre a mostrar">
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-3 border border-border bg-background text-sm text-foreground" />
              </Field>
              <Field label="¿Cuál es tu rol?">
                <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "secretary")}
                  className="w-full px-3 py-3 border border-border bg-background text-sm text-foreground">
                  <option value="employee">Empleada (técnica)</option>
                  <option value="secretary">Secretaria / Recepción</option>
                </select>
              </Field>
              {role === "employee" && (
                <Field label="Selecciona tu nombre en la agenda">
                  <select value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
                    className="w-full px-3 py-3 border border-border bg-background text-sm text-foreground">
                    <option value="">— Elige tu nombre —</option>
                    {empNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
              )}
              <p className="text-[11px] italic text-muted-foreground mb-4 -mt-2">
                {role === "secretary"
                  ? "La secretaria recibe acceso a agenda, individual, reportes, solicitudes, clientes, historial y caja."
                  : "La primera cuenta creada será la administradora automáticamente."}
              </p>
            </>
          )}

          <Field label="Correo">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
              className="w-full px-3 py-3 border border-border bg-background text-sm text-foreground" />
          </Field>

          <Field label="Contraseña">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6}
              className="w-full px-3 py-3 border border-border bg-background text-sm text-foreground" />
          </Field>

          <button type="submit" disabled={loading}
            className="w-full px-8 py-3 text-xs font-label bg-primary text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-60 mt-2">
            {mode === "signin" ? <LogIn size={14} /> : <UserPlus size={14} />}
            {loading ? "Procesando…" : (mode === "signin" ? "Entrar" : "Crear cuenta")}
          </button>

          {error && (
            <div className="mt-4 text-sm flex items-center gap-2 text-destructive">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {info && <div className="mt-4 text-sm text-success">{info}</div>}
        </form>

        <p className="text-center mt-6 text-xs italic text-accent">
          ¿Olvidaste tu contraseña? Contacta a la administradora.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[11px] font-label text-muted-foreground mb-2">{label}</label>
      {children}
    </div>
  );
}
