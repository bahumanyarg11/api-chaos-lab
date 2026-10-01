import type { Endpoint } from "./openapi.js";
import { responseFieldPaths } from "./openapi.js";
import { seeded, hashInt } from "./util.js";

export type FaultId =
  | "latency"
  | "timeout"
  | "http_500"
  | "http_502_html"
  | "http_503"
  | "rate_limit_429"
  | "malformed_json"
  | "missing_fields"
  | "wrong_types"
  | "schema_drift"
  | "empty_body"
  | "intermittent"
  | "auth_401"
  | "conflict_409"
  | "payload_bloat";

export interface FaultDef {
  id: FaultId;
  label: string;
  short: string;
  category: "latency" | "availability" | "rate" | "payload" | "contract" | "auth";
  description: string;
  defaults: Record<string, number | string>;
  /** Whether the client is expected to retry this failure (used by the analyzer). */
  retryable: boolean;
  /** True when the response status is still 2xx but the body is corrupted. */
  silent: boolean;
}

export const FAULTS: Record<FaultId, FaultDef> = {
  latency: { id: "latency", label: "Slow response", short: "SLOW", category: "latency", description: "Adds 2–5 s of latency before a valid response. Tests loading states, spinners and p99 budgets.", defaults: { delayMs: 3000, jitterMs: 1500 }, retryable: false, silent: true },
  timeout: { id: "timeout", label: "Timeout / hang", short: "HANG", category: "latency", description: "Hangs well past typical client timeouts, then returns 504. Clients without a timeout freeze.", defaults: { hangMs: 8000 }, retryable: true, silent: false },
  http_500: { id: "http_500", label: "500 Internal Error", short: "500", category: "availability", description: "Returns a JSON 500 error. Tests error boundaries and retry policy.", defaults: {}, retryable: true, silent: false },
  http_502_html: { id: "http_502_html", label: "502 HTML from proxy", short: "502", category: "availability", description: "Returns an HTML 'Bad Gateway' page from a load balancer instead of JSON — breaks naive response.json().", defaults: {}, retryable: true, silent: false },
  http_503: { id: "http_503", label: "503 Unavailable + Retry-After", short: "503", category: "availability", description: "Service unavailable with a Retry-After header. Tests whether clients honor server back-pressure.", defaults: { retryAfterSec: 2 }, retryable: true, silent: false },
  rate_limit_429: { id: "rate_limit_429", label: "429 Rate limited", short: "429", category: "rate", description: "Too Many Requests with Retry-After and X-RateLimit-* headers. Tests backoff and request shedding.", defaults: { retryAfterSec: 3 }, retryable: true, silent: false },
  malformed_json: { id: "malformed_json", label: "Malformed JSON", short: "{JSON", category: "payload", description: "200 OK with a truncated, unparseable JSON body. Tests parser error handling.", defaults: {}, retryable: true, silent: true },
  missing_fields: { id: "missing_fields", label: "Missing required fields", short: "MISS", category: "contract", description: "Removes required fields from the response. Tests defensive rendering and schema validation.", defaults: { count: 2 }, retryable: false, silent: true },
  wrong_types: { id: "wrong_types", label: "Wrong field types", short: "TYPE", category: "contract", description: "Numbers become strings, objects become null. Catches unchecked casts and NaN bugs.", defaults: {}, retryable: false, silent: true },
  schema_drift: { id: "schema_drift", label: "Schema drift", short: "DRIFT", category: "contract", description: "Renames fields (camelCase↔snake_case) and adds unknown ones, as if the provider shipped a breaking change.", defaults: {}, retryable: false, silent: true },
  empty_body: { id: "empty_body", label: "Empty body", short: "EMPTY", category: "payload", description: "200 OK with an empty body (or empty list). Tests empty states and null checks.", defaults: {}, retryable: false, silent: true },
  intermittent: { id: "intermittent", label: "Intermittent failure", short: "FLAKY", category: "availability", description: "Fails the first N attempts then succeeds — the classic flaky dependency. Rewards correct retries.", defaults: { failFirst: 2, status: 503 }, retryable: true, silent: false },
  auth_401: { id: "auth_401", label: "401 Token expired", short: "401", category: "auth", description: "Returns 401 with WWW-Authenticate: token expired. Tests refresh-token flow and logout handling.", defaults: {}, retryable: false, silent: false },
  conflict_409: { id: "conflict_409", label: "409 Conflict", short: "409", category: "contract", description: "Duplicate/conflicting write. Tests idempotency and user-facing conflict resolution.", defaults: {}, retryable: false, silent: false },
  payload_bloat: { id: "payload_bloat", label: "Payload bloat", short: "BLOAT", category: "payload", description: "Returns a list ~50× larger than usual. Tests pagination, virtualization and memory limits.", defaults: { multiplier: 50 }, retryable: false, silent: true },
};

export const FAULT_IDS = Object.keys(FAULTS) as FaultId[];

export interface FaultResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs: number;
  note: string;
}

const HTML_502 = `<!DOCTYPE html>
<html><head><title>502 Bad Gateway</title></head>
<body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>`;

function errorJson(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ error: { status, code, message, request_id: `req_${Math.random().toString(36).slice(2, 12)}`, ...extra } });
}

function stripFields(obj: any, fields: string[]) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) for (const f of fields) delete obj[f];
}

function mutateTypes(obj: any, rnd: () => number): any {
  if (Array.isArray(obj)) return obj.map((o) => mutateTypes(o, rnd));
  if (!obj || typeof obj !== "object") return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") out[k] = rnd() > 0.5 ? String(v) : `${v}.00 USD`;
    else if (typeof v === "boolean") out[k] = v ? "true" : 0;
    else if (typeof v === "string") out[k] = rnd() > 0.6 ? null : v;
    else if (v && typeof v === "object") out[k] = rnd() > 0.5 ? null : mutateTypes(v, rnd);
    else out[k] = v;
  }
  return out;
}

function toSnake(s: string) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
function toCamel(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function drift(obj: any): any {
  if (Array.isArray(obj)) return obj.map(drift);
  if (!obj || typeof obj !== "object") return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = k.includes("_") ? toCamel(k) : /[A-Z]/.test(k) ? toSnake(k) : k === "id" ? "uuid" : k === "name" ? "display_name" : k;
    out[nk] = v && typeof v === "object" ? drift(v) : v;
  }
  out["_v2_migrated"] = true;
  out["deprecated_fields"] = Object.keys(obj).slice(0, 2);
  return out;
}

/** Apply the list-level/record-level mutation to the healthy body. */
function onRecords(body: any, endpoint: Endpoint, fn: (rec: any) => any): any {
  const shape = responseFieldPaths(endpoint.successSchema);
  if (Array.isArray(body)) return body.map(fn);
  if (shape.container === "data" && Array.isArray(body?.data)) return { ...body, data: body.data.map(fn) };
  if (shape.container === "items" && Array.isArray(body?.items)) return { ...body, items: body.items.map(fn) };
  return fn(body);
}

export interface ApplyContext {
  endpoint: Endpoint;
  healthyBody: unknown; // parsed healthy response
  healthyStatus: number;
  params: Record<string, number | string>;
  attempt: number; // for intermittent (1-based count within the window)
  seedKey: string;
}

export function applyFault(fault: FaultId, ctx: ApplyContext): FaultResult {
  const def = FAULTS[fault];
  const p = { ...def.defaults, ...ctx.params } as Record<string, any>;
  const json = { "content-type": "application/json" };
  const rnd = seeded(hashInt(ctx.seedKey + fault));
  switch (fault) {
    case "latency": {
      const delay = Number(p.delayMs) + Math.floor(rnd() * Number(p.jitterMs ?? 0));
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(ctx.healthyBody), delayMs: delay, note: `Delayed ${delay} ms` };
    }
    case "timeout": {
      const hang = Math.min(Number(p.hangMs), 25000);
      return { status: 504, headers: json, body: errorJson(504, "gateway_timeout", "Upstream did not respond in time"), delayMs: hang, note: `Hung ${hang} ms then 504` };
    }
    case "http_500":
      return { status: 500, headers: json, body: errorJson(500, "internal_error", "An unexpected error occurred. Please try again."), delayMs: 40 + Math.floor(rnd() * 120), note: "500 Internal Server Error" };
    case "http_502_html":
      return { status: 502, headers: { "content-type": "text/html; charset=utf-8", server: "nginx" }, body: HTML_502, delayMs: 30, note: "HTML 502 from proxy" };
    case "http_503": {
      const ra = Number(p.retryAfterSec);
      return { status: 503, headers: { ...json, "retry-after": String(ra) }, body: errorJson(503, "service_unavailable", "Service temporarily unavailable", { retry_after: ra }), delayMs: 25, note: `503 with Retry-After: ${ra}s` };
    }
    case "rate_limit_429": {
      const ra = Number(p.retryAfterSec);
      const reset = Math.floor(Date.now() / 1000) + ra;
      return {
        status: 429,
        headers: { ...json, "retry-after": String(ra), "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
        body: errorJson(429, "rate_limited", `Rate limit exceeded. Retry after ${ra} seconds.`, { retry_after: ra }),
        delayMs: 15,
        note: `429 with Retry-After: ${ra}s`,
      };
    }
    case "malformed_json": {
      const full = JSON.stringify(ctx.healthyBody ?? { ok: true });
      const cut = Math.max(8, Math.floor(full.length * (0.35 + rnd() * 0.3)));
      return { status: ctx.healthyStatus, headers: json, body: full.slice(0, cut), delayMs: 20, note: `Truncated JSON at byte ${cut}/${full.length}` };
    }
    case "missing_fields": {
      const shape = responseFieldPaths(ctx.endpoint.successSchema);
      const pool = shape.required.length ? shape.required : shape.fields;
      const victims = pool.slice(0, Math.max(1, Number(p.count)));
      const clone = structuredClone(ctx.healthyBody);
      const body = onRecords(clone, ctx.endpoint, (r) => {
        stripFields(r, victims.length ? victims : Object.keys(r ?? {}).slice(0, 2));
        return r;
      });
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(body), delayMs: 20, note: `Removed fields: ${victims.join(", ") || "(first fields)"}` };
    }
    case "wrong_types": {
      const body = onRecords(structuredClone(ctx.healthyBody), ctx.endpoint, (r) => mutateTypes(r, rnd));
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(body), delayMs: 20, note: "Mutated field types (number→string, object→null)" };
    }
    case "schema_drift": {
      const body = onRecords(structuredClone(ctx.healthyBody), ctx.endpoint, drift);
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(body), delayMs: 20, note: "Renamed fields + unknown fields (v2 drift)" };
    }
    case "empty_body": {
      const isList = Array.isArray(ctx.healthyBody);
      return { status: ctx.healthyStatus, headers: json, body: isList ? "[]" : "", delayMs: 15, note: isList ? "Empty list" : "Empty body" };
    }
    case "intermittent": {
      const failFirst = Number(p.failFirst);
      if (ctx.attempt <= failFirst) {
        const st = Number(p.status) || 503;
        return { status: st, headers: { ...json, ...(st === 503 ? { "retry-after": "1" } : {}) }, body: errorJson(st, "transient_failure", `Transient failure (attempt ${ctx.attempt}/${failFirst + 1})`), delayMs: 30, note: `Flaky: failed attempt ${ctx.attempt} of ${failFirst + 1}` };
      }
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(ctx.healthyBody), delayMs: 20, note: `Flaky: attempt ${ctx.attempt} succeeded` };
    }
    case "auth_401":
      return { status: 401, headers: { ...json, "www-authenticate": 'Bearer error="invalid_token", error_description="The access token expired"' }, body: errorJson(401, "token_expired", "The access token expired"), delayMs: 15, note: "401 token expired" };
    case "conflict_409":
      return { status: 409, headers: json, body: errorJson(409, "conflict", "A resource with the same identifier already exists or was modified concurrently"), delayMs: 20, note: "409 Conflict" };
    case "payload_bloat": {
      const mult = Math.min(Number(p.multiplier), 200);
      let body: any = ctx.healthyBody;
      const grow = (arr: any[]) => Array.from({ length: arr.length * mult }, (_, i) => ({ ...(arr[i % arr.length] ?? {}), _row: i }));
      if (Array.isArray(body)) body = grow(body);
      else if (Array.isArray(body?.data)) body = { ...body, data: grow(body.data) };
      else if (Array.isArray(body?.items)) body = { ...body, items: grow(body.items) };
      else body = { ...(body ?? {}), _padding: "x".repeat(200_000) };
      return { status: ctx.healthyStatus, headers: json, body: JSON.stringify(body), delayMs: 300, note: `Payload ×${mult}` };
    }
  }
}
