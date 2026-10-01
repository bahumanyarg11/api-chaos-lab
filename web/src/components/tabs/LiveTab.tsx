import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Pause, Play, RotateCcw, Zap, X, Radio } from "lucide-react";
import type { Ctx } from "../../pages/ProjectPage";
import { api, type ChaosEvent } from "../../lib/api";
import { AiExplain } from "../AiExplain";
import { Badge, Button, Card, CodeBlock, Empty, Method, Stat, StatusCode } from "../ui";
import { sampleBody } from "./MatrixTab";

const FAULT_COLORS: Record<string, string> = { latency: "#4da3ff", timeout: "#b14dff", http_500: "#ff3d5a", http_502_html: "#ff3d5a", http_503: "#ff5f7a", rate_limit_429: "#ff8a00", intermittent: "#ff3d5a", malformed_json: "#ffb020", missing_fields: "#ffb020", wrong_types: "#ffcf66", schema_drift: "#b14dff", empty_body: "#4da3ff", payload_bloat: "#4da3ff", auth_401: "#ff8a00", conflict_409: "#ffb020" };

export default function LiveTab({ ctx }: { ctx: Ctx }) {
  const { project } = ctx;
  const [events, setEvents] = useState<ChaosEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [sel, setSel] = useState<ChaosEvent>();
  const [blasting, setBlasting] = useState(false);
  const lastTs = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    api.events(project.id).then((r) => {
      if (!alive) return;
      setEvents(r.events);
      lastTs.current = r.events.length ? r.events[r.events.length - 1].ts : 0;
    });
    const t = setInterval(async () => {
      if (paused) return;
      try {
        const r = await api.events(project.id, lastTs.current || Date.now() - 60_000);
        if (r.events.length) {
          lastTs.current = r.events[r.events.length - 1].ts;
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...r.events.filter((e) => !seen.has(e.id))].slice(-400);
          });
        }
      } catch {
        /* transient */
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [project.id, paused]);

  const reqs = events.filter((e) => e.method !== "OUTCOME");
  const stats = useMemo(() => {
    const lat = reqs.map((e) => e.latencyMs).sort((a, b) => a - b);
    const faults = reqs.filter((e) => e.fault).length;
    return { n: reqs.length, faults, err: reqs.length ? reqs.filter((e) => e.status >= 400).length / reqs.length : 0, p95: lat.length ? lat[Math.floor(lat.length * 0.95)] : 0, clients: new Set(reqs.map((e) => e.clientId)).size };
  }, [events]);

  const series = useMemo(() => {
    if (!reqs.length) return [];
    const start = reqs[0].ts;
    const end = reqs[reqs.length - 1].ts;
    const bucket = Math.max(1000, Math.ceil((end - start) / 40 / 1000) * 1000);
    const m = new Map<number, { t: number; healthy: number; faulted: number }>();
    for (const e of reqs) {
      const k = Math.floor((e.ts - start) / bucket);
      const b = m.get(k) ?? { t: start + k * bucket, healthy: 0, faulted: 0 };
      if (e.fault) b.faulted++;
      else b.healthy++;
      m.set(k, b);
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [events]);

  const byFault = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of reqs) if (e.fault) m.set(e.fault, (m.get(e.fault) ?? 0) + 1);
    return [...m.entries()].map(([fault, count]) => ({ fault, count })).sort((a, b) => b.count - a.count);
  }, [events]);

  async function blast() {
    setBlasting(true);
    const eps = ctx.endpoints.filter((e) => ctx.scenarios.some((s) => s.endpointKey === e.key && s.enabled));
    const list = eps.length ? eps : ctx.endpoints;
    await Promise.all(
      Array.from({ length: 16 }, async (_, i) => {
        const ep = list[i % list.length];
        const path = ep.path.replace(/\{[^}]+\}/g, () => String(100 + i));
        try {
          const ctrl = new AbortController();
          setTimeout(() => ctrl.abort(), 4000);
          const r = await fetch(`${ctx.chaosUrl}${path}`, { method: ep.method, signal: ctrl.signal, headers: { "x-chaos-client": "traffic-generator", ...(ep.method !== "GET" ? { "content-type": "application/json", "idempotency-key": crypto.randomUUID() } : {}) }, body: ep.method !== "GET" ? JSON.stringify(sampleBody(ep.requestSchema)) : undefined });
          await r.text();
        } catch {
          /* aborted */
        }
      }),
    );
    setBlasting(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className={`h-2 w-2 rounded-full ${paused ? "bg-dim" : "bg-mint pulse-ring"}`} /> {paused ? "Paused" : "Streaming requests to"} <code className="font-mono text-xs text-fg/80">{ctx.chaosUrl}/*</code>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={blast} loading={blasting} icon={<Zap className="h-3.5 w-3.5 text-chaos-orange" />}>Send 16 test requests</Button>
          <Button size="sm" variant="outline" onClick={() => setPaused(!paused)} icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}>{paused ? "Resume" : "Pause"}</Button>
          <Button size="sm" variant="ghost" onClick={async () => { await api.reset(project.id); setEvents([]); lastTs.current = Date.now(); }} icon={<RotateCcw className="h-3.5 w-3.5" />}>Reset window</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Requests" value={stats.n} />
        <Stat label="Faults injected" value={stats.faults} color="#ff8a00" />
        <Stat label="Error rate" value={`${(stats.err * 100).toFixed(0)}%`} color={stats.err > 0.3 ? "#ff3d5a" : undefined} />
        <Stat label="p95 latency" value={`${stats.p95} ms`} />
        <Stat label="Clients seen" value={stats.clients} />
      </div>

      {reqs.length === 0 ? (
        <Empty icon={<Radio className="h-8 w-8" />} title="Waiting for traffic">
          Point your app at the chaos URL, open the Playground, or click "Send 16 test requests".
        </Empty>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Traffic · healthy vs faulted</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3a5" stopOpacity={0.5} /><stop offset="1" stopColor="#22d3a5" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff3d5a" stopOpacity={0.6} /><stop offset="1" stopColor="#ff3d5a" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1d1d2c" vertical={false} />
                    <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })} stroke="#6b6b82" fontSize={11} />
                    <YAxis stroke="#6b6b82" fontSize={11} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={{ background: "#161622", border: "1px solid #25253a", borderRadius: 10, fontSize: 12 }} labelFormatter={(t) => new Date(t as number).toLocaleTimeString()} />
                    <Area type="monotone" dataKey="healthy" stackId="1" stroke="#22d3a5" fill="url(#gh)" />
                    <Area type="monotone" dataKey="faulted" stackId="1" stroke="#ff3d5a" fill="url(#gf)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Faults by type</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byFault} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" stroke="#6b6b82" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="fault" stroke="#6b6b82" fontSize={10} width={100} />
                    <Tooltip cursor={{ fill: "#ffffff08" }} contentStyle={{ background: "#161622", border: "1px solid #25253a", borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {byFault.map((b) => <Cell key={b.fault} fill={FAULT_COLORS[b.fault] ?? "#ff8a00"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
            <Card className="overflow-hidden">
              <div className="grid grid-cols-[86px_120px_1fr_120px_56px_70px] gap-2 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-dim">
                <span>time</span><span>client</span><span>request</span><span>fault</span><span>status</span><span className="text-right">latency</span>
              </div>
              <div className="scrollbar-thin max-h-[520px] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {[...events].reverse().slice(0, 200).map((e) => (
                    <motion.button
                      key={e.id}
                      initial={{ opacity: 0, backgroundColor: e.fault ? "rgba(255,61,90,0.18)" : "rgba(34,211,165,0.12)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                      transition={{ duration: 1.2 }}
                      onClick={() => setSel(e)}
                      className={`grid w-full grid-cols-[86px_120px_1fr_120px_56px_70px] items-center gap-2 border-b border-line/50 px-4 py-2 text-left text-xs hover:bg-white/[0.03] cursor-pointer ${sel?.id === e.id ? "bg-white/[0.05]" : ""}`}
                    >
                      <span className="font-mono text-dim">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
                      <span className="truncate font-mono text-muted">{e.clientId}</span>
                      <span className="truncate"><Method m={e.method} /> <span className="font-mono text-fg/85">{e.path}</span></span>
                      <span className="truncate">
                        {e.method === "OUTCOME" ? <Badge color={e.outcome?.handled ? "#22d3a5" : "#ff3d5a"}>{e.outcome?.handled ? "handled" : "crashed"}</Badge> : e.fault ? <Badge color={FAULT_COLORS[e.fault] ?? "#ff8a00"}>{ctx.faults[e.fault]?.short ?? e.fault}</Badge> : <span className="text-dim">—</span>}
                      </span>
                      <StatusCode s={e.status} />
                      <span className="text-right font-mono text-muted">{e.method === "OUTCOME" ? "" : `${e.latencyMs}ms`}</span>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </Card>
            <div className="lg:sticky lg:top-20 lg:self-start">
              {sel ? (
                <Card className="space-y-3 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-mono text-xs text-dim">{sel.id}</div>
                      <div className="mt-1 font-semibold"><Method m={sel.method} /> <span className="font-mono text-sm">{sel.path}</span></div>
                    </div>
                    <button onClick={() => setSel(undefined)} className="text-dim hover:text-fg cursor-pointer"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusCode s={sel.status} />
                    {sel.fault && <Badge color={FAULT_COLORS[sel.fault]}>{ctx.faults[sel.fault]?.label ?? sel.fault}</Badge>}
                    {sel.forced && <Badge color="#4da3ff">forced</Badge>}
                    {sel.idempotencyKey ? <Badge color="#22d3a5">Idempotency-Key ✓</Badge> : sel.method === "POST" ? <Badge color="#ff3d5a">no Idempotency-Key</Badge> : null}
                  </div>
                  {sel.note && <div className="text-sm text-muted">{sel.note}</div>}
                  {sel.outcome && <div className="text-sm text-muted">Client reported: {sel.outcome.handled ? "handled" : "unhandled"} {sel.outcome.detail ? `— ${sel.outcome.detail}` : ""} {sel.outcome.fallback ? `(fallback: ${sel.outcome.fallback})` : ""}</div>}
                  <CodeBlock code={JSON.stringify(sel, null, 2)} className="max-h-56 overflow-auto" />
                  {sel.fault && <AiExplain projectId={project.id} input={{ eventId: sel.id, eventTs: sel.ts }} />}
                </Card>
              ) : (
                <Card className="p-5 text-sm text-muted">Click any request to inspect it and ask Bedrock what went wrong and how your client should handle it.</Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
