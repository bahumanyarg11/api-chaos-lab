import { blobs, store } from "./store.js";
import type { ChaosEvent, Job, Project, Run, Scenario } from "./types.js";
import type { CompiledSpec } from "./openapi.js";
import { newId, nowIso } from "./util.js";

const EVENT_TTL_SEC = 3 * 24 * 3600;
const strip = <T>(item: any): T => {
  if (!item) return item;
  const { pk, sk, ttl, ...rest } = item;
  return rest as T;
};

// ---------- projects ----------
export async function saveProject(p: Project) {
  await store().put({ pk: `P#${p.id}`, sk: "META", ...p });
  await store().put({ pk: "PROJECTS", sk: `${p.createdAt}#${p.id}`, id: p.id, name: p.name, title: p.title, endpointCount: p.endpointCount, createdAt: p.createdAt });
}
export async function getProject(id: string): Promise<Project | undefined> {
  return strip<Project>(await store().get(`P#${id}`, "META"));
}
export async function patchProject(id: string, patch: Partial<Project>) {
  await store().merge(`P#${id}`, "META", { ...patch, updatedAt: nowIso() });
}
export async function listProjects(limit = 30) {
  return (await store().query<any>("PROJECTS", { desc: true, limit })).map((r) => strip<any>(r));
}
export async function deleteProject(p: Project) {
  await store().del(`P#${p.id}`, "META");
  await store().del("PROJECTS", `${p.createdAt}#${p.id}`);
}

// ---------- compiled spec cache (immutable per key) ----------
const specCache = new Map<string, CompiledSpec>();
export async function getCompiled(p: Project): Promise<CompiledSpec> {
  const hit = specCache.get(p.compiledKey);
  if (hit) return hit;
  const raw = await blobs().get(p.compiledKey);
  if (!raw) throw new Error(`compiled spec missing for ${p.id}`);
  const spec = JSON.parse(raw) as CompiledSpec;
  specCache.set(p.compiledKey, spec);
  return spec;
}

// ---------- scenarios ----------
export async function saveScenarios(list: Scenario[]) {
  await store().putMany(list.map((s) => ({ pk: `P#${s.projectId}`, sk: `S#${s.id}`, ...s })));
}
export async function listScenarios(projectId: string): Promise<Scenario[]> {
  return (await store().query(`P#${projectId}`, { begins: "S#" })).map((r) => strip<Scenario>(r));
}
export async function getScenario(projectId: string, id: string) {
  return strip<Scenario>(await store().get(`P#${projectId}`, `S#${id}`));
}
export async function patchScenario(projectId: string, id: string, patch: Partial<Scenario>) {
  await store().merge(`P#${projectId}`, `S#${id}`, patch);
}
export async function deleteScenario(projectId: string, id: string) {
  await store().del(`P#${projectId}`, `S#${id}`);
}

// ---------- events ----------
export async function saveEvent(e: ChaosEvent) {
  await store().put({ pk: `E#${e.projectId}`, sk: `${String(e.ts).padStart(15, "0")}#${e.id}`, ttl: Math.floor(Date.now() / 1000) + EVENT_TTL_SEC, ...e });
}
export async function listEvents(projectId: string, opts: { since?: number; limit?: number; runId?: string } = {}): Promise<ChaosEvent[]> {
  const rows = await store().query(`E#${projectId}`, opts.since ? { gt: String(opts.since).padStart(15, "0"), limit: opts.limit ?? 2000 } : { desc: true, limit: opts.limit ?? 2000 });
  let evs = rows.map((r) => strip<ChaosEvent>(r));
  if (!opts.since) evs.reverse();
  if (opts.runId) evs = evs.filter((e) => e.runId === opts.runId);
  return evs;
}
export async function getEvent(projectId: string, ts: number, id: string) {
  return strip<ChaosEvent>(await store().get(`E#${projectId}`, `${String(ts).padStart(15, "0")}#${id}`));
}
export async function patchEvent(projectId: string, ts: number, id: string, patch: Partial<ChaosEvent>) {
  await store().merge(`E#${projectId}`, `${String(ts).padStart(15, "0")}#${id}`, patch);
}

// ---------- runs ----------
export async function saveRun(r: Run) {
  await store().put({ pk: `P#${r.projectId}`, sk: `R#${r.id}`, ...r });
}
export async function getRun(projectId: string, id: string) {
  return strip<Run>(await store().get(`P#${projectId}`, `R#${id}`));
}
export async function listRuns(projectId: string) {
  return (await store().query(`P#${projectId}`, { begins: "R#" })).map((r) => strip<Run>(r)).sort((a, b) => b.startedAt - a.startedAt);
}
export async function patchRun(projectId: string, id: string, patch: Partial<Run>) {
  await store().merge(`P#${projectId}`, `R#${id}`, patch);
}

// ---------- jobs ----------
export async function createJob(type: Job["type"], projectId: string, input: Record<string, unknown>): Promise<Job> {
  const job: Job = { id: newId("job", 10), type, status: "pending", projectId, input, createdAt: nowIso(), updatedAt: nowIso() };
  await store().put({ pk: `J#${job.id}`, sk: "META", ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, ...job });
  return job;
}
export async function getJob(id: string) {
  return strip<Job>(await store().get(`J#${id}`, "META"));
}
export async function patchJob(id: string, patch: Partial<Job>) {
  await store().merge(`J#${id}`, "META", { ...patch, updatedAt: nowIso() });
}

// ---------- counters ----------
export async function bumpAttempt(projectId: string, key: string): Promise<number> {
  const r = await store().incr(`C#${projectId}`, key, { n: 1 });
  return r.n ?? 1;
}
export async function bumpStats(projectId: string, faulted: boolean) {
  await Promise.all([
    store().incr(`P#${projectId}`, "META", { "statsRequests": 1, "statsFaults": faulted ? 1 : 0 }),
    store().incr("GLOBAL", "STATS", { requests: 1, faults: faulted ? 1 : 0 }),
  ]);
}
export async function globalStats() {
  const g = await store().get<any>("GLOBAL", "STATS");
  return { requests: g?.requests ?? 0, faults: g?.faults ?? 0, projects: g?.projects ?? 0, reports: g?.reports ?? 0 };
}
export async function bumpGlobal(fields: Record<string, number>) {
  await store().incr("GLOBAL", "STATS", fields);
}
