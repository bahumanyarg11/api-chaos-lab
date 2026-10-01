// Builds the Vercel deployment with the Build Output API (.vercel/output):
//   static/            ← web/dist (React app)
//   functions/api.func ← esbuild bundle of backend/vercel/handler.ts (control plane + chaos data plane)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".vercel/output");
const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: "inherit" });

if (!fs.existsSync(path.join(ROOT, "web/node_modules"))) sh("npm ci --no-audit --no-fund", path.join(ROOT, "web"));
if (!fs.existsSync(path.join(ROOT, "backend/node_modules/@upstash"))) sh("npm ci --omit=dev --no-audit --no-fund", path.join(ROOT, "backend"));
sh("npx vite build", path.join(ROOT, "web"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "functions/api.func"), { recursive: true });
fs.cpSync(path.join(ROOT, "web/dist"), path.join(OUT, "static"), { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "backend/vercel/handler.ts")],
  outfile: path.join(OUT, "functions/api.func/index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  sourcemap: false,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

fs.writeFileSync(
  path.join(OUT, "functions/api.func/.vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300 }, null, 2),
);
fs.writeFileSync(
  path.join(OUT, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api/(.*)$", dest: "/api?__path=/api/$1" },
        { src: "^/x/(.*)$", dest: "/api?__path=/x/$1" },
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("✓ .vercel/output ready");
