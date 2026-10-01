import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { HttpError } from "./util.js";

export interface Req {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
  body: any;
  ip: string;
  params: Record<string, string>;
}

export type Res = APIGatewayProxyStructuredResultV2 & { headers: Record<string, string> };

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "x-chaos-fault,x-chaos-scenario,x-chaos-event,retry-after,x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset",
};

export function toReq(event: APIGatewayProxyEventV2): Req {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v != null) headers[k.toLowerCase()] = v;
  let rawBody = event.body ?? "";
  if (event.isBase64Encoded && rawBody) rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  let body: any;
  if (rawBody && (headers["content-type"] ?? "").includes("json")) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = undefined;
    }
  }
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) if (v != null) query[k] = v;
  return {
    method: (event.requestContext?.http?.method ?? "GET").toUpperCase(),
    path: event.rawPath ?? event.requestContext?.http?.path ?? "/",
    query,
    headers,
    rawBody,
    body,
    ip: event.requestContext?.http?.sourceIp ?? headers["x-forwarded-for"]?.split(",")[0] ?? "0.0.0.0",
    params: {},
  };
}

export function json(status: number, data: unknown, headers: Record<string, string> = {}): Res {
  return { statusCode: status, headers: { "content-type": "application/json", ...CORS, ...headers }, body: JSON.stringify(data) };
}

type Handler = (req: Req) => Promise<Res>;

export class Router {
  private routes: { method: string; re: RegExp; names: string[]; h: Handler }[] = [];
  on(method: string, pattern: string, h: Handler) {
    const names: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:([a-zA-Z]+)/g, (_, n) => (names.push(n), "([^/]+)")) + "/?$");
    this.routes.push({ method, re, names, h });
    return this;
  }
  async handle(req: Req): Promise<Res> {
    if (req.method === "OPTIONS") return { statusCode: 204, headers: { ...CORS }, body: "" };
    try {
      for (const r of this.routes) {
        if (r.method !== req.method && r.method !== "*") continue;
        const m = r.re.exec(req.path);
        if (!m) continue;
        r.names.forEach((n, i) => (req.params[n] = decodeURIComponent(m[i + 1])));
        return await r.h(req);
      }
      return json(404, { error: `No route for ${req.method} ${req.path}` });
    } catch (e: any) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, details: e.details });
      console.error(JSON.stringify({ msg: "unhandled", error: e?.message, stack: e?.stack }));
      return json(500, { error: "Internal error", message: e?.message });
    }
  }
}
