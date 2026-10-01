import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { clsx } from "clsx";
import { AlertTriangle, Bug, CheckCircle2, FlaskConical, Gamepad2, Play, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Ctx } from "../../pages/ProjectPage";
import { api, type Analysis, type Endpoint } from "../../lib/api";
import { Badge, Button, Card, ScoreDial, SeverityPill } from "../ui";
import { sampleBody } from "./MatrixTab";

type StepState = "idle" | "loading" | "ok" | "degraded" | "crash";
interface LogLine { id: number; t: number; text: string; kind: "req" | "ok" | "warn" | "bad" | "info" }
interface ClientState { steps: StepState[]; stepNote: string[]; sessions: number; ok: number; crashes: number; degraded: number; requests: number; retries: number; ms: number[]; log: LogLine[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fresh = (): ClientState => ({ steps: ["idle", "idle", "idle"], stepNote: ["", "", ""], sessions: 0, ok: 0, crashes: 0, degraded: 0, requests: 0, retries: 0, ms: [], log: [] });

function pickEndpoints(eps: Endpoint[]) {
  const list = eps.find((e) => e.method === "GET" && e.isList && /product|item|catalog/.test(e.path)) ?? eps.find((e) => e.method === "GET" && e.isList && !e.semantics.includes("health"));
  const detail = eps.find((e) => e.method === "GET" && /\{/.test(e.path) && /order/.test(e.path)) ?? eps.find((e) => e.method === "GET" && /\{/.test(e.path)) ?? eps.find((e) => e.method === "GET" && e !== list && !e.semantics.includes("health"));
  const write = eps.find((e) => e.method === "POST" && /pay|charge/.test(e.path)) ?? eps.find((e) => e.method === "POST" && e.semantics.includes("payment")) ?? eps.find((e) => e.method === "POST" && e.semantics.includes("order")) ?? eps.find((e) => e.method === "POST");
  return [list, detail, write].filter(Boolean) as Endpoint[];
}

function recordsOf(data: any, ep: Endpoint): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items) && ep.isList) return data.items;
  return [data];
}
function schemaTarget(ep: Endpoint) {
  const s = ep.successSchema;
  if (!s) return undefined;
  if (s.type === "array") return s.items;
  if (s.properties?.data?.items) return s.properties.data.items;
  return s;
}

/** What a typical, untested UI does: trusts the payload completely. */
function naiveRender(data: any, ep: Endpoint) {
  const t = schemaTarget(ep);
  const recs = recordsOf(data, ep);
  if (ep.isList && recs.length === 0) throw new Error("Blank screen: list rendered nothing (no empty state)");
  const req: string[] = t?.required ?? Object.keys(t?.properties ?? {}).slice(0, 3);
  for (const r of recs.slice(0, 3)) {
    if (r == null || typeof r !== "object") throw new TypeError("Cannot read properties of null");
    for (const f of req) {
      const decl = t?.properties?.[f]?.type;
      if (r[f] === undefined || r[f] === null) throw new TypeError(`Cannot read properties of undefined (reading '${f}')`);
      if ((decl === "number" || decl === "integer") && typeof r[f] !== "number") throw new TypeError(`${f}.toFixed is not a function`);
    }
  }
}

/** Boundary validation with coercion + placeholders. Returns false if the data is unusable. */
function validate(data: any, ep: Endpoint): { ok: boolean; repaired: boolean } {
  const t = schemaTarget(ep);
  const recs = recordsOf(data, ep);
  if (!t) return { ok: true, repaired: false };
  const req: string[] = t.required ?? [];
  let repaired = false;
  for (const r of recs) {
    if (!r || typeof r !== "object") return { ok: false, repaired };
    for (const f of req) {
      const decl = t.properties?.[f]?.type;
      if (r[f] === undefined || r[f] === null) {
        r[f] = decl === "number" || decl === "integer" ? 0 : decl === "boolean" ? false : "—";
        repaired = true;
      } else if ((decl === "number" || decl === "integer") && typeof r[f] !== "number") {
        const n = parseFloat(String(r[f]));
        r[f] = Number.isFinite(n) ? n : 0;
        repaired = true;
      }
    }
  }
  return { ok: true, repaired };
}

export default function PlaygroundTab({ ctx }: { ctx: Ctx }) {
  const nav = useNavigate();
  const eps = useMemo(() => pickEndpoints(ctx.endpoints), [ctx.endpoints]);
  const [naive, setNaive] = useState<ClientState>(fresh);
  const [good, setGood] = useState<ClientState>(fresh);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(6);
  const [analysis, setAnalysis] = useState<Analysis>();
  const [runId, setRunId] = useState<string>();
  const [prepping, setPrepping] = useState(false);
  const lineId = useRef(0);
  const cache = useRef(new Map<string, any>());
  const breaker = useRef({ fails: 0, openUntil: 0 });

  const push = (set: React.Dispatch<React.SetStateAction<ClientState>>, text: string, kind: LogLine["kind"]) => set((s) => ({ ...s, log: [...s.log.slice(-60), { id: lineId.current++, t: Date.now(), text, kind }] }));
  const pathFor = (ep: Endpoint, i: number) => ep.path.replace(/\{[^}]+\}/g, () => `ord_${1000 + i}`);

  async function beacon(clientId: string, ep: Endpoint, fault: string | null, handled: boolean, detail?: string, fallback?: string) {
    fetch(`${ctx.chaosUrl}/__chaos/outcome`, { method: "POST", headers: { "content-type": "application/json", "x-chaos-client": clientId }, body: JSON.stringify({ endpointKey: ep.key, path: ep.path, fault, handled, detail, fallback }) }).catch(() => undefined);
  }

  // ---------------- naive client ----------------
  async function naiveStep(ep: Endpoint, i: number): Promise<{ state: StepState; note: string }> {
    const set = setNaive;
    let lastFault: string | null = null;
    try {
      let data: any;
      for (let a = 0; a < 5; a++) {
        set((s) => ({ ...s, requests: s.requests + 1, retries: s.retries + (a > 0 ? 1 : 0) }));
        push(set, `${ep.method} ${pathFor(ep, i)}${a ? ` (retry ${a})` : ""}`, "req");
        const r = await fetch(`${ctx.chaosUrl}${pathFor(ep, i)}`, { method: ep.method, headers: { "x-chaos-client": "naive-client", ...(ep.method !== "GET" ? { "content-type": "application/json" } : {}) }, body: ep.method !== "GET" ? JSON.stringify({ ...sampleBody(ep.requestSchema), session: i }) : undefined });
        lastFault = r.headers.get("x-chaos-fault");
        if (r.status >= 500 || r.status === 429) {
          push(set, `← ${r.status} — retrying immediately`, "warn");
          continue; // no backoff, ignores Retry-After, no idempotency key
        }
        data = await r.json(); // throws on HTML / truncated JSON / empty body
        if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${data?.error?.message ?? "request failed"}`);
        break;
      }
      if (data === undefined) throw new Error("Gave up after 5 rapid retries");
      naiveRender(data, ep);
      push(set, `← 200 rendered`, "ok");
      beacon("naive-client", ep, lastFault, true);
      return { state: "ok", note: "" };
    } catch (e: any) {
      const msg = e?.name === "SyntaxError" ? `SyntaxError: ${String(e.message).slice(0, 60)}` : String(e?.message ?? e).slice(0, 90);
      push(set, `✗ ${msg}`, "bad");
      beacon("naive-client", ep, lastFault, false, msg);
      return { state: "crash", note: msg };
    }
  }

  // ---------------- resilient client ----------------
  async function goodStep(ep: Endpoint, i: number): Promise<{ state: StepState; note: string }> {
    const set = setGood;
    const key = crypto.randomUUID();
    let lastFault: string | null = null;
    const body = ep.method !== "GET" ? JSON.stringify({ ...sampleBody(ep.requestSchema), session: i }) : undefined;
    let refreshed = false;
    for (let a = 0; a < 4; a++) {
      if (Date.now() < breaker.current.openUntil) {
        push(set, `⚡ circuit open — skipping network`, "info");
        break;
      }
      set((s) => ({ ...s, requests: s.requests + 1, retries: s.retries + (a > 0 ? 1 : 0) }));
      push(set, `${ep.method} ${pathFor(ep, i)}${a ? ` (retry ${a})` : ""}`, "req");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      try {
        const r = await fetch(`${ctx.chaosUrl}${pathFor(ep, i)}`, { method: ep.method, signal: ctrl.signal, headers: { "x-chaos-client": "resilient-client", "idempotency-key": key, ...(body ? { "content-type": "application/json" } : {}) }, body });
        lastFault = r.headers.get("x-chaos-fault");
        if (r.status === 429 || r.status >= 500) {
          const ra = Number(r.headers.get("retry-after"));
          const wait = ra ? Math.min(ra * 1000, 3500) : Math.round(Math.random() * 250 * 2 ** a + 100);
          push(set, `← ${r.status} — ${ra ? `honoring Retry-After ${ra}s` : `backoff ${wait}ms (jitter)`}`, "warn");
          breaker.current.fails++;
          if (breaker.current.fails >= 6) breaker.current.openUntil = Date.now() + 4000;
          await sleep(wait);
          continue;
        }
        if (r.status === 401 && !refreshed) {
          refreshed = true;
          push(set, `← 401 — refreshing token once`, "warn");
          await sleep(150);
          continue;
        }
        const text = await r.text();
        if (r.status >= 400) {
          push(set, `← ${r.status} — non-retryable, showing message`, "warn");
          beacon("resilient-client", ep, lastFault, true, `${r.status} handled`, "friendly error message");
          return { state: "degraded", note: `Friendly ${r.status} message` };
        }
        if (!(r.headers.get("content-type") ?? "").includes("json") && text) throw new Error("non-JSON body");
        let data: any;
        try {
          data = text ? JSON.parse(text) : ep.isList ? [] : null;
        } catch {
          push(set, `← malformed JSON — treating as transient`, "warn");
          await sleep(Math.round(Math.random() * 200 * 2 ** a + 80));
          continue;
        }
        if (data == null) throw new Error("empty body");
        const v = validate(data, ep);
        breaker.current.fails = 0;
        if (ep.isList && recordsOf(data, ep).length === 0) {
          push(set, `← empty list — rendered empty state`, "ok");
          beacon("resilient-client", ep, lastFault, true, undefined, "empty state");
          return { state: "degraded", note: "Designed empty state" };
        }
        cache.current.set(ep.key, data);
        push(set, v.repaired ? `← 200 — repaired invalid fields at boundary` : `← ${r.status} rendered`, v.repaired ? "warn" : "ok");
        beacon("resilient-client", ep, lastFault, true, undefined, v.repaired ? "schema validation + placeholders" : undefined);
        return { state: v.repaired ? "degraded" : "ok", note: v.repaired ? "Placeholders for bad fields" : "" };
      } catch (e: any) {
        push(set, e?.name === "AbortError" ? `⏱ timed out after 2.5s — retrying` : `← ${String(e?.message ?? e)} — retrying`, "warn");
        await sleep(Math.round(Math.random() * 200 * 2 ** a + 100));
      } finally {
        clearTimeout(timer);
      }
    }
    if (cache.current.has(ep.key)) {
      push(set, `↺ served cached data`, "info");
      beacon("resilient-client", ep, lastFault, true, "retries exhausted", "cached data");
      return { state: "degraded", note: "Showing cached data" };
    }
    push(set, `⚠ retries exhausted — friendly error + retry button`, "warn");
    beacon("resilient-client", ep, lastFault, true, "retries exhausted", "friendly error");
    return { state: "degraded", note: "Friendly retry prompt" };
  }

  async function runClient(kind: "naive" | "good") {
    const set = kind === "naive" ? setNaive : setGood;
    for (let i = 0; i < sessions; i++) {
      const t0 = performance.now();
      set((s) => ({ ...s, steps: ["loading", "idle", "idle"], stepNote: ["", "", ""] }));
      let crashed = false;
      let degraded = false;
      for (let k = 0; k < eps.length; k++) {
        set((s) => ({ ...s, steps: s.steps.map((x, j) => (j === k ? "loading" : x)) as StepState[] }));
        const r = kind === "naive" ? await naiveStep(eps[k], i) : await goodStep(eps[k], i);
        set((s) => ({ ...s, steps: s.steps.map((x, j) => (j === k ? r.state : x)) as StepState[], stepNote: s.stepNote.map((x, j) => (j === k ? r.note : x)) }));
        if (r.state === "crash") {
          crashed = true;
          if (kind === "good") break; // the naive user keeps clicking around after a crash
        }
        if (r.state === "degraded") degraded = true;
      }
      const ms = Math.round(performance.now() - t0);
      set((s) => ({ ...s, sessions: s.sessions + 1, ok: s.ok + (!crashed ? 1 : 0), crashes: s.crashes + (crashed ? 1 : 0), degraded: s.degraded + (degraded && !crashed ? 1 : 0), ms: [...s.ms, ms] }));
      await sleep(350);
    }
  }

  async function prepare() {
    setPrepping(true);
    for (const ep of eps) await api.bulk(ctx.project.id, { endpointKey: ep.key, enabled: true });
    await api.patchProject(ctx.project.id, { chaos: { armed: true, intensity: 0.6 } });
    ctx.setProject((p) => (p ? { ...p, chaos: { armed: true, intensity: 0.6 } } : p));
    await ctx.reload();
    setPrepping(false);
  }

  async function run() {
    setRunning(true);
    setAnalysis(undefined);
    setNaive(fresh());
    setGood(fresh());
    cache.current.clear();
    breaker.current = { fails: 0, openUntil: 0 };
    try {
      const { run } = await api.startRun(ctx.project.id, `Playground · naive vs resilient · ${sessions} sessions`);
      setRunId(run.id);
      await sleep(1700); // let data-plane caches pick up the active run
      await Promise.all([runClient("naive"), runClient("good")]);
      await sleep(800);
      const stopped = await api.stopRun(ctx.project.id, run.id);
      setAnalysis(stopped.run.analysis as Analysis);
    } finally {
      setRunning(false);
    }
  }

  const naiveReport = analysis?.clients.find((c) => c.clientId === "naive-client");
  const goodReport = analysis?.clients.find((c) => c.clientId === "resilient-client");

  if (eps.length < 2)
    return <Card className="p-8 text-muted">The playground needs at least one GET list endpoint and one write endpoint. Try the "Acme Store & Payments" sample.</Card>;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-chaos-orange/15 text-chaos-orange"><Gamepad2 className="h-5 w-5" /></div>
        <div className="flex-1">
          <div className="font-semibold">Same API. Same chaos. Two clients.</div>
          <p className="mt-1 text-sm text-muted">
            Each session runs a real user flow against your chaos URL: {eps.map((e, i) => <span key={e.key}><code className="font-mono text-xs text-fg/90">{e.key}</code>{i < eps.length - 1 ? " → " : ""}</span>)}. The <span className="text-chaos-red">naive client</span> trusts everything; the <span className="text-mint">resilient client</span> uses timeouts, jittered backoff, Retry-After, Idempotency-Keys, boundary validation, a circuit breaker and cached fallbacks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={prepare} loading={prepping} icon={<FlaskConical className="h-3.5 w-3.5" />}>Arm demo chaos (60%)</Button>
          <select value={sessions} onChange={(e) => setSessions(Number(e.target.value))} className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs outline-none">
            {[3, 6, 10, 15].map((n) => <option key={n} value={n}>{n} sessions</option>)}
          </select>
          <Button onClick={run} loading={running} icon={<Play className="h-4 w-4" />}>Run experiment</Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ClientPane title="Naive client" subtitle="fetch → res.json() → render" color="#ff3d5a" icon={<Bug className="h-4 w-4" />} st={naive} eps={eps} report={naiveReport} />
        <ClientPane title="Resilient client" subtitle="timeout · backoff+jitter · Retry-After · Idempotency-Key · validation · breaker · cache" color="#22d3a5" icon={<ShieldCheck className="h-4 w-4" />} st={good} eps={eps} report={goodReport} />
      </div>

      <AnimatePresence>
        {analysis && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-dim">Server-side verdict · run {runId}</div>
                  <div className="mt-1 text-xl font-semibold">ChaosLab watched {analysis.totals.requests} requests, {analysis.totals.faults} injected faults, {analysis.totals.retries} retries.</div>
                </div>
                <Button onClick={() => nav(`/app/p/${ctx.project.id}/report?run=${runId}`)} icon={<ShieldCheck className="h-4 w-4" />}>Open full AI resilience report</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientPane({ title, subtitle, color, icon, st, eps, report }: { title: string; subtitle: string; color: string; icon: React.ReactNode; st: ClientState; eps: Endpoint[]; report?: Analysis["clients"][number] }) {
  const avg = st.ms.length ? Math.round(st.ms.reduce((a, b) => a + b, 0) / st.ms.length) : 0;
  return (
    <Card className="overflow-hidden" style={{ borderColor: `${color}40` }}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3" style={{ background: `${color}0d` }}>
        <div>
          <div className="flex items-center gap-2 font-semibold" style={{ color }}>{icon} {title}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-dim">{subtitle}</div>
        </div>
        {report && <ScoreDial score={report.score} grade={report.grade} size={74} />}
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[190px_1fr]">
        <div className="rounded-[26px] border-4 border-[#22222f] bg-[#0b0b12] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] text-dim"><Smartphone className="h-3 w-3" /> acme app</div>
          {eps.map((e, i) => (
            <div key={e.key} className={clsx("mb-2 rounded-xl border p-2.5 text-[11px] transition", st.steps[i] === "crash" ? "border-chaos-red/60 bg-chaos-red/10" : st.steps[i] === "ok" ? "border-mint/40 bg-mint/[0.06]" : st.steps[i] === "degraded" ? "border-warn/40 bg-warn/[0.06]" : "border-line bg-raised/40")}>
              <div className="flex items-center justify-between">
                <span className="truncate font-mono text-[10px] text-muted">{e.method} {e.path.split("/").slice(-1)[0] || e.path}</span>
                {st.steps[i] === "loading" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-dim border-t-fg" />}
                {st.steps[i] === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-mint" />}
                {st.steps[i] === "degraded" && <AlertTriangle className="h-3.5 w-3.5 text-warn" />}
                {st.steps[i] === "crash" && <XCircle className="h-3.5 w-3.5 text-chaos-red" />}
              </div>
              {st.steps[i] === "crash" && <div className="mt-1 line-clamp-2 font-mono text-[9.5px] text-chaos-red">{st.stepNote[i] || "Crashed"}</div>}
              {st.steps[i] === "degraded" && <div className="mt-1 text-[9.5px] text-warn">{st.stepNote[i]}</div>}
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { k: "sessions", v: st.sessions },
              { k: "completed", v: st.ok, c: "#22d3a5" },
              { k: "crashed", v: st.crashes, c: st.crashes ? "#ff3d5a" : undefined },
              { k: "avg ms", v: avg },
            ].map((x) => (
              <div key={x.k} className="rounded-lg border border-line bg-raised/40 py-2">
                <div className="font-mono text-lg font-bold tabular-nums" style={{ color: x.c }}>{x.v}</div>
                <div className="text-[10px] uppercase tracking-wider text-dim">{x.k}</div>
              </div>
            ))}
          </div>
          <div className="scrollbar-thin h-56 overflow-y-auto rounded-xl border border-line bg-[#09090f] p-3 font-mono text-[10.5px] leading-[1.6]">
            {st.log.length === 0 && <div className="text-dim">Waiting to run…</div>}
            {st.log.map((l) => (
              <div key={l.id} className={clsx("truncate", l.kind === "req" && "text-muted", l.kind === "ok" && "text-mint", l.kind === "warn" && "text-warn", l.kind === "bad" && "text-chaos-red", l.kind === "info" && "text-info")}>{l.text}</div>
            ))}
          </div>
          {report && (
            <div className="space-y-1.5">
              {report.findings.slice(0, 3).map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-xs"><SeverityPill s={f.severity} /> <span className="truncate text-muted">{f.title}</span></div>
              ))}
              {report.findings.length === 0 && report.strengths.slice(0, 3).map((s) => (
                <div key={s.title + s.endpointKey} className="flex items-center gap-2 text-xs"><Badge color="#22d3a5">GOOD</Badge> <span className="truncate text-muted">{s.title}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
