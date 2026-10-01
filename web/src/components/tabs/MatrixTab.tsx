import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { clsx } from "clsx";
import { Bot, Crosshair, ListFilter, RefreshCw, Send, Sparkles, X } from "lucide-react";
import type { Ctx } from "../../pages/ProjectPage";
import { api, SEV_COLOR, type Scenario } from "../../lib/api";
import { AiExplain } from "../AiExplain";
import { Badge, Button, Card, CodeBlock, Method, SeverityPill, StatusCode, Toggle } from "../ui";

const FAULT_ORDER = ["latency", "timeout", "http_500", "http_502_html", "http_503", "rate_limit_429", "intermittent", "malformed_json", "missing_fields", "wrong_types", "schema_drift", "empty_body", "payload_bloat", "auth_401", "conflict_409"];

export default function MatrixTab({ ctx }: { ctx: Ctx }) {
  const { project, endpoints, scenarios, faults, setScenarios } = ctx;
  const [sel, setSel] = useState<Scenario>();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [busy, setBusy] = useState<string>();

  const cols = useMemo(() => FAULT_ORDER.filter((f) => scenarios.some((s) => s.fault === f)), [scenarios]);
  const byCell = useMemo(() => {
    const m = new Map<string, Scenario>();
    for (const s of scenarios) m.set(`${s.endpointKey}|${s.fault}`, s);
    return m;
  }, [scenarios]);
  const rows = endpoints.filter((e) => scenarios.some((s) => s.endpointKey === e.key));

  async function toggle(s: Scenario, enabled = !s.enabled) {
    setScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    if (sel?.id === s.id) setSel({ ...s, enabled });
    await api.patchScenario(project.id, s.id, { enabled });
  }
  async function preset(p: "critical" | "all" | "none") {
    setBusy(p);
    await api.bulk(project.id, { preset: p });
    await ctx.reload();
    setBusy(undefined);
  }

  const aiCount = scenarios.filter((s) => s.source === "ai").length;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-chaos-violet/15 text-chaos-violet"><Bot className="h-5 w-5" /></div>
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-dim">AI risk profile</div>
          <p className="mt-1 text-sm leading-relaxed text-fg/90">{project.ai.summary ?? "Analyzing…"}</p>
          <div className="mt-2 text-xs text-dim">{aiCount} AI-authored scenarios · {scenarios.length - aiCount} rule-based baseline</div>
        </div>
        <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={async () => { await api.regenerate(project.id); await ctx.reload(); }}>Regenerate with AI</Button>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-dim"><ListFilter className="h-3.5 w-3.5" /> Arm</span>
          <Button size="sm" variant="outline" loading={busy === "critical"} onClick={() => preset("critical")}>Critical + high</Button>
          <Button size="sm" variant="outline" loading={busy === "all"} onClick={() => preset("all")}>Everything</Button>
          <Button size="sm" variant="ghost" loading={busy === "none"} onClick={() => preset("none")}>Disarm all</Button>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 text-[11px] text-dim md:flex">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEV_COLOR[s] }} /> {s}</span>
            ))}
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dim" /> disarmed</span>
          </div>
          <div className="flex rounded-lg border border-line p-0.5 text-xs">
            {(["grid", "list"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={clsx("rounded-md px-3 py-1 cursor-pointer", view === v ? "bg-raised text-fg" : "text-muted")}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="scrollbar-thin overflow-x-auto p-4">
          {view === "grid" ? (
            <table className="w-full border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-panel" />
                  {cols.map((c) => (
                    <th key={c} className="px-1 pb-2 text-center align-bottom" title={faults[c]?.description}>
                      <div className="font-mono text-[10px] font-semibold tracking-wide text-muted">{faults[c]?.short ?? c}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((ep) => (
                  <tr key={ep.key}>
                    <td className="sticky left-0 z-10 bg-panel pr-3 whitespace-nowrap">
                      <Method m={ep.method} /> <span className="font-mono text-xs text-fg/90">{ep.path}</span>
                    </td>
                    {cols.map((c) => {
                      const s = byCell.get(`${ep.key}|${c}`);
                      if (!s) return <td key={c}><div className="h-8 min-w-9 rounded-md bg-[#101019]" /></td>;
                      const col = SEV_COLOR[s.severity];
                      return (
                        <td key={c}>
                          <motion.button
                            whileHover={{ scale: 1.12 }}
                            whileTap={{ scale: 0.92 }}
                            onClick={() => setSel(s)}
                            onDoubleClick={() => toggle(s)}
                            title={`${s.title} — click for details, double-click to toggle`}
                            className={clsx("relative h-8 w-full min-w-9 rounded-md border cursor-pointer", sel?.id === s.id && "ring-2 ring-white/70")}
                            style={{ background: s.enabled ? `${col}cc` : `${col}14`, borderColor: s.enabled ? col : `${col}55`, boxShadow: s.enabled ? `0 0 14px ${col}55` : undefined }}
                          >
                            {s.source === "ai" && <Sparkles className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-white/80" />}
                          </motion.button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="divide-y divide-line">
              {scenarios.map((s) => (
                <div key={s.id} className={clsx("flex items-center gap-3 py-2.5 cursor-pointer", sel?.id === s.id && "bg-white/[0.03]")} onClick={() => setSel(s)}>
                  <Toggle on={s.enabled} onChange={(v) => toggle(s, v)} />
                  <SeverityPill s={s.severity} />
                  <Badge color="#ff8a00">{faults[s.fault]?.short ?? s.fault}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{s.title}</div>
                    <div className="truncate font-mono text-[11px] text-dim">{s.endpointKey}</div>
                  </div>
                  {s.source === "ai" && <Sparkles className="h-3.5 w-3.5 text-chaos-violet" />}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <AnimatePresence mode="wait">
            {sel ? <Detail key={sel.id} s={sel} ctx={ctx} onClose={() => setSel(undefined)} onToggle={(v) => toggle(sel, v)} /> : (
              <Card className="p-6 text-sm text-muted">
                <Crosshair className="mb-3 h-6 w-6 text-chaos-orange" />
                <div className="font-semibold text-fg">Select a cell</div>
                <p className="mt-1">Each cell is a failure scenario for one endpoint. Filled cells are armed: when chaos is on, matching requests get that fault with the configured intensity. Double-click to toggle. <Sparkles className="inline h-3 w-3 text-chaos-violet" /> = AI-authored (Bedrock).</p>
              </Card>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Detail({ s, ctx, onClose, onToggle }: { s: Scenario; ctx: Ctx; onClose: () => void; onToggle: (v: boolean) => void }) {
  const f = ctx.faults[s.fault];
  const [fire, setFire] = useState<{ status: number; ms: number; headers: [string, string][]; body: string } | null>(null);
  const [firing, setFiring] = useState(false);
  const ep = ctx.endpoints.find((e) => e.key === s.endpointKey);
  const samplePath = s.path.replace(/\{[^}]+\}/g, (m) => (m.toLowerCase().includes("id") ? "123" : "sample"));

  async function fireOnce() {
    setFiring(true);
    const t0 = performance.now();
    try {
      const r = await fetch(`${ctx.chaosUrl}${samplePath}`, {
        method: s.method,
        headers: { "x-chaos-scenario": s.id, "x-chaos-client": "dashboard", ...(s.method !== "GET" ? { "content-type": "application/json" } : {}) },
        body: s.method !== "GET" ? JSON.stringify(sampleBody(ep?.requestSchema)) : undefined,
      });
      const body = await r.text();
      setFire({ status: r.status, ms: Math.round(performance.now() - t0), headers: [...r.headers.entries()].filter(([k]) => k.startsWith("x-chaos") || k === "retry-after" || k === "content-type" || k.startsWith("x-ratelimit") || k === "www-authenticate"), body: body.slice(0, 1500) });
    } catch (e: any) {
      setFire({ status: 0, ms: Math.round(performance.now() - t0), headers: [], body: String(e) });
    } finally {
      setFiring(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}>
      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityPill s={s.severity} />
              <Badge color="#ff8a00">{f?.label ?? s.fault}</Badge>
              {s.source === "ai" && <Badge color="#b14dff"><Sparkles className="h-3 w-3" /> AI</Badge>}
            </div>
            <div className="mt-2 font-semibold leading-snug">{s.title}</div>
            <div className="mt-1 font-mono text-xs text-dim">{s.endpointKey}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-dim hover:text-fg cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-dim">Why it matters</div>
          <p className="mt-1 text-sm text-muted">{s.rationale}</p>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-dim">Expected handling</div>
          <p className="mt-1 text-sm text-mint/90">{s.expectedHandling}</p>
        </div>
        {Object.keys(s.params ?? {}).length > 0 && (
          <div className="flex flex-wrap gap-1.5">{Object.entries(s.params).map(([k, v]) => <Badge key={k}>{k}={String(v)}</Badge>)}</div>
        )}
        <div className="flex items-center justify-between rounded-xl border border-line bg-raised/50 px-3 py-2.5">
          <Toggle on={s.enabled} onChange={onToggle} label={s.enabled ? "Armed" : "Disarmed"} />
          <Button size="sm" onClick={fireOnce} loading={firing} icon={<Send className="h-3.5 w-3.5" />}>Fire once</Button>
        </div>
        {fire && (
          <div className="space-y-2 rounded-xl border border-line bg-[#0a0a12] p-3">
            <div className="flex items-center justify-between text-xs">
              <span><Method m={s.method} /> <span className="font-mono text-muted">{samplePath}</span></span>
              <span className="flex items-center gap-2"><StatusCode s={fire.status} /> <span className="font-mono text-dim">{fire.ms} ms</span></span>
            </div>
            {fire.headers.map(([k, v]) => <div key={k} className="truncate font-mono text-[11px]"><span className="text-chaos-orange">{k}</span>: <span className="text-muted">{v}</span></div>)}
            <CodeBlock code={fire.body || "(empty body)"} className="max-h-48 overflow-auto" />
          </div>
        )}
        <AiExplain projectId={ctx.project.id} input={{ scenarioId: s.id }} />
      </Card>
    </motion.div>
  );
}

export function sampleBody(schema: any): any {
  if (!schema?.properties) return { demo: true };
  const out: any = {};
  for (const [k, v] of Object.entries<any>(schema.properties)) {
    out[k] = v.type === "number" ? 49.99 : v.type === "integer" ? 1 : v.type === "boolean" ? true : v.type === "object" ? {} : k.toLowerCase().includes("currency") ? "USD" : `${k}_demo`;
  }
  return out;
}
