import YAML from "yaml";
import { HttpError, hashInt, seeded } from "./util.js";

export type Schema = Record<string, any>;

export interface Endpoint {
  key: string; // "GET /users/{id}"
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  params: { name: string; in: string; required: boolean; schema?: Schema }[];
  requestSchema?: Schema;
  successStatus: number;
  successSchema?: Schema;
  successExample?: unknown;
  errorStatuses: number[];
  requiresAuth: boolean;
  idempotent: boolean;
  isList: boolean;
  semantics: string[]; // e.g. ["payment","auth","list","write","search"]
}

export interface CompiledSpec {
  title: string;
  version: string;
  description?: string;
  servers: string[];
  openapi: string;
  endpoints: Endpoint[];
  securitySchemes: string[];
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function parseSpecText(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new HttpError(400, "Spec is empty");
  let doc: any;
  try {
    doc = trimmed.startsWith("{") ? JSON.parse(trimmed) : YAML.parse(trimmed);
  } catch (e: any) {
    throw new HttpError(400, `Could not parse spec as JSON or YAML: ${e.message}`);
  }
  if (!doc || typeof doc !== "object") throw new HttpError(400, "Spec must be an object");
  if (!doc.openapi && !doc.swagger) throw new HttpError(400, "Not an OpenAPI/Swagger document (missing `openapi` or `swagger` field)");
  if (!doc.paths || typeof doc.paths !== "object") throw new HttpError(400, "Spec has no `paths`");
  return doc;
}

function resolvePointer(doc: any, ref: string): any {
  if (!ref.startsWith("#/")) return undefined; // external refs not supported
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = doc;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Inline $refs (with cycle + depth guards) so schemas are self-contained. */
export function deref(doc: any, node: any, depth = 0, seen: Set<string> = new Set()): any {
  if (node == null || typeof node !== "object") return node;
  if (depth > 12) return {};
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, depth + 1, seen));
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (seen.has(ref)) return { type: "object", description: `(recursive ${ref.split("/").pop()})` };
    const target = resolvePointer(doc, ref);
    const next = new Set(seen);
    next.add(ref);
    const resolved = deref(doc, target ?? {}, depth + 1, next);
    return { ...resolved, "x-ref": ref.split("/").pop() };
  }
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "example" || k === "examples") {
      out[k] = v;
      continue;
    }
    out[k] = deref(doc, v, depth + 1, seen);
  }
  return out;
}

function pickJsonContent(content: any): any {
  if (!content || typeof content !== "object") return undefined;
  const keys = Object.keys(content);
  const k = keys.find((x) => x.includes("json")) ?? keys[0];
  return k ? content[k] : undefined;
}

const SEMANTIC_RULES: [string, RegExp][] = [
  ["payment", /pay|charge|checkout|billing|invoice|refund|transfer|wallet|subscription|card|transaction/i],
  ["auth", /auth|login|logout|token|session|oauth|signin|signup|password|otp/i],
  ["search", /search|query|find|lookup|filter/i],
  ["order", /order|cart|basket|purchase|booking|reservation/i],
  ["user", /user|account|profile|customer|member/i],
  ["inventory", /inventory|stock|product|catalog|item|sku/i],
  ["notification", /notif|email|sms|message|webhook|push/i],
  ["file", /upload|file|image|media|attachment|download/i],
  ["health", /health|status|ping|ready|live/i],
];

export function compileSpec(doc: any): CompiledSpec {
  const isSwagger2 = !!doc.swagger;
  const servers: string[] = isSwagger2
    ? doc.host
      ? [`${(doc.schemes?.[0] ?? "https")}://${doc.host}${doc.basePath ?? ""}`]
      : []
    : (doc.servers ?? []).map((s: any) => s.url).filter(Boolean);
  const securitySchemes = Object.keys(
    isSwagger2 ? doc.securityDefinitions ?? {} : doc.components?.securitySchemes ?? {},
  );
  const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;

  const endpoints: Endpoint[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    const pathItem = item.$ref ? resolvePointer(doc, item.$ref) ?? {} : item;
    const sharedParams = pathItem.parameters ?? [];
    for (const m of METHODS) {
      const op = pathItem[m];
      if (!op) continue;
      const method = m.toUpperCase();
      const rawParams = [...sharedParams, ...(op.parameters ?? [])].map((p: any) => deref(doc, p));
      const params = rawParams
        .filter((p: any) => p && p.name && p.in !== "body")
        .map((p: any) => ({ name: p.name, in: p.in, required: !!p.required, schema: p.schema ?? (p.type ? { type: p.type } : undefined) }));

      let requestSchema: Schema | undefined;
      if (isSwagger2) {
        const body = rawParams.find((p: any) => p?.in === "body");
        requestSchema = body?.schema;
      } else if (op.requestBody) {
        const rb = deref(doc, op.requestBody);
        requestSchema = pickJsonContent(rb.content)?.schema;
      }

      const responses = op.responses ?? {};
      const codes = Object.keys(responses);
      const successCode = codes.find((c) => /^2\d\d$/.test(c)) ?? (codes.includes("default") ? "default" : undefined);
      let successSchema: Schema | undefined;
      let successExample: unknown;
      if (successCode) {
        const r = deref(doc, responses[successCode]);
        if (isSwagger2) {
          successSchema = r?.schema;
          successExample = r?.examples ? Object.values(r.examples)[0] : undefined;
        } else {
          const media = pickJsonContent(r?.content);
          successSchema = media?.schema;
          successExample = media?.example ?? (media?.examples ? (Object.values<any>(media.examples)[0]?.value) : undefined);
        }
      }
      const successStatus = successCode && successCode !== "default" ? Number(successCode) : method === "POST" ? 201 : 200;
      const errorStatuses = codes.filter((c) => /^[45]\d\d$/.test(c)).map(Number);
      const requiresAuth = Array.isArray(op.security) ? op.security.length > 0 : globalSecurity;
      const idempotent = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method);
      const isList =
        method === "GET" &&
        (successSchema?.type === "array" ||
          !!successSchema?.properties?.items ||
          !!successSchema?.properties?.data?.items ||
          !/\{[^}]+\}$/.test(path));
      const text = `${path} ${op.operationId ?? ""} ${op.summary ?? ""} ${(op.tags ?? []).join(" ")}`;
      const semantics = SEMANTIC_RULES.filter(([, re]) => re.test(text)).map(([s]) => s);
      if (method !== "GET" && method !== "HEAD") semantics.push("write");
      if (isList) semantics.push("list");

      endpoints.push({
        key: `${method} ${path}`,
        method,
        path,
        operationId: op.operationId,
        summary: op.summary,
        description: typeof op.description === "string" ? op.description.slice(0, 500) : undefined,
        tags: op.tags ?? [],
        params,
        requestSchema: requestSchema ? deref(doc, requestSchema) : undefined,
        successStatus,
        successSchema: successSchema ? deref(doc, successSchema) : undefined,
        successExample,
        errorStatuses,
        requiresAuth,
        idempotent,
        isList,
        semantics: [...new Set(semantics)],
      });
    }
  }
  if (endpoints.length === 0) throw new HttpError(400, "No operations found under `paths`");
  return {
    title: doc.info?.title ?? "Untitled API",
    version: doc.info?.version ?? "0.0.0",
    description: typeof doc.info?.description === "string" ? doc.info.description.slice(0, 1000) : undefined,
    servers,
    openapi: doc.openapi ?? doc.swagger,
    endpoints: endpoints.slice(0, 200),
    securitySchemes,
  };
}

/** Match a concrete request path to a templated OpenAPI path. */
export function matchEndpoint(endpoints: Endpoint[], method: string, path: string): { endpoint: Endpoint; pathParams: Record<string, string> } | undefined {
  const clean = "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
  let best: { endpoint: Endpoint; pathParams: Record<string, string>; score: number } | undefined;
  for (const ep of endpoints) {
    if (ep.method !== method.toUpperCase()) continue;
    const names: string[] = [];
    const pattern = ep.path
      .replace(/\/+$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "{" || c === "}" ? c : "\\" + c))
      .replace(/\{([^}]+)\}/g, (_, n) => {
        names.push(n);
        return "([^/]+)";
      });
    const re = new RegExp(`^${pattern || "/"}$`);
    const m = re.exec(clean === "" ? "/" : clean);
    if (!m) continue;
    const score = ep.path.split("/").filter((s) => s && !s.startsWith("{")).length * 10 - names.length;
    if (!best || score > best.score) {
      const pathParams: Record<string, string> = {};
      names.forEach((n, i) => (pathParams[n] = decodeURIComponent(m[i + 1])));
      best = { endpoint: ep, pathParams, score };
    }
  }
  return best ? { endpoint: best.endpoint, pathParams: best.pathParams } : undefined;
}

// ---------- Mock data generation ----------
const FIRST = ["Ava", "Liam", "Maya", "Noah", "Zara", "Ethan", "Isla", "Arjun", "Mei", "Leo", "Sofia", "Kai"];
const LAST = ["Patel", "Garcia", "Chen", "Okafor", "Silva", "Kim", "Novak", "Haddad", "Rossi", "Sato"];
const WORDS = ["quantum", "orbit", "nimbus", "ember", "vector", "lumen", "atlas", "cobalt", "delta", "nova", "pulse", "zen"];
const PRODUCTS = ["Wireless Headphones", "Mechanical Keyboard", "Smart Watch", "4K Monitor", "Travel Backpack", "Espresso Maker", "Running Shoes", "Desk Lamp"];
const CITIES = ["Seattle", "Bengaluru", "Berlin", "Austin", "Tokyo", "Lagos", "São Paulo", "Toronto"];

let parentHint = "";
function fakeString(name: string, schema: Schema, rnd: () => number): string {
  const n = name.toLowerCase();
  const parent = parentHint.toLowerCase();
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const fmt = schema.format;
  if (schema.enum?.length) return pick(schema.enum);
  if (fmt === "date-time" || /(_at|At|date|time)$/.test(name)) return new Date(1767225600000 + Math.floor(rnd() * 3e10)).toISOString();
  if (fmt === "date") return new Date(1767225600000 + Math.floor(rnd() * 3e10)).toISOString().slice(0, 10);
  if (fmt === "email" || n.includes("email")) return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}@example.com`;
  if (fmt === "uuid" || n === "id" || n.endsWith("id") || n.endsWith("_id")) {
    const h = Math.floor(rnd() * 0xffffffff).toString(16).padStart(8, "0");
    return fmt === "uuid" ? `${h}-${h.slice(0, 4)}-4${h.slice(1, 4)}-a${h.slice(5, 8)}-${h}${h.slice(0, 4)}` : `${n.replace(/_?id$/, "").slice(0, 3) || "obj"}_${h}`;
  }
  if (fmt === "uri" || fmt === "url" || n.includes("url") || n.includes("link")) return `https://cdn.example.com/${pick(WORDS)}/${Math.floor(rnd() * 9999)}`;
  if (n.includes("phone")) return `+1-555-${String(Math.floor(rnd() * 9000) + 1000)}`;
  if (n === "name" && /product|item|sku|catalog/.test(parent)) return pick(PRODUCTS);
  if (n === "name" && /pet|animal/.test(parent)) return pick(["Biscuit", "Luna", "Mochi", "Pepper", "Ziggy", "Nala"]);
  if (n === "name" && /category|tag/.test(parent)) return pick(["Electronics", "Home", "Outdoors", "Audio"]);
  if (n === "name" || n.includes("fullname") || n.includes("full_name")) return `${pick(FIRST)} ${pick(LAST)}`;
  if (n.includes("first")) return pick(FIRST);
  if (n.includes("last")) return pick(LAST);
  if (n.includes("city")) return pick(CITIES);
  if (n.includes("country")) return pick(["US", "IN", "DE", "JP", "BR", "CA"]);
  if (n.includes("currency")) return pick(["USD", "EUR", "INR", "JPY"]);
  if (n.includes("status")) return pick(["active", "pending", "completed"]);
  if (n.includes("title") || n.includes("product")) return pick(PRODUCTS);
  if (n.includes("token")) return `tok_${Math.floor(rnd() * 1e12).toString(36)}`;
  if (n.includes("desc") || n.includes("message") || n.includes("note")) return `The ${pick(WORDS)} ${pick(WORDS)} is operating nominally.`;
  if (n.includes("user")) return `${pick(FIRST).toLowerCase()}_${Math.floor(rnd() * 999)}`;
  return `${pick(WORDS)}-${Math.floor(rnd() * 999)}`;
}

export function sampleFromSchema(schema: Schema | undefined, seedKey: string, name = "", depth = 0): unknown {
  const rnd = seeded(hashInt(seedKey + "|" + name + "|" + depth));
  return gen(schema, name, depth, rnd);
}

function gen(schema: Schema | undefined, name: string, depth: number, rnd: () => number): unknown {
  if (!schema || depth > 6) return name ? fakeString(name, {}, rnd) : {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined && depth > 0) return schema.default;
  if (schema.allOf) {
    return schema.allOf.reduce((acc: any, s: Schema) => ({ ...acc, ...(gen(s, name, depth, rnd) as object) }), {});
  }
  if (schema.oneOf || schema.anyOf) return gen((schema.oneOf ?? schema.anyOf)[0], name, depth, rnd);
  if (schema.enum?.length) return schema.enum[Math.floor(rnd() * schema.enum.length)];
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type ?? (schema.properties ? "object" : schema.items ? "array" : undefined);
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const prevHint = parentHint;
      parentHint = schema["x-ref"] ?? (name || parentHint);
      const props = schema.properties ?? {};
      for (const [k, v] of Object.entries<Schema>(props)) out[k] = gen(v, k, depth + 1, rnd);
      if (Object.keys(props).length === 0 && schema.additionalProperties && typeof schema.additionalProperties === "object") {
        out["key"] = gen(schema.additionalProperties, "value", depth + 1, rnd);
      }
      parentHint = prevHint;
      return out;
    }
    case "array": {
      const count = Math.min(schema.maxItems ?? 3, Math.max(schema.minItems ?? 2, 3));
      return Array.from({ length: count }, (_, i) => gen(schema.items, name.replace(/s$/, "") + i, depth + 1, rnd));
    }
    case "integer": {
      const n = name.toLowerCase();
      const min = schema.minimum ?? (n.includes("age") ? 18 : n.includes("qty") || n.includes("quantity") ? 1 : 1);
      const max = schema.maximum ?? (n.includes("age") ? 80 : n.includes("total") || n.includes("count") ? 500 : 1000);
      return Math.floor(min + rnd() * (max - min));
    }
    case "number": {
      const n = name.toLowerCase();
      if (n.includes("price") || n.includes("amount") || n.includes("total") || n.includes("balance")) return Math.round(rnd() * 50000) / 100;
      if (n.includes("rating") || n.includes("score")) return Math.round((3 + rnd() * 2) * 10) / 10;
      if (n.includes("surge")) return Math.round((1 + rnd()) * 10) / 10;
      if (n.includes("lat")) return Math.round((rnd() * 180 - 90) * 1e5) / 1e5;
      if (n.includes("lon") || n.includes("lng")) return Math.round((rnd() * 360 - 180) * 1e5) / 1e5;
      return Math.round(rnd() * 10000) / 100;
    }
    case "boolean":
      return rnd() > 0.4;
    case "string":
      return fakeString(name, schema, rnd);
    default:
      return name ? fakeString(name, schema, rnd) : null;
  }
}

/** Required (or all, if none declared) top-level field names of a response schema, descending into list wrappers. */
export function responseFieldPaths(schema: Schema | undefined): { container: "root" | "items" | "data"; fields: string[]; required: string[] } {
  if (!schema) return { container: "root", fields: [], required: [] };
  let target = schema;
  let container: "root" | "items" | "data" = "root";
  if (schema.type === "array" && schema.items) {
    target = schema.items;
    container = "items";
  } else if (schema.properties?.data?.items) {
    target = schema.properties.data.items;
    container = "data";
  } else if (schema.properties?.items?.items) {
    target = schema.properties.items.items;
    container = "items";
  }
  const fields = Object.keys(target.properties ?? {});
  return { container, fields, required: target.required ?? fields.slice(0, 3) };
}

/** Compact summary of the API suitable for an LLM prompt. */
export function summarizeForLLM(spec: CompiledSpec, maxEndpoints = 40): string {
  const lines = [`API: ${spec.title} v${spec.version}`, spec.description ? `Description: ${spec.description.slice(0, 400)}` : "", `Auth schemes: ${spec.securitySchemes.join(", ") || "none declared"}`, "Endpoints:"];
  for (const ep of spec.endpoints.slice(0, maxEndpoints)) {
    const fields = responseFieldPaths(ep.successSchema);
    const req = ep.requestSchema?.properties ? Object.keys(ep.requestSchema.properties).slice(0, 10).join(",") : "";
    lines.push(
      `- ${ep.key}${ep.summary ? ` — ${ep.summary}` : ""} | auth:${ep.requiresAuth ? "yes" : "no"} | idempotent:${ep.idempotent} | semantics:${ep.semantics.join("/") || "generic"}${req ? ` | body:{${req}}` : ""}${fields.fields.length ? ` | returns:${fields.container}{${fields.fields.slice(0, 12).join(",")}} required:[${fields.required.slice(0, 8).join(",")}]` : ""}${ep.errorStatuses.length ? ` | documented errors:${ep.errorStatuses.join(",")}` : ""}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}
