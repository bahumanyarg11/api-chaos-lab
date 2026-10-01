// Low-disk-friendly Remotion render.
//
// When Remotion can't use "parallel encoding" (it needs > ~4 GB of *free* RAM for 1080p, which macOS
// rarely reports), it writes every frame as a JPEG to $TMPDIR before stitching — ~0.8 GB for this
// edit. To keep peak disk usage small this script bundles once, renders the video in muted chunks
// (each chunk's frames are deleted after it is encoded), mixes the soundtrack with ffmpeg from the
// same plan the composition uses (src/audio-plan.mjs → scripts/mix-audio.mjs), then concatenates the
// chunks (stream copy, no re-encode) and muxes AAC audio.
//
// usage: node scripts/remotion-render.mjs <out.mp4> [--poster out/poster.png --poster-frame 285]
// env:   REMOTION_BROWSER (chrome-headless-shell path), CHUNK_FRAMES (default 120), CONCURRENCY, CRF (18)
//        AUDIO_ONLY=1 — only re-mix audio and remux it onto the existing <out.mp4> (scene lengths unchanged)
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = path.resolve(args[0] || "out/chaoslab-demo.mp4");
const argVal = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const posterOut = argVal("--poster");
const posterFrame = Number(argVal("--poster-frame") ?? 285);
const CHUNK = Number(process.env.CHUNK_FRAMES || 120);
const CRF = Number(process.env.CRF || 18);
const concurrency = Number(process.env.CONCURRENCY || Math.max(2, Math.floor(os.cpus().length * 0.4)));
const browserExecutable = process.env.REMOTION_BROWSER || null;
const timing = JSON.parse(fs.readFileSync(path.join(root, "src/generated/timing.json"), "utf8"));

const work = path.join(root, "out/.chunks");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const t0 = Date.now();
const log = (...m) => console.log(`[remotion +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);

const mixAudio = () => {
  const wav = path.join(work, "audio.wav");
  execFileSync(process.execPath, [path.join(root, "scripts/mix-audio.mjs"), wav], { stdio: "inherit" });
  return wav;
};
const mux = (videoIn, videoArgs, wav, dest) => {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...videoArgs, "-i", videoIn, "-i", wav, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", dest], { stdio: "inherit" });
};

if (process.env.AUDIO_ONLY) {
  const nb = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", out]).toString().trim();
  if (Math.abs(Number(nb) - timing.totalFrames) > 3) throw new Error(`AUDIO_ONLY: ${out} has ${nb} frames but the edit has ${timing.totalFrames} — run a full render`);
  const tmp = path.join(work, "remux.mp4");
  mux(out, [], mixAudio(), tmp);
  fs.renameSync(tmp, out);
  fs.rmSync(work, { recursive: true, force: true });
  log(`remuxed audio → ${path.relative(root, out)}`);
  process.exit(0);
}

log("bundling…");
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaoslab-bundle-"));
const cleanup = () => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
};
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const freeMb = () => { const st = fs.statfsSync(os.tmpdir()); return (Number(st.bsize) * Number(st.bavail)) / 1048576; };
const MIN_FREE_MB = Number(process.env.MIN_FREE_MB || 250);
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), outDir: bundleDir, publicDir: path.join(root, "public") });
const browser = await openBrowser("chrome", { browserExecutable, chromiumOptions: {} });
try {
  const composition = await selectComposition({ serveUrl, id: "ChaosLabDemo", puppeteerInstance: browser, browserExecutable });
  const total = composition.durationInFrames;
  log(`composition ${composition.width}x${composition.height} @${composition.fps}fps, ${total} frames; chunks of ${CHUNK}, concurrency ${concurrency}`);

  const chunks = [];
  for (let start = 0, i = 0; start < total; start += CHUNK, i++) {
    const end = Math.min(total - 1, start + CHUNK - 1);
    const file = path.join(work, `chunk-${String(i).padStart(3, "0")}.mp4`);
    if (freeMb() < MIN_FREE_MB) throw new Error(`only ${freeMb().toFixed(0)} MB free disk (< MIN_FREE_MB=${MIN_FREE_MB}) — aborting before chunk ${i}`);
    let lastPct = -1;
    await renderMedia({
      serveUrl, composition, puppeteerInstance: browser, browserExecutable, concurrency,
      codec: "h264", crf: CRF, pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 95,
      frameRange: [start, end], muted: true, outputLocation: file, overwrite: true,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== lastPct) { lastPct = pct; if (pct === 100) log(`chunk ${i} [${start}-${end}] done · ${freeMb().toFixed(0)} MB free`); }
      },
    });
    chunks.push(file);
  }

  log("mixing audio (ffmpeg) + concatenating chunks…");
  const wav = mixAudio();
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  mux(list, ["-f", "concat", "-safe", "0"], wav, out);

  if (posterOut) {
    log(`poster frame ${posterFrame} → ${posterOut}`);
    await renderStill({ serveUrl, composition, puppeteerInstance: browser, browserExecutable, frame: posterFrame, output: path.resolve(posterOut), imageFormat: "png", overwrite: true });
  }
} finally {
  await browser.close({ silent: true }).catch(() => {});
  cleanup();
}
log(`done → ${path.relative(root, out)}`);
