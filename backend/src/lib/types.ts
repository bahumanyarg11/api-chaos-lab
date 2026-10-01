import type { FaultId } from "./faults.js";

export type Severity = "low" | "medium" | "high" | "critical";

export interface Scenario {
  id: string;
  projectId: string;
  endpointKey: string;
  method: string;
  path: string;
  fault: FaultId;
  params: Record<string, number | string>;
  severity: Severity;
  title: string;
  rationale: string;
  expectedHandling: string;
  enabled: boolean;
  weight: number; // relative probability when chaos is armed
  source: "heuristic" | "ai" | "custom";
  createdAt: string;
}

export interface ChaosSettings {
  armed: boolean; // when false the endpoint returns healthy mocks (unless forced via header/query)
  intensity: number; // 0..1 probability that a matching request gets a fault
}

export interface Project {
  id: string;
  name: string;
  title: string;
  version: string;
  description?: string;
  endpointCount: number;
  specKey: string;
  compiledKey: string;
  upstreamUrl?: string;
  chaos: ChaosSettings;
  activeRunId?: string;
  liveSince?: number;
  ai: { status: "pending" | "running" | "ready" | "fallback" | "error"; model?: string; summary?: string; error?: string; updatedAt?: string };
  createdAt: string;
  updatedAt: string;
  statsRequests?: number;
  statsFaults?: number;
}

export interface ChaosEvent {
  id: string;
  projectId: string;
  runId?: string;
  ts: number;
  method: string;
  path: string;
  endpointKey?: string;
  clientId: string;
  scenarioId?: string;
  fault?: FaultId;
  forced?: boolean;
  status: number;
  latencyMs: number;
  note?: string;
  idempotencyKey?: string;
  bodyHash?: string;
  retryAfter?: number;
  userAgent?: string;
  outcome?: { handled: boolean; detail?: string; fallback?: string };
}

export interface Run {
  id: string;
  projectId: string;
  label: string;
  status: "running" | "completed";
  startedAt: number;
  endedAt?: number;
  analysis?: unknown;
  ai?: { status: "pending" | "ready" | "fallback" | "error"; narrative?: unknown; model?: string };
}

export interface Job {
  id: string;
  type: "matrix" | "explain" | "report";
  status: "pending" | "running" | "done" | "error";
  projectId: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}
