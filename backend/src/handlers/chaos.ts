import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { CORS, json, toReq, type Req, type Res } from "../lib/http.js";
import { matchEndpoint, sampleFromSchema, type Endpoint } from "../lib/openapi.js";
import { applyFault, FAULTS, FAULT_IDS, type FaultId } from "../lib/faults.js";
import * as repo from "../lib/repo.js";
import { store } from "../lib/store.js";
import type { ChaosEvent, Project, Scenario } from "../lib/types.js";
import { newId, sha1, sleep } from "../lib/util.js";

/**
 * Chaos data plane: ANY /x/{projectId}/{path+}
 * Serves spec-faithful mock responses (or proxies to the real upstream) and injects the
 * project's chaos scenarios. Every request is logged for server-side client-behaviour analysis.
 */

const CACHE_MS = Number(process.env.CHAOS_CACHE_MS ?? 1500);
const projCache = new Map<string, { at: number; p: Project; scenarios: Scenario[] }>();

async function loadProject(id: string) {
  const hit = projCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const p = await repo.getProject(id);
  if (!p) return undefined;
  const scenarios = await repo.listScenarios(id);
  const v = { at: Date.now(), p, scenarios };
  projCache.set(id, v);
  return v;
}

function clientIdOf(req: Req) {
  return (req.headers["x-chaos-client"] || req.query["__client"] || `anon-${sha1(req.ip + (req.headers["user-agent"] ?? "")).slice(0, 6)}`).slice(0, 64);
}

function emf(projectId: string, fault: string, status: number, latencyMs: number) {
  // CloudWatch Embedded Metric Format → custom metrics without extra API calls.
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "ApiChaosLab",
            Dimensions: [["Fault"], []],
            Metrics: [
              { Name: "Requests", Unit: "Count" },
              { Name: "FaultsInjected", Unit: "Count" },
              { Name: "Latency", Unit: "Milliseconds" },
              { Name: "Errors5xx", Unit: "Count" },
            ],
          },
        ],
      },
      Fault: fault,
      projectId,
      status,
      Requests: 1,
      FaultsInjected: fault === "none" ? 0 : 1,
      Latency: latencyMs,
      Errors5xx: status >= 500 ? 1 : 0,
    }),
  );
}

function pickWeighted(list: Scenario[]): Scenario {
  const total = list.reduce((s, x) => s + Math.max(0.01, x.weight), 0);
  let r = Math.random() * total;
  for (const s of list) {
    r -= Math.max(0.01, s.weight);
    if (r <= 0) return s;
  }
  return list[list.length - 1];
}

async function healthyResponse(p: Project, ep: Endpoint, req: Req, subPath: string): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  if (p.upstreamUrl) {
    const qs = new URLSearchParams(Object.entries(req.query).filter(([k]) => !k.startsWith("__"))).toString();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (!["host", "content-length", "connection"].includes(k) && !k.startsWith("x-chaos") && !k.startsWith("x-amz") && !k.startsWith("x-forwarded") && !k.startsWith("cloudfront")) headers[k] = v;
    try {
      const r = await fetch(`${p.upstreamUrl}${subPath}${qs ? `?${qs}` : ""}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : req.rawBody, signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-json upstream */
      }
      return { status: r.status, body, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "x-chaos-upstream": "proxied" } };
    } catch (e: any) {
      return { status: 502, body: { error: { code: "upstream_unreachable", message: `ChaosLab could not reach upstream: ${e?.message}` } }, headers: { "content-type": "application/json" } };
    }
  }
  let body: any = ep.successExample ?? sampleFromSchema(ep.successSchema, `${ep.key}|${subPath}`);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    // Echo path params & matching request fields so mocks feel real.
    const m = matchEndpoint([ep], req.method, subPath);
    for (const [k, v] of Object.entries(m?.pathParams ?? {})) if (k in body || k.toLowerCase().endsWith("id")) body[k in body ? k : "id"] = v;
    if (req.body && typeof req.body === "object") for (const [k, v] of Object.entries(req.body)) if (k in body && typeof v !== "object") body[k] = v;
    if (ep.semantics.includes("payment") && "status" in body) body.status = "succeeded";
  }
  if (ep.successSchema == null && body && typeof body === "object" && Object.keys(body).length === 0) body = { ok: true };
  return { status: ep.successStatus || 200, body, headers: { "content-type": "application/json" } };
}

async function handleOutcome(p: Project, req: Req): Promise<Res> {
  const b = req.body ?? {};
  const ev: ChaosEvent = {
    id: newId("evt", 10),
    projectId: p.id,
    runId: p.activeRunId || undefined,
    ts: Date.now(),
    method: "OUTCOME",
    path: String(b.path ?? b.endpointKey ?? "?").slice(0, 200),
    endpointKey: b.endpointKey ? String(b.endpointKey).slice(0, 200) : undefined,
    clientId: clientIdOf(req),
    scenarioId: b.scenarioId,
    fault: FAULT_IDS.includes(b.fault) ? b.fault : undefined,
    status: 0,
    latencyMs: 0,
    outcome: { handled: !!b.handled, detail: b.detail ? String(b.detail).slice(0, 300) : undefined, fallback: b.fallback ? String(b.fallback).slice(0, 120) : undefined },
  };
  await repo.saveEvent(ev);
  return json(202, { ok: true, eventId: ev.id });
}

export async function route(req: Req): Promise<Res> {
  if (req.method === "OPTIONS") return { statusCode: 204, headers: { ...CORS }, body: "" };
  const m = /^\/x\/([a-z0-9_]+)(\/.*)?$/.exec(req.path);
  if (!m) return json(404, { error: "Use /x/{projectId}/{path}" });
  const projectId = m[1];
  const subPath = m[2] ?? "/";
  const t0 = Date.now();
  const loaded = await loadProject(projectId);
  if (!loaded) return json(404, { error: `Unknown ChaosLab project ${projectId}` });
  const { p, scenarios } = loaded;

  if (subPath === "/__chaos/outcome" && req.method === "POST") return handleOutcome(p, req);
  if (subPath === "/__chaos/ping") return json(200, { ok: true, project: p.id, armed: p.chaos.armed, intensity: p.chaos.intensity });

  const spec = await repo.getCompiled(p);
  const match = matchEndpoint(spec.endpoints, req.method, subPath);
  const clientId = clientIdOf(req);
  const bodyHash = req.rawBody ? sha1(req.rawBody).slice(0, 12) : undefined;
  const idempotencyKey = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];

  const baseEvent: ChaosEvent = {
    id: newId("evt", 10),
    projectId: p.id,
    runId: p.activeRunId || undefined,
    ts: t0,
    method: req.method,
    path: subPath,
    clientId,
    status: 0,
    latencyMs: 0,
    bodyHash,
    idempotencyKey: idempotencyKey?.slice(0, 80),
    userAgent: req.headers["user-agent"]?.slice(0, 120),
  };

  if (!match) {
    const ev = { ...baseEvent, status: 404, latencyMs: Date.now() - t0, note: "No matching operation in spec" };
    await repo.saveEvent(ev);
    return json(404, { error: { code: "not_in_spec", message: `${req.method} ${subPath} is not defined in the OpenAPI spec` } }, { "x-chaos-event": ev.id });
  }
  const ep = match.endpoint;
  baseEvent.endpointKey = ep.key;

  // ---------- choose fault ----------
  let scenario: Scenario | undefined;
  let fault: FaultId | undefined;
  let forced = false;
  const forcedScenario = req.headers["x-chaos-scenario"] ?? req.query["__scenario"];
  const forcedFault = (req.headers["x-chaos-fault"] ?? req.query["__chaos"]) as FaultId | undefined;
  const logicalKey = `${clientId}|${ep.key}|${req.method === "GET" ? subPath : bodyHash ?? idempotencyKey ?? subPath}`;
  const sticky = await store().get<any>(`C#${p.id}`, `flaky|${logicalKey}`);

  if (forcedScenario) {
    scenario = scenarios.find((s) => s.id === forcedScenario);
    fault = scenario?.fault;
    forced = !!scenario;
  } else if (forcedFault && forcedFault !== ("none" as any) && FAULT_IDS.includes(forcedFault)) {
    fault = forcedFault;
    scenario = scenarios.find((s) => s.endpointKey === ep.key && s.fault === fault);
    forced = true;
  } else if (sticky && sticky.n > 0 && Date.now() - (sticky.at ?? 0) < 60_000) {
    scenario = scenarios.find((s) => s.id === sticky.scenarioId);
    fault = "intermittent";
  } else if (p.chaos.armed && forcedFault !== ("none" as any)) {
    const candidates = scenarios.filter((s) => s.enabled && s.endpointKey === ep.key);
    if (candidates.length && Math.random() < p.chaos.intensity) {
      scenario = pickWeighted(candidates);
      fault = scenario.fault;
    }
  }

  const healthy = await healthyResponse(p, ep, req, subPath);
  let status = healthy.status;
  let headers: Record<string, string> = { ...healthy.headers };
  let body = typeof healthy.body === "string" ? healthy.body : JSON.stringify(healthy.body);
  let delayMs = 15 + Math.floor(Math.random() * 60);
  let note: string | undefined;
  let retryAfter: number | undefined;

  if (fault) {
    let attempt = 1;
    if (fault === "intermittent") {
      attempt = (sticky?.n ?? 0) + 1;
      const failFirst = Number(scenario?.params?.failFirst ?? FAULTS.intermittent.defaults.failFirst);
      if (attempt > failFirst) await store().del(`C#${p.id}`, `flaky|${logicalKey}`);
      else await store().put({ pk: `C#${p.id}`, sk: `flaky|${logicalKey}`, n: attempt, scenarioId: scenario?.id, at: Date.now(), ttl: Math.floor(Date.now() / 1000) + 600 });
    }
    const r = applyFault(fault, { endpoint: ep, healthyBody: healthy.body, healthyStatus: healthy.status, params: scenario?.params ?? {}, attempt, seedKey: baseEvent.id });
    status = r.status;
    headers = { ...r.headers };
    body = r.body;
    delayMs = r.delayMs;
    note = r.note;
    if (r.headers["retry-after"]) retryAfter = Number(r.headers["retry-after"]);
  }

  const elapsed = Date.now() - t0;
  if (delayMs > elapsed) await sleep(Math.min(delayMs - elapsed, 26_000));
  const latencyMs = Date.now() - t0;

  const ev: ChaosEvent = { ...baseEvent, scenarioId: scenario?.id, fault, forced, status, latencyMs, note, retryAfter };
  await Promise.all([repo.saveEvent(ev), repo.bumpStats(p.id, !!fault).catch(() => undefined)]);
  emf(p.id, fault ?? "none", status, latencyMs);

  return {
    statusCode: status,
    headers: {
      ...CORS,
      ...headers,
      "x-chaos-event": ev.id,
      ...(fault ? { "x-chaos-fault": fault } : {}),
      ...(scenario ? { "x-chaos-scenario": scenario.id } : {}),
      "cache-control": "no-store",
    },
    body,
  };
}

export const handler = async (event: APIGatewayProxyEventV2) => route(toReq(event));
