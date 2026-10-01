import type { CompiledSpec, Endpoint } from "./openapi.js";
import { responseFieldPaths } from "./openapi.js";
import { FAULTS, type FaultId } from "./faults.js";
import type { Scenario, Severity } from "./types.js";
import { newId, nowIso } from "./util.js";

interface Draft {
  fault: FaultId;
  severity: Severity;
  title: string;
  rationale: string;
  expectedHandling: string;
  params?: Record<string, number | string>;
}

function has(ep: Endpoint, s: string) {
  return ep.semantics.includes(s);
}

/**
 * Deterministic, semantics-aware baseline matrix. Bedrock refines/extends it; this guarantees
 * the product works instantly and offline.
 */
export function heuristicDrafts(ep: Endpoint): Draft[] {
  const d: Draft[] = [];
  const isWrite = ep.method !== "GET" && ep.method !== "HEAD";
  const money = has(ep, "payment") || has(ep, "order");
  const fields = responseFieldPaths(ep.successSchema);
  const reqFields = fields.required.slice(0, 2).join(", ") || "key fields";

  d.push({
    fault: "latency",
    severity: has(ep, "auth") || money ? "high" : "medium",
    title: `${ep.key} responds in 3–5 s`,
    rationale: `Slow ${ep.method === "GET" ? "reads" : "writes"} are the most common real-world degradation; users see frozen UI if there is no loading state or timeout budget.`,
    expectedHandling: "Show a loading/skeleton state, enforce a client timeout (e.g. 2–3 s for reads), and avoid blocking unrelated UI.",
  });
  d.push({
    fault: "timeout",
    severity: money ? "critical" : isWrite ? "high" : "medium",
    title: `${ep.key} hangs past the client timeout`,
    rationale: money
      ? "A hung payment/order write is ambiguous: the charge may or may not have happened. Blind retries without an idempotency key can double-charge."
      : "Without an explicit timeout, the client waits on a dead socket and the user is stuck.",
    expectedHandling: money
      ? "Abort via timeout, then retry ONLY with the same Idempotency-Key, or poll for status before retrying."
      : "Abort after a timeout (AbortController), retry with exponential backoff + jitter, then show a recoverable error.",
  });
  d.push({
    fault: "http_500",
    severity: money ? "high" : "medium",
    title: `${ep.key} returns 500`,
    rationale: "Transient server errors happen during deploys and dependency blips.",
    expectedHandling: isWrite && !ep.idempotent ? "Retry at most 2–3 times with backoff and an Idempotency-Key; otherwise surface an error with a retry button." : "Retry with exponential backoff + jitter (max 3), then show an error state—never a blank screen.",
  });

  if (isWrite) {
    d.push({
      fault: "rate_limit_429",
      severity: money ? "high" : "medium",
      title: `${ep.key} is rate-limited (429)`,
      rationale: "Bursty writes hit provider quotas; ignoring Retry-After causes retry storms that extend the outage.",
      expectedHandling: "Honor the Retry-After header, queue or debounce writes, and back off exponentially.",
    });
    d.push({
      fault: "intermittent",
      severity: money ? "critical" : "high",
      title: `${ep.key} fails twice, then succeeds`,
      rationale: money
        ? "Flaky dependency on a non-idempotent write: correct retries recover, naive retries duplicate the side effect."
        : "Flaky dependencies are recoverable with correct retries—this verifies your retry policy actually works.",
      expectedHandling: "Retry with backoff; send a stable Idempotency-Key on every attempt of the same logical request.",
      params: { failFirst: 2, status: 503 },
    });
    if (ep.method === "POST") {
      d.push({
        fault: "conflict_409",
        severity: money ? "high" : "low",
        title: `${ep.key} returns 409 Conflict`,
        rationale: "Duplicate submission (double-click, retry after success) or concurrent modification.",
        expectedHandling: "Treat as a non-retryable conflict: fetch latest state and show a clear message; do not loop.",
      });
    }
    d.push({
      fault: "http_502_html",
      severity: "medium",
      title: `${ep.key} gets an HTML 502 from the load balancer`,
      rationale: "Proxies return HTML error pages; calling response.json() on them throws an unhelpful SyntaxError.",
      expectedHandling: "Check status and content-type before parsing; map to a typed error.",
    });
  } else {
    d.push({
      fault: "malformed_json",
      severity: "medium",
      title: `${ep.key} returns truncated JSON`,
      rationale: "Truncated responses (proxy resets, partial writes) crash naive JSON parsing.",
      expectedHandling: "Wrap parsing in try/catch, treat as a retryable error, and fall back to cached data.",
    });
    d.push({
      fault: "missing_fields",
      severity: has(ep, "user") || money ? "high" : "medium",
      title: `${ep.key} omits ${reqFields}`,
      rationale: `Contract violations on ${reqFields} cause 'undefined is not a function' crashes and blank UI.`,
      expectedHandling: "Validate the response (zod/JSON Schema) at the boundary; render placeholders for missing optional data.",
      params: { count: 2 },
    });
    d.push({
      fault: "schema_drift",
      severity: "medium",
      title: `${ep.key} ships a breaking v2 shape`,
      rationale: "Upstream providers rename fields without notice; drift detection catches it before users do.",
      expectedHandling: "Validate against the contract, alert on unknown/missing fields, and fail gracefully.",
    });
    d.push({
      fault: "http_503",
      severity: "medium",
      title: `${ep.key} returns 503 + Retry-After`,
      rationale: "Back-pressure from an overloaded service—clients must slow down rather than hammer it.",
      expectedHandling: "Honor Retry-After; serve stale cached data while waiting.",
      params: { retryAfterSec: 2 },
    });
    if (ep.isList) {
      d.push({
        fault: "empty_body",
        severity: "low",
        title: `${ep.key} returns an empty list`,
        rationale: "Empty states are often untested and render as broken layouts.",
        expectedHandling: "Render a designed empty state with a call to action.",
      });
      d.push({
        fault: "payload_bloat",
        severity: "low",
        title: `${ep.key} returns 50× more rows`,
        rationale: "Missing pagination limits can freeze the UI or blow memory on mobile.",
        expectedHandling: "Paginate, virtualize long lists, and cap page size client-side.",
      });
    } else {
      d.push({
        fault: "wrong_types",
        severity: "medium",
        title: `${ep.key} returns wrong field types`,
        rationale: "'42' vs 42 or null objects cause NaN totals and crashes in formatting code.",
        expectedHandling: "Coerce/validate types at the boundary; never trust provider types blindly.",
      });
    }
  }
  if (ep.requiresAuth || has(ep, "auth") || has(ep, "user") || money) {
    d.push({
      fault: "auth_401",
      severity: "high",
      title: `${ep.key} rejects an expired token`,
      rationale: "Tokens expire mid-session; without a refresh flow users get kicked out or see cryptic errors.",
      expectedHandling: "Refresh the token once and replay the request; if refresh fails, redirect to login while preserving state.",
    });
  }
  return d;
}

export function draftToScenario(projectId: string, ep: Endpoint, d: Draft, source: Scenario["source"]): Scenario {
  return {
    id: newId("scn", 8),
    projectId,
    endpointKey: ep.key,
    method: ep.method,
    path: ep.path,
    fault: d.fault,
    params: { ...FAULTS[d.fault].defaults, ...(d.params ?? {}) },
    severity: d.severity,
    title: d.title,
    rationale: d.rationale,
    expectedHandling: d.expectedHandling,
    enabled: d.severity === "critical" || d.severity === "high",
    weight: d.severity === "critical" ? 3 : d.severity === "high" ? 2 : 1,
    source,
    createdAt: nowIso(),
  };
}

export function buildHeuristicMatrix(projectId: string, spec: CompiledSpec): Scenario[] {
  const out: Scenario[] = [];
  for (const ep of spec.endpoints) {
    if (ep.semantics.includes("health")) continue;
    for (const d of heuristicDrafts(ep)) out.push(draftToScenario(projectId, ep, d, "heuristic"));
  }
  return out;
}
