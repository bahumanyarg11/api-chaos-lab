import { aiExplain, aiMatrix, aiReport } from "../lib/ai.js";
import { analyze } from "../lib/analyzer.js";
import { draftToScenario } from "../lib/matrix.js";
import { FAULT_IDS, type FaultId } from "../lib/faults.js";
import * as repo from "../lib/repo.js";
import type { Scenario } from "../lib/types.js";
import { nowIso } from "../lib/util.js";

/** Async AI worker (invoked with InvocationType=Event). Long Bedrock calls live here, not behind API Gateway's 30 s limit. */
export async function runJob({ jobId }: { jobId: string }) {
  const job = await repo.getJob(jobId);
  if (!job || job.status === "done") return;
  await repo.patchJob(job.id, { status: "running" });
  try {
    const p = await repo.getProject(job.projectId);
    if (!p) throw new Error("project missing");
    const spec = await repo.getCompiled(p);

    if (job.type === "matrix") {
      const baseline = await repo.listScenarios(p.id);
      const { data, model } = await aiMatrix(spec, baseline);
      const byKey = new Map(baseline.map((s) => [`${s.endpointKey}|${s.fault}`, s]));
      const toSave: Scenario[] = [];
      let added = 0;
      let refined = 0;
      for (const a of data.scenarios ?? []) {
        const ep = spec.endpoints.find((e) => e.key === a.endpointKey);
        if (!ep || !FAULT_IDS.includes(a.fault as FaultId)) continue;
        const cur = byKey.get(`${ep.key}|${a.fault}`);
        if (cur) {
          toSave.push({ ...cur, title: a.title, rationale: a.rationale, expectedHandling: a.expectedHandling, severity: a.severity, weight: a.severity === "critical" ? 3 : a.severity === "high" ? 2 : 1, enabled: cur.enabled || a.severity === "critical" || a.severity === "high", source: "ai" });
          refined++;
        } else {
          const s = draftToScenario(p.id, ep, { fault: a.fault as FaultId, severity: a.severity, title: a.title, rationale: a.rationale, expectedHandling: a.expectedHandling }, "ai");
          byKey.set(`${ep.key}|${a.fault}`, s);
          toSave.push(s);
          added++;
        }
      }
      if (toSave.length) await repo.saveScenarios(toSave);
      const result = { model, added, refined, summary: data.summary };
      await repo.patchProject(p.id, { ai: { status: model === "heuristic" ? "fallback" : "ready", model, summary: data.summary || p.ai.summary, updatedAt: nowIso() } });
      await repo.patchJob(job.id, { status: "done", result, model });
      return;
    }

    if (job.type === "explain") {
      const input = job.input as any;
      const scenario = input.scenarioId ? await repo.getScenario(p.id, input.scenarioId) : undefined;
      const event = input.eventId && input.eventTs ? await repo.getEvent(p.id, Number(input.eventTs), input.eventId) : undefined;
      const endpointKey = input.endpointKey ?? event?.endpointKey ?? scenario?.endpointKey ?? input.finding?.endpointKey;
      const endpoint = spec.endpoints.find((e) => e.key === endpointKey);
      const { data, model } = await aiExplain({ event, scenario, finding: input.finding, endpoint, language: input.language });
      await repo.patchJob(job.id, { status: "done", result: data, model });
      return;
    }

    if (job.type === "report") {
      const input = job.input as any;
      const scenarios = await repo.listScenarios(p.id);
      let analysis: any;
      if (input.runId) {
        const run = await repo.getRun(p.id, input.runId);
        analysis = run?.analysis ?? analyze(await repo.listEvents(p.id, { since: (run?.startedAt ?? 0) - 1, runId: input.runId, limit: 5000 }), scenarios);
      } else {
        analysis = analyze(await repo.listEvents(p.id, { since: p.liveSince, limit: 3000 }), scenarios);
      }
      const { data, model } = await aiReport(spec, analysis, input.clientId);
      if (input.runId) await repo.patchRun(p.id, input.runId, { ai: { status: model === "heuristic" ? "fallback" : "ready", narrative: data, model } });
      await repo.patchJob(job.id, { status: "done", result: { narrative: data, analysis }, model });
      return;
    }
  } catch (e: any) {
    console.error(JSON.stringify({ msg: "job failed", jobId, error: e?.message, stack: e?.stack }));
    await repo.patchJob(job.id, { status: "error", error: String(e?.message ?? e) });
    if (job.type === "matrix") await repo.patchProject(job.projectId, { ai: { status: "error", error: String(e?.message ?? e), updatedAt: nowIso() } as any });
  }
}

export const handler = async (event: { jobId: string }) => runJob(event);
