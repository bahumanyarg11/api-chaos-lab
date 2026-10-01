import type { ChaosEvent, Scenario, Severity } from "./types.js";
import { FAULTS, type FaultId } from "./faults.js";

export type FindingType =
  | "retry_storm"
  | "no_backoff"
  | "ignored_retry_after"
  | "unsafe_write_retry"
  | "retried_non_retryable"
  | "unbounded_retries"
  | "no_retry_transient"
  | "no_timeout"
  | "client_crash"
  | "unverified_silent_fault";

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  endpointKey: string;
  clientId: string;
  fault?: FaultId;
  count: number;
  evidence: string[];
}

export interface Strength {
  type: "exponential_backoff" | "honors_retry_after" | "idempotency_keys" | "client_timeout" | "graceful_degradation" | "recovered_flaky";
  title: string;
  endpointKey: string;
  clientId: string;
  count: number;
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
  strengths: Strength[];
  outcomes: { handled: number; unhandled: number };
}

export interface Analysis {
  generatedAt: string;
  window: { from: number; to: number };
  totals: { requests: number; faults: number; errorRate: number; p50: number; p95: number; clients: number; retries: number };
  byFault: { fault: string; count: number }[];
  byStatus: { status: number; count: number }[];
  byEndpoint: { endpointKey: string; requests: number; faults: number }[];
  timeline: { t: number; ok: number; fault: number }[];
  coverage: { exercised: number; enabled: number; scenarios: { id: string; title: string; hits: number }[] };
  overall: { score: number | null; grade: string };
  clients: ClientReport[];
  findings: Finding[];
  strengths: Strength[];
}

const SEV_WEIGHT: Record<Severity, number> = { critical: 22, high: 12, medium: 6, low: 2 };
const RETRY_WINDOW_MS = 30_000;

function isFailure(e: ChaosEvent) {
  return e.status >= 500 || e.status === 429 || e.status === 408 || e.fault === "malformed_json";
}
function isNonRetryable(e: ChaosEvent) {
  return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}
export function grade(score: number | null) {
  if (score == null) return "–";
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}
function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export function analyze(events: ChaosEvent[], scenarios: Scenario[]): Analysis {
  const reqs = events.filter((e) => e.method !== "OUTCOME").sort((a, b) => a.ts - b.ts);
  const outcomes = events.filter((e) => e.method === "OUTCOME");
  const from = reqs[0]?.ts ?? Date.now();
  const to = reqs[reqs.length - 1]?.ts ?? Date.now();

  // ---- aggregate stats ----
  const byFault = new Map<string, number>();
  const byStatus = new Map<number, number>();
  const byEndpoint = new Map<string, { requests: number; faults: number }>();
  const hits = new Map<string, number>();
  for (const e of reqs) {
    if (e.fault) byFault.set(e.fault, (byFault.get(e.fault) ?? 0) + 1);
    byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
    const k = e.endpointKey ?? `${e.method} ${e.path}`;
    const be = byEndpoint.get(k) ?? { requests: 0, faults: 0 };
    be.requests++;
    if (e.fault) be.faults++;
    byEndpoint.set(k, be);
    if (e.scenarioId) hits.set(e.scenarioId, (hits.get(e.scenarioId) ?? 0) + 1);
  }
  const span = Math.max(1, to - from);
  const bucket = Math.max(1000, Math.ceil(span / 40 / 1000) * 1000);
  const tl = new Map<number, { ok: number; fault: number }>();
  for (const e of reqs) {
    const t = Math.floor((e.ts - from) / bucket) * bucket + from;
    const b = tl.get(t) ?? { ok: 0, fault: 0 };
    if (e.fault && (isFailure(e) || FAULTS[e.fault].silent)) b.fault++;
    else b.ok++;
    tl.set(t, b);
  }

  // ---- per-client behavioral analysis ----
  const clientIds = [...new Set(reqs.map((e) => e.clientId))];
  const clients: ClientReport[] = [];
  let totalRetries = 0;

  for (const clientId of clientIds) {
    const mine = reqs.filter((e) => e.clientId === clientId);
    const findings = new Map<string, Finding>();
    const strengths = new Map<string, Strength>();
    let retries = 0;
    let recovered = 0;

    const addFinding = (f: Omit<Finding, "id" | "count" | "evidence" | "clientId">, ev: ChaosEvent[]) => {
      const id = `${f.type}|${f.endpointKey}`;
      const cur = findings.get(id);
      if (cur) {
        cur.count++;
        for (const x of ev) if (cur.evidence.length < 6 && !cur.evidence.includes(x.id)) cur.evidence.push(x.id);
      } else findings.set(id, { ...f, id, clientId, count: 1, evidence: ev.slice(0, 6).map((x) => x.id) });
    };
    const addStrength = (s: Omit<Strength, "count" | "clientId">) => {
      const id = `${s.type}|${s.endpointKey}`;
      const cur = strengths.get(id);
      if (cur) cur.count++;
      else strengths.set(id, { ...s, clientId, count: 1 });
    };

    // group by logical request identity
    const groups = new Map<string, ChaosEvent[]>();
    for (const e of mine) {
      const key = `${e.method} ${e.path}#${e.method === "GET" ? "" : e.bodyHash ?? ""}`;
      const g = groups.get(key) ?? [];
      g.push(e);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      // split into attempt chains
      const chains: ChaosEvent[][] = [];
      let cur: ChaosEvent[] = [];
      for (const e of g) {
        const prev = cur[cur.length - 1];
        const gap = prev ? e.ts - (prev.ts + prev.latencyMs) : Infinity;
        const continues = prev && (((isFailure(prev) || prev.fault === "timeout") && gap < RETRY_WINDOW_MS) || (isNonRetryable(prev) && gap < 2000));
        if (continues) cur.push(e);
        else {
          if (cur.length) chains.push(cur);
          cur = [e];
        }
      }
      if (cur.length) chains.push(cur);

      for (const chain of chains) {
        const first = chain[0];
        const ep = first.endpointKey ?? `${first.method} ${first.path}`;
        const n = chain.length - 1;
        retries += n;
        const last = chain[chain.length - 1];
        if (n > 0 && !isFailure(last) && !isNonRetryable(last)) {
          recovered++;
          if (chain.some((c) => c.fault === "intermittent")) addStrength({ type: "recovered_flaky", title: "Recovered from a flaky dependency via retries", endpointKey: ep });
        }

        // gaps between response received and next attempt
        const gaps: number[] = [];
        for (let i = 1; i < chain.length; i++) gaps.push(chain[i].ts - (chain[i - 1].ts + chain[i - 1].latencyMs));

        // Timeout behaviour
        for (let i = 0; i < chain.length; i++) {
          const e = chain[i];
          if (e.fault !== "timeout") continue;
          const next = chain[i + 1];
          if (next && next.ts < e.ts + e.latencyMs) {
            addStrength({ type: "client_timeout", title: `Client timed out after ~${Math.round((next.ts - e.ts) / 100) / 10}s and moved on`, endpointKey: ep });
          } else if (!next) {
            addFinding(
              {
                type: "no_timeout",
                severity: first.method === "GET" ? "medium" : "high",
                title: "No client timeout observed",
                detail: `The request to ${ep} hung for ${(e.latencyMs / 1000).toFixed(1)}s and the client never timed out and retried. Users would stare at a frozen screen.`,
                recommendation: "Wrap every call in an AbortController/timeout (2–5 s for reads, budgeted for writes) and treat the timeout as a retryable error.",
                endpointKey: ep,
                fault: "timeout",
              },
              [e],
            );
          }
        }

        if (n === 0) {
          if (isFailure(first) && first.fault && FAULTS[first.fault].retryable && first.fault !== "timeout" && (first.method === "GET" || first.idempotencyKey)) {
            addFinding(
              {
                type: "no_retry_transient",
                severity: "low",
                title: "Gave up on a transient error",
                detail: `${ep} returned ${first.status} (${first.fault}) and the client did not retry. A single bounded retry would likely have succeeded.`,
                recommendation: "Retry transient errors (5xx, 429, network) up to 2–3 times with exponential backoff and jitter.",
                endpointKey: ep,
                fault: first.fault,
              },
              [first],
            );
          }
          continue;
        }

        // Retry storm / no backoff
        const fastGaps = gaps.filter((x) => x < 250).length;
        if (n >= 3 && fastGaps >= Math.ceil(n * 0.66)) {
          addFinding(
            {
              type: "retry_storm",
              severity: "high",
              title: `Retry storm: ${n} retries in ${((last.ts - first.ts) / 1000).toFixed(1)}s`,
              detail: `After ${first.status} on ${ep}, the client retried ${n}× with a median gap of ${Math.round(pct(gaps, 50))} ms. In production this amplifies load on a struggling service and prolongs the outage.`,
              recommendation: "Use exponential backoff with full jitter: delay = random(0, base·2^attempt), capped (e.g. base 200 ms, cap 5 s), max 3 attempts.",
              endpointKey: ep,
              fault: first.fault,
            },
            chain,
          );
        } else if (n >= 1 && gaps.every((x) => x < 100)) {
          addFinding(
            {
              type: "no_backoff",
              severity: "medium",
              title: "Immediate retries without backoff",
              detail: `The client retried ${ep} within ${Math.round(Math.max(...gaps))} ms of the failure. Without delay, retries hit the same overloaded instance.`,
              recommendation: "Add exponential backoff with jitter between attempts.",
              endpointKey: ep,
              fault: first.fault,
            },
            chain,
          );
        } else if (n >= 2) {
          let growing = true;
          for (let i = 1; i < gaps.length; i++) if (gaps[i] < gaps[i - 1] * 1.3) growing = false;
          if (growing && gaps[0] >= 80) addStrength({ type: "exponential_backoff", title: "Exponential backoff between retries", endpointKey: ep });
        }

        if (n > 5) {
          addFinding(
            {
              type: "unbounded_retries",
              severity: "high",
              title: `Unbounded retries (${n} attempts)`,
              detail: `The client kept retrying ${ep} ${n} times. Unbounded retries exhaust quotas, batteries and goodwill.`,
              recommendation: "Cap retries (typically 3) and add a circuit breaker that fails fast after repeated failures.",
              endpointKey: ep,
              fault: first.fault,
            },
            chain,
          );
        }

        // Retry-After
        for (let i = 0; i < chain.length - 1; i++) {
          const e = chain[i];
          if (!e.retryAfter) continue;
          const gap = gaps[i];
          if (gap < e.retryAfter * 1000 * 0.9) {
            addFinding(
              {
                type: "ignored_retry_after",
                severity: "high",
                title: `Ignored Retry-After: ${e.retryAfter}s`,
                detail: `${ep} returned ${e.status} with Retry-After: ${e.retryAfter}s, but the client retried after ${(Math.max(gap, 0) / 1000).toFixed(2)}s. Providers often escalate to longer bans when this happens.`,
                recommendation: "Parse Retry-After (seconds or HTTP date) on 429/503 and wait at least that long before the next attempt.",
                endpointKey: ep,
                fault: e.fault,
              },
              [e, chain[i + 1]],
            );
          } else addStrength({ type: "honors_retry_after", title: "Honors Retry-After back-pressure", endpointKey: ep });
        }

        // Non-idempotent writes
        if (first.method === "POST" || first.method === "PATCH") {
          const keys = chain.map((c) => c.idempotencyKey);
          const stable = keys.every((k) => k && k === keys[0]);
          if (!stable) {
            addFinding(
              {
                type: "unsafe_write_retry",
                severity: "critical",
                title: keys.some(Boolean) ? "Idempotency-Key changed between retries" : "Retried a non-idempotent write without an Idempotency-Key",
                detail: `${first.method} ${first.path} was sent ${chain.length}× for the same payload ${keys.some(Boolean) ? "with different" : "without any"} Idempotency-Key. If the first attempt actually succeeded server-side, this creates duplicate side effects (e.g. double charges, duplicate orders).`,
                recommendation: "Generate one Idempotency-Key per logical operation (UUID) and send the SAME key on every retry; servers dedupe on it.",
                endpointKey: ep,
                fault: first.fault,
              },
              chain,
            );
          } else addStrength({ type: "idempotency_keys", title: "Stable Idempotency-Key across retries", endpointKey: ep });
        }

        // retrying non-retryable 4xx
        const nr = chain.filter((c, i) => i < chain.length - 1 && isNonRetryable(c));
        if (nr.length && (nr[0].status === 409 || nr.length >= 2)) {
          addFinding(
            {
              type: "retried_non_retryable",
              severity: nr[0].status === 401 ? "medium" : "medium",
              title: `Retried a non-retryable ${nr[0].status}`,
              detail: `${ep} returned ${nr[0].status} (${nr[0].fault ?? "client error"}) and the client retried the identical request ${nr.length}×. 4xx errors (except 408/429) will not succeed on retry.`,
              recommendation: nr[0].status === 401 ? "On 401, refresh the token ONCE and replay; if that fails, sign the user out gracefully." : "Do not retry 4xx; surface a clear message and reconcile state (e.g. refetch on 409).",
              endpointKey: ep,
              fault: nr[0].fault,
            },
            nr,
          );
        }
      }
    }

    // ---- client-reported outcomes (beacon / SDK) ----
    const mineOut = outcomes.filter((o) => o.clientId === clientId);
    let handled = 0;
    let unhandled = 0;
    for (const o of mineOut) {
      if (o.outcome?.handled) {
        handled++;
        if (o.fault && o.outcome.fallback) addStrength({ type: "graceful_degradation", title: `Graceful degradation on ${FAULTS[o.fault]?.label ?? o.fault}: ${o.outcome.fallback}`, endpointKey: o.endpointKey ?? o.path });
      } else {
        unhandled++;
        addFinding(
          {
            type: "client_crash",
            severity: o.fault && ["missing_fields", "wrong_types", "schema_drift", "malformed_json"].includes(o.fault) ? "high" : "high",
            title: `Client failed on ${o.fault ? FAULTS[o.fault]?.label ?? o.fault : "a degraded response"}`,
            detail: `The client reported an unhandled failure on ${o.endpointKey ?? o.path}: ${o.outcome?.detail ?? "no detail"}.`,
            recommendation: "Validate responses at the boundary, catch parse errors, and render fallback/cached UI instead of crashing.",
            endpointKey: o.endpointKey ?? o.path,
            fault: o.fault,
          },
          [o],
        );
      }
    }

    // Silent faults the server cannot verify without outcome reports
    if (!mineOut.length) {
      const silent = mine.filter((e) => e.fault && FAULTS[e.fault].silent && e.fault !== "latency");
      for (const e of silent.slice(0, 50)) {
        addFinding(
          {
            type: "unverified_silent_fault",
            severity: "low",
            title: `Unverified: ${FAULTS[e.fault!].label}`,
            detail: `A 2xx response with a corrupted body (${FAULTS[e.fault!].label.toLowerCase()}) was served on ${e.endpointKey}. The server can't see whether the client handled it.`,
            recommendation: "Assert UI behaviour in your test suite, or POST outcomes to /__chaos/outcome (the ChaosLab SDK does this automatically).",
            endpointKey: e.endpointKey ?? e.path,
            fault: e.fault,
          },
          [e],
        );
      }
    }

    const fl = [...findings.values()];
    const faultsSeen = mine.filter((e) => e.fault).length;
    let score: number | null = null;
    if (faultsSeen > 0 || mineOut.length > 0) {
      const deduct = fl.reduce((s, f) => s + SEV_WEIGHT[f.severity] * (f.type === "unverified_silent_fault" ? 0.5 : 1) * Math.min(1 + Math.log2(f.count), 2), 0);
      // Smooth decay: many findings drive the score toward (but never exactly) zero.
      let behavior = 100 * Math.exp(-deduct / 70);
      const bonus = Math.min(10, strengths.size * 2);
      behavior = Math.min(100, behavior + (behavior < 100 ? bonus : 0));
      if (handled + unhandled > 0) {
        const hr = handled / (handled + unhandled);
        score = Math.round(behavior * 0.55 + hr * 100 * 0.45);
      } else score = Math.round(behavior);
    }
    totalRetries += retries;
    clients.push({
      clientId,
      requests: mine.length,
      faultsSeen,
      retries,
      recovered,
      score,
      grade: grade(score),
      findings: fl.sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity] || b.count - a.count),
      strengths: [...strengths.values()],
      outcomes: { handled, unhandled },
    });
  }

  clients.sort((a, b) => b.requests - a.requests);
  const scored = clients.filter((c) => c.score != null);
  const overallScore = scored.length ? Math.round(scored.reduce((s, c) => s + c.score! * c.requests, 0) / scored.reduce((s, c) => s + c.requests, 0)) : null;
  const lat = reqs.map((e) => e.latencyMs);
  const enabled = scenarios.filter((s) => s.enabled);
  const faultCount = reqs.filter((e) => e.fault).length;

  return {
    generatedAt: new Date().toISOString(),
    window: { from, to },
    totals: {
      requests: reqs.length,
      faults: faultCount,
      errorRate: reqs.length ? reqs.filter((e) => e.status >= 400).length / reqs.length : 0,
      p50: pct(lat, 50),
      p95: pct(lat, 95),
      clients: clientIds.length,
      retries: totalRetries,
    },
    byFault: [...byFault.entries()].map(([fault, count]) => ({ fault, count })).sort((a, b) => b.count - a.count),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status - b.status),
    byEndpoint: [...byEndpoint.entries()].map(([endpointKey, v]) => ({ endpointKey, ...v })).sort((a, b) => b.requests - a.requests),
    timeline: [...tl.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, ...v })),
    coverage: {
      exercised: enabled.filter((s) => hits.has(s.id)).length,
      enabled: enabled.length,
      scenarios: enabled.map((s) => ({ id: s.id, title: s.title, hits: hits.get(s.id) ?? 0 })),
    },
    overall: { score: overallScore, grade: grade(overallScore) },
    clients,
    findings: clients.flatMap((c) => c.findings).sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity]),
    strengths: clients.flatMap((c) => c.strengths),
  };
}
