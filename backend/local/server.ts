import http from "node:http";
import fs from "node:fs";
import path from "node:path";
process.env.LOCAL_DB_FILE ??= ".local/db.json";
process.env.LOCAL_BLOB_DIR ??= ".local/blobs";
const { route: apiRoute } = await import("../src/handlers/api.js");
const { route: chaosRoute } = await import("../src/handlers/chaos.js");
const { runJob } = await import("../src/handlers/worker.js");
const { setLocalJobRunner } = await import("../src/lib/jobs.js");
setLocalJobRunner(runJob);

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = path.resolve(import.meta.dirname, "../../web/dist");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".mp4": "video/mp4", ".ico": "image/x-icon", ".webp": "image/webp" };

http
  .createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body: any;
    if (rawBody && (headers["content-type"] ?? "").includes("json")) try { body = JSON.parse(rawBody); } catch {}
    const r = { method: (req.method ?? "GET").toUpperCase(), path: url.pathname, query: Object.fromEntries(url.searchParams), headers, rawBody, body, ip: req.socket.remoteAddress ?? "127.0.0.1", params: {} };
    let out;
    if (url.pathname.startsWith("/api/")) out = await apiRoute(r);
    else if (url.pathname.startsWith("/x/")) out = await chaosRoute(r);
    else {
      let f = path.join(WEB_DIST, url.pathname);
      if (!f.startsWith(WEB_DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WEB_DIST, "index.html");
      if (!fs.existsSync(f)) { res.writeHead(404).end("web not built"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" }).end(fs.readFileSync(f));
      return;
    }
    res.writeHead(out.statusCode ?? 200, out.headers as any).end(out.body ?? "");
  })
  .listen(PORT, () => console.log(`ChaosLab local on http://localhost:${PORT}`));
