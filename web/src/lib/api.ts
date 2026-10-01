export type Severity = "low" | "medium" | "high" | "critical";

export interface Fault {
  id: string;
  label: string;
  short: string;
  category: string;
  description: string;
  retryable: boolean;
  silent: boolean;
  defaults: Record<string, number | string>;
}

export interface Endpoint {
  key: string;
  method: string;
  path: string;
  summary?: string;
  semantics: string[];
  idempotent: boolean;
  isList: boolean;
  requiresAuth: boolean;
  successStatus: number;
  requestSchema?: any;
  successSchema?: any;
  params: { name: string; in: string; required: boolean }[];
}

export interface Scenario {
  id: string;
  endpointKey: string;
  method: string;
  path: string;
  fault: string;
  params: Record<string, number | string>;
  severity: Severity;
  title: string;
  rationale: string;
  expectedHandling: string;
  enabled: boolean;
  weight: number;
  source: "heuristic" | "ai" | "custom";
}

export interface Project {
  id: string;
  name: string;
  title: string;
  version: string;
  description?: string;
  endpointCount: number;
  upstreamUrl?: string;
  chaos: { armed: boolean; intensity: number };
  activeRunId?: string;
  ai: { status: string; model?: string; summary?: string; error?: string };
  createdAt: string;
  chaosUrl: string;
  statsRequests?: number;
  statsFaults?: number;
}

export interface ChaosEvent {
  id: string;
  ts: number;
  method: string;
  path: string;
  endpointKey?: string;
  clientId: string;
  scenarioId?: string;
  fault?: string;
  forced?: boolean;
  status: number;
  latencyMs: number;
  note?: string;
  idempotencyKey?: string;
  retryAfter?: number;
  outcome?: { handled: boolean; detail?: string; fallback?: string };
}

export interface Finding {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  endpointKey: string;
  clientId: string;
  fault?: string;
  count: number;
  evidence: string[];
}

export interface ClientReport {
  clientId: string;
  requests: number;
  faultsSeen: number;
  retries: number;
  recovered: number;
  score: number | null;
  grade: string;
  findings: Finding[];
  strengths: { type: string; title: string; endpointKey: string; count: number }[];
  outcomes: { handled: number; unhandled: number };
}

export interface Analysis {
  generatedAt: string;
  totals: { requests: number; faults: number; errorRate: number; p50: number; p95: number; clients: number; retries: number };
  byFault: { fault: string; count: number }[];
  byStatus: { status: number; count: number }[];
  byEndpoint: { endpointKey: string; requests: number; faults: number }[];
  timeline: { t: number; ok: number; fault: number }[];
  coverage: { exercised: number; enabled: number };
  overall: { score: number | null; grade: string };
  clients: ClientReport[];
  findings: Finding[];
}

export interface Run {
  id: string;
  label: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  score?: number | null;
  analysis?: Analysis;
  ai?: { status: string; narrative?: AiReport; model?: string };
}

export interface AiReport {
  verdict: string;
  executiveSummary: string;
  topRisks: { title: string; endpointKey: string; why: string; fix: string }[];
  codeFix: { language: string; title: string; snippet: string };
  nextExperiments: string[];
}

export interface AiExplain {
  headline: string;
  whatHappened: string;
  userImpact: string;
  howToHandle: string[];
  code: { language: string; snippet: string };
}

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  health: () => req<any>("GET", "/api/health"),
  stats: () => req<{ requests: number; faults: number; projects: number; reports: number }>("GET", "/api/stats"),
  faults: () => req<{ faults: Fault[] }>("GET", "/api/faults"),
  samples: () => req<{ samples: { id: string; name: string; description: string }[] }>("GET", "/api/samples"),
  sample: (id: string) => req<{ id: string; spec: string }>("GET", `/api/samples/${id}`),
  projects: () => req<{ projects: any[] }>("GET", "/api/projects"),
  createProject: (b: { spec?: string; sampleId?: string; specUrl?: string; name?: string; upstreamUrl?: string }) => req<{ project: Project; endpoints: Endpoint[]; scenarios: Scenario[] }>("POST", "/api/projects", b),
  project: (id: string) => req<{ project: Project; spec: any; endpoints: Endpoint[]; scenarios: Scenario[]; runs: Run[] }>("GET", `/api/projects/${id}`),
  patchProject: (id: string, b: any) => req<{ project: Project }>("PATCH", `/api/projects/${id}`, b),
  regenerate: (id: string) => req<{ jobId: string }>("POST", `/api/projects/${id}/regenerate`),
  patchScenario: (id: string, sid: string, b: Partial<Scenario>) => req<{ scenario: Scenario }>("PATCH", `/api/projects/${id}/scenarios/${sid}`, b),
  addScenario: (id: string, b: any) => req<{ scenario: Scenario }>("POST", `/api/projects/${id}/scenarios`, b),
  bulk: (id: string, b: any) => req<{ updated: number }>("POST", `/api/projects/${id}/scenarios/bulk`, b),
  events: (id: string, since?: number) => req<{ events: ChaosEvent[]; now: number }>("GET", `/api/projects/${id}/events${since ? `?since=${since}` : ""}`),
  reset: (id: string) => req<{ liveSince: number }>("POST", `/api/projects/${id}/reset`),
  analysis: (id: string, runId?: string) => req<{ analysis: Analysis }>("GET", `/api/projects/${id}/analysis${runId ? `?runId=${runId}` : ""}`),
  report: (id: string, clientId?: string) => req<{ jobId: string }>("POST", `/api/projects/${id}/report`, { clientId }),
  explain: (id: string, b: any) => req<{ jobId: string }>("POST", `/api/projects/${id}/explain`, b),
  job: (jobId: string) => req<{ job: { status: string; result?: any; error?: string; model?: string } }>("GET", `/api/jobs/${jobId}`),
  runs: (id: string) => req<{ runs: Run[] }>("GET", `/api/projects/${id}/runs`),
  run: (id: string, rid: string) => req<{ run: Run }>("GET", `/api/projects/${id}/runs/${rid}`),
  startRun: (id: string, label?: string) => req<{ run: Run }>("POST", `/api/projects/${id}/runs`, { label }),
  stopRun: (id: string, rid: string) => req<{ run: Run; jobId: string }>("POST", `/api/projects/${id}/runs/${rid}/stop`),
};

export async function waitJob<T = any>(jobId: string, onTick?: (s: string) => void, timeoutMs = 240_000): Promise<{ result: T; model?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { job } = await api.job(jobId);
    onTick?.(job.status);
    if (job.status === "done") return { result: job.result as T, model: job.model };
    if (job.status === "error") throw new Error(job.error ?? "job failed");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("timed out waiting for AI");
}

export function chaosBase(p: Project) {
  // Same-origin via CloudFront in production; local dev proxies /x as well.
  return `${window.location.origin}/x/${p.id}`;
}

export const SEV_COLOR: Record<Severity, string> = {
  critical: "#ff3d5a",
  high: "#ff8a00",
  medium: "#ffb020",
  low: "#4da3ff",
};

export function modelLabel(model?: string) {
  if (!model) return "";
  if (model === "heuristic") return "Rules engine";
  if (model.includes("nova")) return "Amazon Nova · Bedrock";
  if (model.includes("titan")) return "Amazon Titan · Bedrock";
  return "Amazon Bedrock";
}
