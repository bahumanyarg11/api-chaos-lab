import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { clsx } from "clsx";
import { Bot, CheckCircle2, ChevronDown, FileText, History, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import type { Ctx } from "../../pages/ProjectPage";
import { api, modelLabel, waitJob, type AiReport, type Analysis, type Finding, type Run } from "../../lib/api";
import { AiExplain } from "../AiExplain";
import { Badge, Button, Card, CodeBlock, Empty, ScoreDial, SeverityPill, Spinner, Stat } from "../ui";

export default function ReportTab({ ctx }: { ctx: Ctx }) {
  const [params, setParams] = useSearchParams();
  const runParam = params.get("run") ?? undefined;
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string | undefined>(runParam);
  const [analysis, setAnalysis] = useState<Analysis>();
  const [loading, setLoading] = useState(false);
  const [narr, setNarr] = useState<{ report: AiReport; model?: string }>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string>();

  useEffect(() => {
    api.runs(ctx.project.id).then((r) => setRuns(r.runs)).catch(() => undefined);
  }, [ctx.project.id]);

  async function load() {
    setLoading(true);
    setNarr(undefined);
    try {
      if (runId) {
        const { run } = await api.run(ctx.project.id, runId);
        setAnalysis(run.analysis);
        if (run.ai?.narrative) setNarr({ report: run.ai.narrative, model: run.ai.model });
        else if (run.ai?.status === "pending") pollRun(runId);
      } else {
        const { analysis } = await api.analysis(ctx.project.id);
        setAnalysis(analysis);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [runId]);

  async function pollRun(rid: string) {
    setAiBusy(true);
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { run } = await api.run(ctx.project.id, rid);
      if (run.ai?.narrative) {
        setNarr({ report: run.ai.narrative, model: run.ai.model });
        break;
      }
    }
    setAiBusy(false);
  }

  async function generate() {
    setAiBusy(true);
    setAiErr(undefined);
    try {
      const { jobId } = await api.report(ctx.project.id);
      const { result, model } = await waitJob<{ narrative: AiReport; analysis: Analysis }>(jobId);
      setNarr({ report: result.narrative, model });
      setAnalysis(result.analysis);
    } catch (e: any) {
      setAiErr(e.message);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-wider text-dim"><History className="h-3.5 w-3.5" /> Runs</div>
        <button onClick={() => { setRunId(undefined); setParams({}); }} className={clsx("w-full rounded-xl border px-3 py-2.5 text-left text-sm cursor-pointer", !runId ? "chaos-border" : "border-line bg-raised/40 hover:border-white/20")}>
          <div className="font-medium">Live window</div>
          <div className="text-xs text-dim">all traffic since last reset</div>
        </button>
        {runs.map((r) => (
          <button key={r.id} onClick={() => { setRunId(r.id); setParams({ run: r.id }); }} className={clsx("w-full rounded-xl border px-3 py-2.5 text-left text-sm cursor-pointer", runId === r.id ? "chaos-border" : "border-line bg-raised/40 hover:border-white/20")}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{r.label}</span>
              {r.score != null && <span className="font-mono text-xs" style={{ color: r.score >= 80 ? "#22d3a5" : r.score >= 50 ? "#ffb020" : "#ff3d5a" }}>{r.score}</span>}
            </div>
            <div className="text-xs text-dim">{new Date(r.startedAt).toLocaleString()} · {r.status}</div>
          </button>
        ))}
      </div>

      <div className="min-w-0 space-y-6">
        {loading && <div className="flex items-center gap-2 text-muted"><Spinner /> Analyzing traffic…</div>}
        {!loading && analysis && analysis.totals.requests === 0 && (
          <Empty icon={<FileText className="h-8 w-8" />} title="No traffic analyzed yet">Run the Playground experiment or point your app at the chaos URL, then come back for the report.</Empty>
        )}
        {!loading && analysis && analysis.totals.requests > 0 && (
          <>
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-8">
                <ScoreDial score={analysis.overall.score} grade={analysis.overall.grade} size={150} label="Overall resilience" />
                <div className="flex flex-1 flex-wrap gap-6">
                  {analysis.clients.filter((c) => c.score != null).slice(0, 4).map((c) => (
                    <ScoreDial key={c.clientId} score={c.score} grade={c.grade} size={104} label={c.clientId} />
                  ))}
                </div>
                <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load}>Refresh</Button>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Requests" value={analysis.totals.requests} />
                <Stat label="Faults injected" value={analysis.totals.faults} color="#ff8a00" />
                <Stat label="Client retries" value={analysis.totals.retries} />
                <Stat label="p95 latency" value={`${analysis.totals.p95}ms`} />
                <Stat label="Chaos coverage" value={`${analysis.coverage.exercised}/${analysis.coverage.enabled}`} sub="armed scenarios hit" />
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5 text-chaos-violet" /> AI resilience report</div>
                {narr ? <Badge color="#b14dff">{modelLabel(narr.model)}</Badge> : (
                  <Button onClick={generate} loading={aiBusy} icon={<Sparkles className="h-4 w-4" />}>{aiBusy ? "Bedrock is writing…" : "Generate with Bedrock"}</Button>
                )}
              </div>
              {aiErr && <div className="mt-3 text-sm text-chaos-red">{aiErr}</div>}
              {aiBusy && !narr && <div className="mt-4 h-24 animate-pulse rounded-xl bg-raised/60" />}
              {narr && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-5">
                  <div className="rounded-xl chaos-border p-4 text-lg font-semibold">{narr.report.verdict}</div>
                  <p className="text-sm leading-relaxed text-muted">{narr.report.executiveSummary}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {narr.report.topRisks.map((r, i) => (
                      <div key={i} className="rounded-xl border border-line bg-raised/40 p-4">
                        <div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-chaos-red" /><div className="font-semibold leading-snug">{r.title}</div></div>
                        <div className="mt-1 font-mono text-[11px] text-dim">{r.endpointKey}</div>
                        <p className="mt-2 text-sm text-muted">{r.why}</p>
                        <p className="mt-2 text-sm text-mint/90">→ {r.fix}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Highest-leverage fix: {narr.report.codeFix.title}</div>
                    <CodeBlock code={narr.report.codeFix.snippet} lang={narr.report.codeFix.language} />
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Next experiments</div>
                    <ul className="space-y-1.5 text-sm text-muted">{narr.report.nextExperiments.map((x, i) => <li key={i} className="flex gap-2"><span className="text-chaos-orange">›</span>{x}</li>)}</ul>
                  </div>
                </motion.div>
              )}
            </Card>

            {analysis.clients.map((c) => (
              <Card key={c.clientId} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm text-muted">client</div>
                    <div className="text-lg font-semibold">{c.clientId}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge>{c.requests} requests</Badge>
                    <Badge color="#ff8a00">{c.faultsSeen} faults</Badge>
                    <Badge color="#4da3ff">{c.retries} retries</Badge>
                    <Badge color="#22d3a5">{c.recovered} recovered</Badge>
                    {c.outcomes.handled + c.outcomes.unhandled > 0 && <Badge color={c.outcomes.unhandled ? "#ff3d5a" : "#22d3a5"}>{c.outcomes.handled}/{c.outcomes.handled + c.outcomes.unhandled} handled</Badge>}
                    <Badge color={c.score == null ? "#6b6b82" : c.score >= 80 ? "#22d3a5" : c.score >= 50 ? "#ffb020" : "#ff3d5a"}>score {c.score ?? "–"} · {c.grade}</Badge>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {c.findings.map((f) => <FindingRow key={f.id} f={f} projectId={ctx.project.id} />)}
                  {c.findings.length === 0 && <div className="text-sm text-muted">No resilience issues observed for this client.</div>}
                </div>
                {c.strengths.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {c.strengths.map((s) => (
                      <span key={s.type + s.endpointKey} className="inline-flex items-center gap-1.5 rounded-lg border border-mint/25 bg-mint/[0.07] px-2.5 py-1 text-xs text-mint"><CheckCircle2 className="h-3.5 w-3.5" /> {s.title} <span className="font-mono text-[10px] text-mint/60">{s.endpointKey}</span></span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function FindingRow({ f, projectId }: { f: Finding; projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-raised/30">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <SeverityPill s={f.severity} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{f.title}</div>
          <div className="truncate font-mono text-[11px] text-dim">{f.endpointKey}{f.count > 1 ? ` · seen ${f.count}×` : ""}</div>
        </div>
        <ChevronDown className={clsx("h-4 w-4 text-dim transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          <p className="text-sm text-muted">{f.detail}</p>
          <p className="text-sm text-mint/90">→ {f.recommendation}</p>
          {f.evidence.length > 0 && <div className="flex flex-wrap gap-1.5">{f.evidence.map((e) => <Badge key={e}>{e}</Badge>)}</div>}
          <AiExplain projectId={projectId} input={{ finding: f, endpointKey: f.endpointKey }} label="Explain & write the fix" />
        </div>
      )}
    </div>
  );
}
