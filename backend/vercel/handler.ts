import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { route as apiRoute } from "../src/handlers/api.js";
import { route as chaosRoute } from "../src/handlers/chaos.js";
import { runJob } from "../src/handlers/worker.js";
import { setLocalJobRunner } from "../src/lib/jobs.js";
import type { Req } from "../src/lib/http.js";

// Vercel serverless entry: one function serves the control plane (/api/*) and the chaos data plane (/x/*).
// AI jobs run in-process after the response via waitUntil.
setLocalJobRunner(runJob, (p) => waitUntil(p));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = new URL(req.url ?? "/", "http://internal");
  const original = url.searchParams.get("__path");
  url.searchParams.delete("__path");
  const path = original ?? url.pathname;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
  const rawBody = Buffer.concat(chunks).toString("utf8");
  let body: any;
  if (rawBody && (headers["content-type"] ?? "").includes("json")) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = undefined;
    }
  }
  const r: Req = {
    method: (req.method ?? "GET").toUpperCase(),
    path,
    query: Object.fromEntries(url.searchParams),
    headers,
    rawBody,
    body,
    ip: headers["x-real-ip"] ?? headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? "0.0.0.0",
    params: {},
  };
  const out = path.startsWith("/x/") ? await chaosRoute(r) : await apiRoute(r);
  res.writeHead(out.statusCode ?? 200, out.headers as Record<string, string>);
  res.end(out.body ?? "");
}
