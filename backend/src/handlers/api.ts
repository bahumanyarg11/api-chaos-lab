import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { Router, json, toReq, type Req } from "../lib/http.js";
import { compileSpec, parseSpecText } from "../lib/openapi.js";
import { buildHeuristicMatrix, draftToScenario } from "../lib/matrix.js";
import { FAULTS, FAULT_IDS, type FaultId } from "../lib/faults.js";
import { analyze } from "../lib/analyzer.js";
import { aiEnabled, heuristicSummary } from "../lib/ai.js";
import { SAMPLES } from "../lib/samples.js";
import { blobs, storageKind } from "../lib/store.js";
import * as repo from "../lib/repo.js";
import { dispatch } from "../lib/jobs.js";
import type { Project, Run, Scenario, Severity } from "../lib/types.js";
import { HttpError, newId, nowIso } from "../lib/util.js";

const router = new Router();

async function mustProject(id: string): Promise<Project> {
  const p = await repo.getProject(id);
  if (!p) throw new HttpError(404, `Project ${id} not found`);
  return p;
}

function publicBase(req: Req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function projectView(p: Project, req: Req) {
  return { ...p, chaosUrl: `${publicBase(req)}/x/${p.id}` };
}

router.on("GET", "/api/health", async () => json(200, { ok: true, service: "api-chaos-lab", time: nowIso(), region: process.env.AWS_REGION ?? "local", storage: storageKind(), ai: aiEnabled() ? "bedrock" : "rules-engine" }));

router.on("GET", "/api/faults", async () => json(200, { faults: FAULT_IDS.map((id) => FAULTS[id]) }));

router.on("GET", "/api/samples", async () => json(200, { samples: SAMPLES.map(({ spec, ...rest }) => rest) }));
router.on("GET", "/api/samples/:id", async (req) => {
  const s = SAMPLES.find((x) => x.id === req.params.id);
  if (!s) throw new HttpError(404, "sample not found");
  return json(200, s);
});

router.on("GET", "/api/stats", async () => json(200, await repo.globalStats()));

// ---------------- projects ----------------
router.on("GET", "/api/projects", async () => json(200, { projects: await repo.listProjects(50) }));

router.on("POST", "/api/projects", async (req) => {
  const b = req.body ?? {};
  let specText: string | undefined = b.spec;
  if (!specText && b.sampleId) specText = SAMPLES.find((s) => s.id === b.sampleId)?.spec;
  if (!specText && b.specUrl) {
    const r = await fetch(String(b.specUrl), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new HttpError(400, `Could not fetch spec URL (${r.status})`);
    specText = await r.text();
  }
  if (!specText || typeof specText !== "string") throw new HttpError(400, "Provide `spec` (JSON/YAML text), `specUrl`, or `sampleId`");
  if (specText.length > 2_000_000) throw new HttpError(413, "Spec too large (max 2 MB)");
  const doc = parseSpecText(specText);
  const compiled = compileSpec(doc);
  const id = newId("", 10);
  const now = nowIso();
  const project: Project = {
    id,
    name: (b.name as string)?.slice(0, 80) || compiled.title,
    title: compiled.title,
    version: compiled.version,
    description: compiled.description,
    endpointCount: compiled.endpoints.length,
    specKey: `projects/${id}/spec.txt`,
    compiledKey: `projects/${id}/compiled-${Date.now()}.json`,
    upstreamUrl: typeof b.upstreamUrl === "string" && /^https?:\/\//.test(b.upstreamUrl) ? b.upstreamUrl.replace(/\/$/, "") : undefined,
    chaos: { armed: true, intensity: 0.5 },
    ai: { status: "pending", summary: heuristicSummary(compiled) },
    createdAt: now,
    updatedAt: now,
    statsRequests: 0,
    statsFaults: 0,
    liveSince: Date.now(),
  };
  await blobs().put(project.specKey, specText, "text/plain");
  await blobs().put(project.compiledKey, JSON.stringify(compiled));
  const scenarios = buildHeuristicMatrix(id, compiled);
  await repo.saveScenarios(scenarios);
  await repo.saveProject(project);
  await repo.bumpGlobal({ projects: 1 });
  if (b.ai !== false) {
    const job = await repo.createJob("matrix", id, {});
    await repo.patchProject(id, { ai: { ...project.ai, status: "running" } });
    project.ai.status = "running";
    await dispatch(job);
  } else {
    await repo.patchProject(id, { ai: { ...project.ai, status: "fallback", model: "heuristic" } });
    project.ai.status = "fallback";
  }
  return json(201, { project: projectView(project, req), endpoints: compiled.endpoints, scenarios });
});

router.on("GET", "/api/projects/:id", async (req) => {
  const p = await mustProject(req.params.id);
  const [spec, scenarios, runs] = await Promise.all([repo.getCompiled(p), repo.listScenarios(p.id), repo.listRuns(p.id)]);
  return json(200, { project: projectView(p, req), spec: { ...spec, endpoints: undefined }, endpoints: spec.endpoints, scenarios, runs: runs.map(({ analysis, ...r }) => r) });
});

router.on("GET", "/api/projects/:id/spec", async (req) => {
  const p = await mustProject(req.params.id);
  return { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" }, body: (await blobs().get(p.specKey)) ?? "" };
});

router.on("PATCH", "/api/projects/:id", async (req) => {
  const p = await mustProject(req.params.id);
  const b = req.body ?? {};
  const patch: Partial<Project> = {};
  if (typeof b.name === "string") patch.name = b.name.slice(0, 80);
  if (b.upstreamUrl === null || b.upstreamUrl === "") patch.upstreamUrl = undefined as any;
  if (typeof b.upstreamUrl === "string" && /^https?:\/\//.test(b.upstreamUrl)) patch.upstreamUrl = b.upstreamUrl.replace(/\/$/, "");
  if (b.chaos) patch.chaos = { armed: b.chaos.armed ?? p.chaos.armed, intensity: Math.max(0, Math.min(1, Number(b.chaos.intensity ?? p.chaos.intensity))) };
  await repo.patchProject(p.id, patch);
  return json(200, { project: projectView({ ...p, ...patch }, req) });
});

router.on("DELETE", "/api/projects/:id", async (req) => {
  const p = await mustProject(req.params.id);
  await repo.deleteProject(p);
  return json(200, { deleted: p.id });
});

router.on("POST", "/api/projects/:id/regenerate", async (req) => {
  const p = await mustProject(req.params.id);
  const job = await repo.createJob("matrix", p.id, {});
  await repo.patchProject(p.id, { ai: { ...p.ai, status: "running" } });
  await dispatch(job);
  return json(202, { jobId: job.id });
});

// ---------------- scenarios ----------------
router.on("POST", "/api/projects/:id/scenarios", async (req) => {
  const p = await mustProject(req.params.id);
  const b = req.body ?? {};
  const spec = await repo.getCompiled(p);
  const ep = spec.endpoints.find((e) => e.key === b.endpointKey);
  if (!ep) throw new HttpError(400, "Unknown endpointKey");
  if (!FAULT_IDS.includes(b.fault)) throw new HttpError(400, "Unknown fault");
  const s = draftToScenario(p.id, ep, { fault: b.fault, severity: (b.severity as Severity) ?? "medium", title: b.title ?? `${ep.key} · ${FAULTS[b.fault as FaultId].label}`, rationale: b.rationale ?? "Custom scenario", expectedHandling: b.expectedHandling ?? "", params: b.params }, "custom");
  s.enabled = true;
  await repo.saveScenarios([s]);
  return json(201, { scenario: s });
});

router.on("PATCH", "/api/projects/:id/scenarios/:sid", async (req) => {
  const p = await mustProject(req.params.id);
  const cur = await repo.getScenario(p.id, req.params.sid);
  if (!cur) throw new HttpError(404, "scenario not found");
  const b = req.body ?? {};
  const patch: Partial<Scenario> = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.weight === "number") patch.weight = Math.max(0, Math.min(10, b.weight));
  if (b.params && typeof b.params === "object") patch.params = { ...cur.params, ...b.params };
  if (b.severity) patch.severity = b.severity;
  await repo.patchScenario(p.id, cur.id, patch);
  return json(200, { scenario: { ...cur, ...patch } });
});

router.on("DELETE", "/api/projects/:id/scenarios/:sid", async (req) => {
  await repo.deleteScenario(req.params.id, req.params.sid);
  return json(200, { deleted: req.params.sid });
});

router.on("POST", "/api/projects/:id/scenarios/bulk", async (req) => {
  const p = await mustProject(req.params.id);
  const b = req.body ?? {};
  const list = await repo.listScenarios(p.id);
  const target = list.filter((s) => (!b.fault || s.fault === b.fault) && (!b.endpointKey || s.endpointKey === b.endpointKey) && (!b.severity || s.severity === b.severity));
  const enabled = b.preset === "critical" ? undefined : !!b.enabled;
  const updated = target.map((s) => ({ ...s, enabled: b.preset === "critical" ? s.severity === "critical" || s.severity === "high" : b.preset === "all" ? true : b.preset === "none" ? false : enabled! }));
  await repo.saveScenarios(updated);
  return json(200, { updated: updated.length });
});

// ---------------- traffic / analysis ----------------
router.on("GET", "/api/projects/:id/events", async (req) => {
  const p = await mustProject(req.params.id);
  const since = req.query.since ? Number(req.query.since) : undefined;
  const events = await repo.listEvents(p.id, { since: since ?? p.liveSince, limit: since ? 500 : 300, runId: req.query.runId });
  return json(200, { events: since ? events : events.slice(-300), now: Date.now() });
});

router.on("POST", "/api/projects/:id/reset", async (req) => {
  const p = await mustProject(req.params.id);
  const liveSince = Date.now();
  await repo.patchProject(p.id, { liveSince });
  return json(200, { liveSince });
});

router.on("GET", "/api/projects/:id/analysis", async (req) => {
  const p = await mustProject(req.params.id);
  const [events, scenarios] = await Promise.all([repo.listEvents(p.id, { since: req.query.runId ? undefined : p.liveSince, runId: req.query.runId, limit: 3000 }), repo.listScenarios(p.id)]);
  const a = analyze(events, scenarios);
  return json(200, { analysis: a });
});

// ---------------- runs (CI / experiments) ----------------
router.on("POST", "/api/projects/:id/runs", async (req) => {
  const p = await mustProject(req.params.id);
  const run: Run = { id: newId("run", 8), projectId: p.id, label: (req.body?.label as string)?.slice(0, 80) || `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, status: "running", startedAt: Date.now() };
  await repo.saveRun(run);
  const patch: Partial<Project> = { activeRunId: run.id };
  if (req.body?.intensity != null || req.body?.armed != null) patch.chaos = { armed: req.body.armed ?? true, intensity: Number(req.body.intensity ?? p.chaos.intensity) };
  await repo.patchProject(p.id, patch);
  return json(201, { run });
});

router.on("POST", "/api/projects/:id/runs/:rid/stop", async (req) => {
  const p = await mustProject(req.params.id);
  const run = await repo.getRun(p.id, req.params.rid);
  if (!run) throw new HttpError(404, "run not found");
  const [events, scenarios] = await Promise.all([repo.listEvents(p.id, { since: run.startedAt - 1, runId: run.id, limit: 5000 }), repo.listScenarios(p.id)]);
  const analysis = analyze(events, scenarios);
  const patch: Partial<Run> = { status: "completed", endedAt: Date.now(), analysis, ai: { status: "pending" } };
  await repo.patchRun(p.id, run.id, patch);
  if (p.activeRunId === run.id) await repo.patchProject(p.id, { activeRunId: "" as any });
  const job = await repo.createJob("report", p.id, { runId: run.id });
  await dispatch(job);
  await repo.bumpGlobal({ reports: 1 });
  return json(200, { run: { ...run, ...patch }, jobId: job.id });
});

router.on("GET", "/api/projects/:id/runs", async (req) => json(200, { runs: (await repo.listRuns(req.params.id)).map(({ analysis, ...r }) => ({ ...r, score: (analysis as any)?.overall?.score ?? null })) }));

router.on("GET", "/api/projects/:id/runs/:rid", async (req) => {
  const run = await repo.getRun(req.params.id, req.params.rid);
  if (!run) throw new HttpError(404, "run not found");
  return json(200, { run });
});

// ---------------- AI jobs ----------------
router.on("POST", "/api/projects/:id/explain", async (req) => {
  const p = await mustProject(req.params.id);
  const job = await repo.createJob("explain", p.id, req.body ?? {});
  await dispatch(job);
  return json(202, { jobId: job.id });
});

router.on("POST", "/api/projects/:id/report", async (req) => {
  const p = await mustProject(req.params.id);
  const job = await repo.createJob("report", p.id, { clientId: req.body?.clientId, live: true });
  await dispatch(job);
  await repo.bumpGlobal({ reports: 1 });
  return json(202, { jobId: job.id });
});

router.on("GET", "/api/jobs/:jobId", async (req) => {
  const job = await repo.getJob(req.params.jobId);
  if (!job) throw new HttpError(404, "job not found");
  return json(200, { job });
});

export async function route(req: Req) {
  return router.handle(req);
}

export const handler = async (event: APIGatewayProxyEventV2) => route(toReq(event));
