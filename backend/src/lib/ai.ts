import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { FAULT_IDS, FAULTS } from "./faults.js";
import type { CompiledSpec, Endpoint } from "./openapi.js";
import { summarizeForLLM } from "./openapi.js";
import type { Analysis, Finding } from "./analyzer.js";
import type { ChaosEvent, Scenario } from "./types.js";

/**
 * AI layer on Amazon Bedrock (Converse API, model-agnostic).
 * BEDROCK_MODEL_IDS is an ordered, comma-separated fallback chain of Bedrock model / inference-profile IDs.
 * Structured output is obtained by forcing a single tool call whose input schema is the desired JSON schema,
 * with a plain-JSON prompt fallback. If Bedrock is unreachable (no AWS credentials), deterministic templates
 * keep the product fully functional.
 */
const REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const MODELS = (process.env.BEDROCK_MODEL_IDS ?? "us.amazon.nova-pro-v1:0,us.amazon.nova-lite-v1:0").split(",").map((s) => s.trim()).filter(Boolean);
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_PROFILE || process.env.AWS_WEB_IDENTITY_TOKEN_FILE || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
const AI_DISABLED = process.env.AI_DISABLED === "1" || !HAS_AWS;

let runtime: BedrockRuntimeClient | undefined;

export interface AiResult<T> {
  data: T;
  model: string; // which model produced it ("heuristic" if none)
}

const SYSTEM = `You are ChaosLab's resilience engineer: a senior SRE who designs chaos experiments for HTTP APIs and reviews how client applications behave under failure. Be specific to the API's domain and field names, practical, and concise. Never invent endpoints that are not in the provided spec.`;

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

async function callBedrock<T>(prompt: string, schema: Record<string, unknown>, maxTokens: number): Promise<AiResult<T>> {
  runtime ??= new BedrockRuntimeClient({ region: REGION, maxAttempts: 2 });
  let lastErr: unknown;
  for (const modelId of MODELS) {
    // 1) forced tool call → schema-shaped JSON
    try {
      const res = await runtime.send(
        new ConverseCommand({
          modelId,
          system: [{ text: SYSTEM }],
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens, temperature: 0.3 },
          toolConfig: { tools: [{ toolSpec: { name: "submit_result", description: "Submit the final structured result.", inputSchema: { json: schema as any } } }], toolChoice: { tool: { name: "submit_result" } } },
        }),
      );
      const block = res.output?.message?.content?.find((c) => c.toolUse);
      if (block?.toolUse?.input) return { data: block.toolUse.input as T, model: modelId };
      const text = res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
      return { data: extractJson(text) as T, model: modelId };
    } catch (e) {
      lastErr = e;
      console.warn(JSON.stringify({ msg: "bedrock tool-mode failed", modelId, error: String((e as any)?.message ?? e).slice(0, 300) }));
    }
    // 2) plain JSON prompt
    try {
      const res = await runtime.send(
        new ConverseCommand({
          modelId,
          system: [{ text: SYSTEM + " Respond with a single JSON object only - no prose, no markdown fences." }],
          messages: [{ role: "user", content: [{ text: `${prompt}\n\nReturn JSON that validates against this JSON Schema:\n${JSON.stringify(schema)}` }] }],
          inferenceConfig: { maxTokens, temperature: 0.3 },
        }),
      );
      const text = res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
      return { data: extractJson(text) as T, model: modelId };
    } catch (e) {
      lastErr = e;
      console.warn(JSON.stringify({ msg: "bedrock json-mode failed", modelId, error: String((e as any)?.message ?? e).slice(0, 300) }));
    }
  }
  throw lastErr;
}

async function generate<T>(prompt: string, schema: Record<string, unknown>, opts: { maxTokens: number }, fallback: () => T): Promise<AiResult<T>> {
  if (!AI_DISABLED) {
    try {
      return await callBedrock<T>(prompt, schema, opts.maxTokens);
    } catch {
      /* fall through to deterministic templates */
    }
  }
  return { data: fallback(), model: "heuristic" };
}

export const aiEnabled = () => !AI_DISABLED;

// ------------------------------------------------------------------ matrix
export interface AiMatrix {
  summary: string;
  scenarios: { endpointKey: string; fault: string; severity: "low" | "medium" | "high" | "critical"; title: string; rationale: string; expectedHandling: string }[];
}

const MATRIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "scenarios"],
  properties: {
    summary: { type: "string", description: "2-3 sentence risk profile of this API: which endpoints are most dangerous to fail and why." },
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["endpointKey", "fault", "severity", "title", "rationale", "expectedHandling"],
        properties: {
          endpointKey: { type: "string", description: "Exactly as listed, e.g. 'POST /payments'" },
          fault: { type: "string", enum: FAULT_IDS },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          title: { type: "string", description: "Short, specific, e.g. 'Card charge hangs mid-checkout'" },
          rationale: { type: "string", description: "Why this failure matters for THIS endpoint's semantics (1-2 sentences)." },
          expectedHandling: { type: "string", description: "What a resilient client should do (1-2 sentences)." },
        },
      },
    },
  },
};

export async function aiMatrix(spec: CompiledSpec, baseline: Scenario[]): Promise<AiResult<AiMatrix>> {
  const catalog = FAULT_IDS.map((f) => `- ${f}: ${FAULTS[f].description}`).join("\n");
  const base = Object.entries(
    baseline.reduce<Record<string, string[]>>((acc, s) => {
      (acc[s.endpointKey] ??= []).push(s.fault);
      return acc;
    }, {}),
  )
    .map(([k, v]) => `${k}: ${v.join(", ")}`)
    .join("\n");
  const prompt = `Design a chaos/failure test matrix for this API.

${summarizeForLLM(spec, 40)}

Available fault types:
${catalog}

A rule-based baseline already proposes these (endpoint: faults):
${base}

Task: choose the 3–6 MOST meaningful failure scenarios per endpoint (max 80 total), based on what each endpoint does (money movement → idempotency/double-charge; auth → token expiry; lists → empty/bloat/pagination; reads of critical fields → missing/wrong types; writes → 429/intermittent/timeout ambiguity). You may keep, re-rank or replace baseline choices. Make titles and rationale specific to the domain and field names. Mark 'critical' only for failures that can lose money/data or lock users out.`;
  return generate<AiMatrix>(prompt, MATRIX_SCHEMA, { maxTokens: 8000 }, () => ({
    summary: heuristicSummary(spec),
    scenarios: [],
  }));
}

export function heuristicSummary(spec: CompiledSpec) {
  const money = spec.endpoints.filter((e) => e.semantics.includes("payment") || e.semantics.includes("order")).map((e) => e.key);
  const auth = spec.endpoints.filter((e) => e.semantics.includes("auth")).map((e) => e.key);
  const writes = spec.endpoints.filter((e) => e.semantics.includes("write")).length;
  return `${spec.title} exposes ${spec.endpoints.length} operations (${writes} writes). ${money.length ? `Highest risk: ${money.slice(0, 3).join(", ")} — timeouts and retries here can duplicate side effects without idempotency keys. ` : ""}${auth.length ? `Auth flows (${auth.slice(0, 2).join(", ")}) must survive token expiry. ` : ""}Reads should be validated against the contract to catch drift and missing fields.`;
}

// ------------------------------------------------------------------ explain
export interface AiExplain {
  headline: string;
  whatHappened: string;
  userImpact: string;
  howToHandle: string[];
  code: { language: string; snippet: string };
}

const EXPLAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "whatHappened", "userImpact", "howToHandle", "code"],
  properties: {
    headline: { type: "string" },
    whatHappened: { type: "string", description: "Plain-English explanation of the injected failure and what the client did." },
    userImpact: { type: "string", description: "What an end user would experience if unhandled." },
    howToHandle: { type: "array", items: { type: "string" }, description: "3-5 concrete steps." },
    code: {
      type: "object",
      additionalProperties: false,
      required: ["language", "snippet"],
      properties: { language: { type: "string", enum: ["typescript", "python", "go", "java"] }, snippet: { type: "string", description: "Idiomatic, copy-pasteable code (<= 40 lines) that handles this failure." } },
    },
  },
};

export async function aiExplain(input: { event?: ChaosEvent; scenario?: Scenario; finding?: Finding; endpoint?: Endpoint; language?: string }): Promise<AiResult<AiExplain>> {
  const { event, scenario, finding, endpoint } = input;
  const lang = input.language ?? "typescript";
  const prompt = `Explain this API failure to a developer and show how their client should handle it. Use ${lang} for code.

${endpoint ? `Endpoint: ${endpoint.key}${endpoint.summary ? ` — ${endpoint.summary}` : ""} (idempotent: ${endpoint.idempotent}, semantics: ${endpoint.semantics.join("/")})` : ""}
${scenario ? `Scenario: ${scenario.title} [${scenario.fault}, severity ${scenario.severity}]\nWhy it matters: ${scenario.rationale}` : ""}
${event ? `Observed request: ${event.method} ${event.path} → HTTP ${event.status} after ${event.latencyMs} ms. Injected: ${event.fault ?? "none"} (${event.note ?? ""}). Idempotency-Key: ${event.idempotencyKey ?? "none"}. Client: ${event.clientId}.` : ""}
${finding ? `Behavioral finding from server-side observation: ${finding.title} — ${finding.detail}` : ""}`;
  return generate<AiExplain>(prompt, EXPLAIN_SCHEMA, { maxTokens: 4000 }, () => templateExplain(input));
}

function templateExplain(input: { event?: ChaosEvent; scenario?: Scenario; finding?: Finding; endpoint?: Endpoint }): AiExplain {
  const fault = input.finding?.fault ?? input.event?.fault ?? input.scenario?.fault ?? "http_500";
  const def = FAULTS[fault as keyof typeof FAULTS] ?? FAULTS.http_500;
  const ep = input.endpoint?.key ?? input.event?.endpointKey ?? input.scenario?.endpointKey ?? "the endpoint";
  return {
    headline: input.finding?.title ?? `${def.label} on ${ep}`,
    whatHappened: input.finding?.detail ?? `ChaosLab injected "${def.label}" on ${ep}. ${def.description}`,
    userImpact: def.retryable ? "Without handling, users see spinners that never end or a generic error, and repeated retries can make the outage worse." : "Without validation, the UI can render broken data, crash, or show 'undefined'.",
    howToHandle: (input.scenario?.expectedHandling ?? input.finding?.recommendation ?? "Handle the failure explicitly.").split(/(?<=\.)\s+/).filter(Boolean).concat(["Log the failure with the request id so on-call can correlate it."]),
    code: {
      language: "typescript",
      snippet: `async function call<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);           // client timeout
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (res.status === 429 || res.status === 503 || res.status >= 500) {
      if (attempt >= 3) throw new Error(\`gave up after \${attempt} retries\`);
      const ra = Number(res.headers.get("retry-after"));
      const backoff = ra ? ra * 1000 : Math.random() * 200 * 2 ** attempt; // full jitter
      await new Promise(r => setTimeout(r, backoff));
      return call<T>(url, init, attempt + 1);                    // same Idempotency-Key header
    }
    if (!res.headers.get("content-type")?.includes("json")) throw new Error(\`non-JSON \${res.status}\`);
    const data = await res.json();                               // throws on malformed JSON
    return schema.parse(data) as T;                              // validate contract (zod)
  } finally { clearTimeout(timer); }
}`,
    },
  };
}

// ------------------------------------------------------------------ report
export interface AiReport {
  verdict: string;
  executiveSummary: string;
  topRisks: { title: string; endpointKey: string; why: string; fix: string }[];
  codeFix: { language: string; title: string; snippet: string };
  nextExperiments: string[];
}

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "executiveSummary", "topRisks", "codeFix", "nextExperiments"],
  properties: {
    verdict: { type: "string", description: "One punchy sentence, e.g. 'Not production-ready: retries can double-charge customers.'" },
    executiveSummary: { type: "string", description: "3-5 sentences for an engineering lead." },
    topRisks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "endpointKey", "why", "fix"], properties: { title: { type: "string" }, endpointKey: { type: "string" }, why: { type: "string" }, fix: { type: "string" } } },
    },
    codeFix: { type: "object", additionalProperties: false, required: ["language", "title", "snippet"], properties: { language: { type: "string" }, title: { type: "string" }, snippet: { type: "string" } } },
    nextExperiments: { type: "array", items: { type: "string" } },
  },
};

export async function aiReport(spec: CompiledSpec, analysis: Analysis, clientId?: string): Promise<AiResult<AiReport>> {
  const clients = analysis.clients.filter((c) => !clientId || c.clientId === clientId);
  const lines = clients.map((c) => {
    const f = c.findings.slice(0, 12).map((x) => `  - [${x.severity}] ${x.title} @ ${x.endpointKey} (x${x.count}): ${x.detail}`).join("\n");
    const s = c.strengths.slice(0, 8).map((x) => `  + ${x.title} @ ${x.endpointKey}`).join("\n");
    return `Client "${c.clientId}": score ${c.score ?? "n/a"} (${c.grade}), ${c.requests} requests, ${c.faultsSeen} faults injected, ${c.retries} retries, ${c.recovered} recoveries, outcomes handled=${c.outcomes.handled} unhandled=${c.outcomes.unhandled}\nFindings:\n${f || "  (none)"}\nStrengths:\n${s || "  (none)"}`;
  });
  const prompt = `Write a resilience report for this chaos run against "${spec.title}".

Totals: ${analysis.totals.requests} requests, ${analysis.totals.faults} faults injected, error rate ${(analysis.totals.errorRate * 100).toFixed(1)}%, p95 latency ${analysis.totals.p95} ms, chaos coverage ${analysis.coverage.exercised}/${analysis.coverage.enabled} enabled scenarios.
Faults injected: ${analysis.byFault.map((f) => `${f.fault}×${f.count}`).join(", ") || "none"}

${lines.join("\n\n")}

Prioritize by user/business impact (money, data loss, lockout > outage amplification > UX). The codeFix should be the single highest-leverage change, in TypeScript unless the findings suggest otherwise. nextExperiments: 3-4 follow-up chaos experiments worth running.`;
  return generate<AiReport>(prompt, REPORT_SCHEMA, { maxTokens: 6000 }, () => templateReport(analysis, clients));
}

function templateReport(analysis: Analysis, clients: Analysis["clients"]): AiReport {
  const findings = clients.flatMap((c) => c.findings);
  const critical = findings.filter((f) => f.severity === "critical");
  const score = clients.length === 1 ? clients[0].score : analysis.overall.score;
  return {
    verdict: critical.length ? `Not production-ready: ${critical[0].title.toLowerCase()}.` : (score ?? 0) >= 85 ? "Resilient: the client degrades gracefully under injected failures." : "Partially resilient: several failure modes are unhandled.",
    executiveSummary: `Across ${analysis.totals.requests} requests with ${analysis.totals.faults} injected faults, the client scored ${score ?? "n/a"}/100. ${findings.length} issues were observed from the server side${critical.length ? `, including ${critical.length} critical (unsafe retries of non-idempotent writes)` : ""}. ${clients.flatMap((c) => c.strengths).length} resilient behaviours were detected.`,
    topRisks: findings.slice(0, 5).map((f) => ({ title: f.title, endpointKey: f.endpointKey, why: f.detail, fix: f.recommendation })),
    codeFix: { language: "typescript", title: "Resilient fetch wrapper: timeout + jittered backoff + Retry-After + Idempotency-Key", snippet: templateExplain({}).code.snippet },
    nextExperiments: ["Raise chaos intensity to 60% on write endpoints", "Combine latency + 429 on the checkout path", "Run schema_drift on all read endpoints with the outcome beacon enabled"],
  };
}
