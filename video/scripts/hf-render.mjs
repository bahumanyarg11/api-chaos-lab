// Renders one HyperFrames project to an MP4.
// usage: node scripts/hf-render.mjs <projectDir> <out.mp4> [--variables-file f.json]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [projectDir, out, ...rest] = process.argv.slice(2);
if (!projectDir || !out) { console.error("usage: hf-render.mjs <projectDir> <out.mp4> [extra hyperframes args]"); process.exit(2); }

const cli = path.join(root, "node_modules/hyperframes/dist/cli.js");
const freeMb = (p) => { const s = fs.statfsSync(p); return (Number(s.bsize) * Number(s.bavail)) / 1048576; };
const REAL_FLOOR_MB = Number(process.env.HF_MIN_FREE_MB || 250);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const free = freeMb(path.dirname(path.resolve(out)));
const nodeArgs = [];
if (free < 1024) {
  if (free < REAL_FLOOR_MB) {
    console.error(`[hf] only ${free.toFixed(0)} MB free (< ${REAL_FLOOR_MB} MB floor) — refusing to render`);
    process.exit(3);
  }
  console.warn(`[hf] ${free.toFixed(0)} MB free (< 1 GiB HyperFrames preflight) — loading low-disk shim`);
  nodeArgs.push("--import", path.join(root, "scripts/hf-lowdisk-shim.mjs"));
}
const env = { ...process.env, HYPERFRAMES_RENDER_DETACHED: "1", HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", DO_NOT_TRACK: "1", CI: "1" };
const args = [...nodeArgs, cli, "render", path.resolve(projectDir), "-o", path.resolve(out),
  "--fps", "30", "--quality", "delivery", "--workers", process.env.HF_WORKERS || "4", "--quiet", ...rest];
console.log(`[hf] node ${args.filter((a) => !a.endsWith("shim.mjs") && a !== "--import").map((a) => a.replace(root + "/", "")).join(" ")}`);
const r = spawnSync(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], env, cwd: root });
if (r.status !== 0) { console.error(`[hf] render failed with exit code ${r.status}`); process.exit(r.status || 1); }
console.log(`[hf] wrote ${out}`);
