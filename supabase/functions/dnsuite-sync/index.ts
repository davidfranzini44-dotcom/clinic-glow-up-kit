// Charm ← DNSuite (Firestore) one-way sync.
// Signs into DNSuite with a dedicated account, pulls citas for the configured
// tenant + sucursal, and upserts them into Charm (dedup by dnsuite_id),
// auto-assigning new ones with the balanced roster algorithm. Read-only on DNSuite.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FB_API_KEY = Deno.env.get("DNSUITE_API_KEY") ?? "AIzaSyCvo_YZz0jl-o9FRSANYHXrN2Wdx3P5CU0";
const FB_PROJECT = Deno.env.get("DNSUITE_PROJECT") ?? "dnsuite-66175";

type Cita = {
  id: string; date: string; time: string; clientName: string; clientPhone?: string;
  serviceName?: string; status?: string; pendingAmount?: string;
};

const fv = (v: Record<string, unknown>): unknown => {
  const k = Object.keys(v)[0];
  const x = (v as Record<string, unknown>)[k];
  if (k === "integerValue" || k === "doubleValue") return Number(x);
  if (k === "booleanValue") return x;
  return x;
};

async function firebaseLogin(email: string, password: string): Promise<string> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error("DNSuite login failed: " + (j.error?.message || r.status));
  return j.idToken;
}

async function pullDay(token: string, tenantId: string, sucursalId: string, date: string): Promise<Cita[]> {
  // Equality-only filters (no composite index needed). DNSuite stores
  // sucursalId inconsistently (sometimes text, sometimes number), so we
  // query both representations and merge.
  const sucValues: Record<string, unknown>[] = [{ stringValue: sucursalId }];
  if (/^\d+$/.test(sucursalId)) sucValues.push({ integerValue: sucursalId });

  const out = new Map<string, Cita>();
  for (const sucVal of sucValues) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: "citas" }],
        where: { compositeFilter: { op: "AND", filters: [
          { fieldFilter: { field: { fieldPath: "tenantId" }, op: "EQUAL", value: { stringValue: tenantId } } },
          { fieldFilter: { field: { fieldPath: "sucursalId" }, op: "EQUAL", value: sucVal } },
          { fieldFilter: { field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: date } } },
        ] } },
        limit: 400,
      },
    };
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents:runQuery`, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("Firestore query failed: " + JSON.stringify(j).slice(0, 300));
    const errEntry = j.find((x: { error?: { message?: string } }) => x.error);
    if (errEntry) throw new Error("Firestore: " + (errEntry.error.message || "").slice(0, 300));
    for (const x of j.filter((y: { document?: unknown }) => y.document) as { document: { name: string; fields: Record<string, Record<string, unknown>> } }[]) {
      const f = x.document.fields;
      const g = (k: string) => (f[k] ? fv(f[k]) : undefined) as string | undefined;
      const id = x.document.name.split("/").pop()!;
      out.set(id, {
        id,
        date: g("date") ?? "", time: g("time") ?? "",
        clientName: g("clientName") ?? "", clientPhone: g("clientPhone"),
        serviceName: g("serviceName"), status: g("status"),
        pendingAmount: g("pendingAmount"),
      } as Cita);
    }
  }
  return [...out.values()];
}

async function pullCitas(token: string, tenantId: string, sucursalId: string, fromDate: string, horizonDays: number): Promise<Cita[]> {
  const out: Cita[] = [];
  const start = new Date(fromDate + "T12:00:00");
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(...await pullDay(token, tenantId, sucursalId, ds));
  }
  return out;
}

const toMins = (t: string): number => {
  const m = t.match(/(\d{1,2}):(\d{2})/); if (!m) return 0; return +m[1] * 60 + +m[2];
};
const fmt = (mins: number): string => {
  const h = Math.floor(mins / 60), mm = mins % 60; const ap = h >= 12 ? "p.m." : "a.m.";
  let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
};

// ── Roster + balanced assignment (mirror of src/lib/roster.ts) ──
type Emp = { name: string; cabin: number | null; max: number | null; sched: Record<number, { works: boolean; s: number; e: number; ls: number | null; lm: number } | undefined> };
const weekday = (d: string) => new Date(d + "T12:00:00").getDay();
function isWorking(e: Emp, mins: number, wd: number, buf: number, ov?: { s?: number; e?: number }) {
  const d = e.sched[wd]; if (!d || !d.works) return false;
  const s = ov?.s ?? d.s, en = ov?.e ?? d.e;
  if (mins < s || mins >= en - buf) return false;
  if (d.ls != null && mins >= d.ls && mins < d.ls + d.lm) return false;
  return true;
}
function assign(rows: { id: string; t: number }[], wd: number, emps: Emp[], off: Set<string>, ovs: Record<string, { s?: number; e?: number }>, buf: number): Record<string, { emp: string; cab: number | null }> {
  const total = rows.length;
  const targets: Record<string, number> = {}; for (const e of emps) targets[e.name] = 0;
  let remaining = total;
  let active = emps.filter(e => e.max == null || e.max > 0);
  while (remaining > 0 && active.length) {
    const share = Math.max(1, Math.floor(remaining / active.length)); let dist = 0;
    for (const e of active) { if (remaining - dist <= 0) break; const cap = e.max ?? Infinity; const add = Math.min(share, cap - targets[e.name], remaining - dist); if (add > 0) { targets[e.name] += add; dist += add; } }
    if (dist === 0) break; remaining -= dist; active = active.filter(e => (e.max ?? Infinity) > targets[e.name]);
  }
  const availCount = (t: number) => emps.filter(e => isWorking(e, t, wd, buf, ovs[e.name]) && !off.has(e.name)).length;
  const order = rows.map((_, i) => i).sort((a, b) => { const ca = availCount(rows[a].t), cb = availCount(rows[b].t); if (ca !== cb) return ca - cb; return rows[a].t - rows[b].t; });
  const counts: Record<string, number> = {}; const last: Record<string, number> = {}; for (const e of emps) { counts[e.name] = 0; last[e.name] = -9999; }
  const slot: Record<number, Set<string>> = {}; const out: Record<string, { emp: string; cab: number | null }> = {};
  for (const idx of order) {
    const { id, t } = rows[idx]; (slot[t] ??= new Set());
    let avail = emps.filter(e => isWorking(e, t, wd, buf, ovs[e.name]) && !off.has(e.name) && (e.max == null || counts[e.name] < e.max));
    if (!avail.length) avail = emps.filter(e => isWorking(e, t, wd, buf, ovs[e.name]) && !off.has(e.name));
    if (!avail.length) avail = emps.filter(e => isWorking(e, t, wd, 0, ovs[e.name]) && !off.has(e.name));
    if (!avail.length) avail = emps.filter(e => !off.has(e.name));
    if (!avail.length) avail = [...emps];
    const notYet = avail.filter(e => !slot[t].has(e.name));
    let pool = notYet.length ? (notYet.filter(e => counts[e.name] < targets[e.name]).length ? notYet.filter(e => counts[e.name] < targets[e.name]) : notYet)
                             : (avail.filter(e => counts[e.name] < targets[e.name]).length ? avail.filter(e => counts[e.name] < targets[e.name]) : avail);
    pool = [...pool].sort((a, b) => { const dA = targets[a.name] - counts[a.name], dB = targets[b.name] - counts[b.name]; if (dA !== dB) return dB - dA; return (t - last[b.name]) - (t - last[a.name]); });
    const ch = pool[0]; counts[ch.name]++; last[ch.name] = t; slot[t].add(ch.name); out[id] = { emp: ch.name, cab: ch.cabin };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cfg } = await sb.from("dnsuite_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg || !cfg.enabled) return new Response("sync disabled", { status: 200, headers: CORS });
    const secret = req.headers.get("x-sync-secret");
    if (secret !== cfg.webhook_secret) return new Response("forbidden", { status: 403, headers: CORS });

    const email = Deno.env.get("DNSUITE_EMAIL"), password = Deno.env.get("DNSUITE_PASSWORD");
    if (!email || !password) return new Response("missing DNSUITE_EMAIL / DNSUITE_PASSWORD secrets", { status: 500, headers: CORS });

    const today = new Date().toISOString().slice(0, 10);
    const token = await firebaseLogin(email, password);
    const citas = await pullCitas(token, cfg.tenant_id, cfg.sucursal_id, today, Math.min(cfg.horizon_days ?? 21, 45));

    // roster
    const [{ data: es }, { data: sc }, { data: to }, { data: ov }] = await Promise.all([
      sb.from("employee_settings").select("*").eq("active", true).order("sort_order"),
      sb.from("employee_schedules").select("*"),
      sb.from("employee_time_off").select("employee_name,date"),
      sb.from("employee_date_overrides").select("employee_name,date,start_min,end_min"),
    ]);
    const emps: Emp[] = (es ?? []).map((e: Record<string, unknown>) => ({
      name: e.name as string, cabin: (e.cabin as number) ?? null, max: (e.max_clients as number) ?? null, sched: {},
    }));
    const byName = new Map(emps.map(e => [e.name, e]));
    for (const r of (sc ?? []) as Record<string, unknown>[]) {
      const e = byName.get(r.employee_name as string); if (!e) continue;
      e.sched[r.weekday as number] = { works: !!r.works, s: (r.start_min as number) ?? 0, e: (r.end_min as number) ?? 0, ls: (r.lunch_start_min as number) ?? null, lm: (r.lunch_minutes as number) ?? 60 };
    }
    const offByDate: Record<string, Set<string>> = {};
    for (const r of (to ?? []) as Record<string, string>[]) (offByDate[r.date] ??= new Set()).add(r.employee_name);
    const ovByDate: Record<string, Record<string, { s?: number; e?: number }>> = {};
    for (const r of (ov ?? []) as Record<string, unknown>[]) ((ovByDate[r.date as string] ??= {}))[r.employee_name as string] = { s: (r.start_min as number) ?? undefined, e: (r.end_min as number) ?? undefined };

    // existing synced rows from today onward
    const { data: existing } = await sb.from("appointments").select("id,dnsuite_id,date,employee,cabin,client,time_mins,cancelled").gte("date", today).eq("source", "dnsuite");
    const exByDn = new Map((existing ?? []).map((r: Record<string, unknown>) => [r.dnsuite_id as string, r]));
    const pulledIds = new Set(citas.map(c => c.id));

    let inserted = 0, updated = 0, removed = 0, cancelled = 0;
    let firstErr = "";
    type Chg = { t: "cancel" | "move" | "removed"; emp: string | null; client: string; date: string; time: string; id: string };
    const chg: Chg[] = [];
    const insertedIds: string[] = [];
    const affectedDates = new Set<string>();

    // upsert pulled citas
    for (const c of citas) {
      if (!c.date || !c.time || !c.clientName) continue;
      affectedDates.add(c.date);
      const isCancelled = (c.status || "").toLowerCase().startsWith("cancel");
      const ex = exByDn.get(c.id);
      const base = {
        date: c.date, client: c.clientName, time: fmt(toMins(c.time)), time_mins: toMins(c.time),
        client_phone: c.clientPhone ?? null, service_name: c.serviceName ?? null,
        pending_amount: c.pendingAmount ? Number(c.pendingAmount) : null,
        cancelled: isCancelled, source: "dnsuite", dnsuite_id: c.id, dnsuite_synced_at: new Date().toISOString(),
      };
      if (ex) {
        const exr = ex as { id: string; employee: string | null; date: string; time_mins: number; cancelled: boolean };
        const { error } = await sb.from("appointments").update(base).eq("id", exr.id);
        if (error) { if (!firstErr) firstErr = "update: " + error.message; }
        else {
          updated++;
          if (isCancelled) {
            cancelled++;
            if (!exr.cancelled && exr.employee) chg.push({ t: "cancel", emp: exr.employee, client: c.clientName, date: c.date, time: fmt(toMins(c.time)), id: exr.id });
          } else if (exr.date !== c.date || exr.time_mins !== toMins(c.time)) {
            if (exr.employee) chg.push({ t: "move", emp: exr.employee, client: c.clientName, date: c.date, time: fmt(toMins(c.time)), id: exr.id });
          }
        }
      } else {
        const { error } = await sb.from("appointments").insert({ ...base, id: "dn_" + c.id, employee: null, cabin: null, no_show: false, walk_in: false, changed: "", swap_locked: false });
        if (error) { if (!firstErr) firstErr = "insert: " + error.message; }
        else { inserted++; if (!isCancelled) insertedIds.push("dn_" + c.id); }
      }
    }

    // auto-apply deletions: synced rows no longer in DNSuite → remove
    for (const [dn, row] of exByDn) {
      if (!pulledIds.has(dn)) {
        const rr = row as { id: string; employee: string | null; client: string; date: string; cancelled: boolean };
        await sb.from("appointments").delete().eq("id", rr.id);
        removed++; affectedDates.add(rr.date);
        if (rr.employee && !rr.cancelled) chg.push({ t: "removed", emp: rr.employee, client: rr.client, date: rr.date, time: "", id: rr.id });
      }
    }

    // assign any unassigned dnsuite citas, per affected day
    const buf = 30;
    for (const date of affectedDates) {
      const { data: dayRows } = await sb.from("appointments").select("id,time_mins,employee,cancelled").eq("date", date);
      const unassigned = (dayRows ?? []).filter((r: Record<string, unknown>) => !r.employee && !r.cancelled);
      if (!unassigned.length) continue;
      const wd = weekday(date);
      const rows = unassigned.map((r: Record<string, unknown>) => ({ id: r.id as string, t: r.time_mins as number }));
      const res = assign(rows, wd, emps, offByDate[date] ?? new Set(), ovByDate[date] ?? {}, buf);
      for (const [id, a] of Object.entries(res)) await sb.from("appointments").update({ employee: a.emp, cabin: a.cab }).eq("id", id);
    }

    // ── Notify about changes (push rides on the notifications trigger) ──
    try {
      const totalChanges = insertedIds.length + chg.length;
      if (totalChanges > 0) {
        const fdm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
        // Only ping employees about citas of today or tomorrow (Santo Domingo time)
        const sdNow = new Date(Date.now() - 4 * 3600 * 1000);
        const todaySD = sdNow.toISOString().slice(0, 10);
        const tomorrowSD = new Date(sdNow.getTime() + 86400000).toISOString().slice(0, 10);
        const dayWord = (d: string): string | null => d === todaySD ? "hoy" : d === tomorrowSD ? "mañana" : null;
        const notifs: { user_id: string; kind: string; title: string; body: string; link: string }[] = [];
        const { data: profs } = await sb.from("profiles").select("id,employee_name");
        const userByEmp = new Map<string, string>();
        for (const pr of (profs ?? []) as { id: string; employee_name: string | null }[]) {
          if (pr.employee_name) userByEmp.set(pr.employee_name, pr.id);
        }
        if (totalChanges <= 25) {
          if (insertedIds.length) {
            const { data: ins } = await sb.from("appointments").select("id,employee,client,date,time").in("id", insertedIds);
            for (const r of (ins ?? []) as { id: string; employee: string | null; client: string; date: string; time: string }[]) {
              const w = dayWord(r.date);
              if (!w) continue;
              const uid = r.employee ? userByEmp.get(r.employee) : undefined;
              if (uid) notifs.push({ user_id: uid, kind: "dnsuite_new", title: "Nueva cita asignada", body: `Se te asignó una cita ${w} a las ${r.time} — ${r.client}`, link: `apt:${r.id}:${r.date}` });
            }
          }
          for (const ch of chg) {
            const w = dayWord(ch.date);
            if (!w) continue;
            const uid = ch.emp ? userByEmp.get(ch.emp) : undefined;
            if (!uid) continue;
            const title = ch.t === "cancel" ? "Cita cancelada" : ch.t === "move" ? "Cita cambiada de hora" : "Cita eliminada";
            const body = ch.t === "cancel"
              ? `Tu cita de ${w} a las ${ch.time} fue cancelada — ${ch.client}`
              : ch.t === "move"
              ? `Tu cita de ${ch.client} cambió: ${w} a las ${ch.time}`
              : `Se eliminó tu cita de ${w} — ${ch.client}`;
            notifs.push({ user_id: uid, kind: "dnsuite_" + ch.t, title, body, link: ch.t === "removed" ? `date:${ch.date}` : `apt:${ch.id}:${ch.date}` });
          }
        }
        const cN = chg.filter(x => x.t === "cancel").length, mN = chg.filter(x => x.t === "move").length, rN = chg.filter(x => x.t === "removed").length;
        const digest = `+${insertedIds.length} nuevas · ${cN} canceladas · ${mN} movidas · ${rN} eliminadas`;
        const { data: adminsR } = await sb.from("user_roles").select("user_id").eq("role", "admin");
        for (const a of (adminsR ?? []) as { user_id: string }[]) {
          notifs.push({ user_id: a.user_id, kind: "dnsuite_sync", title: "Cambios desde DNSuite", body: digest, link: "" });
        }
        if (notifs.length) await sb.from("notifications").insert(notifs);
      }
    } catch (e) { console.error("notify error:", e); }

    const result = `pulled ${citas.length} · +${inserted} ~${updated} -${removed} cancel ${cancelled}` + (firstErr ? ` · ERROR ${firstErr}` : "");
    await sb.from("dnsuite_config").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", 1);
    return new Response(JSON.stringify({ ok: !firstErr, result, error: firstErr || undefined }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
