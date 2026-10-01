// Low-disk-friendly Remotion render.
//
// When Remotion can't use "parallel encoding" (it needs > ~4 GB of *free* RAM for 1080p, which macOS
// rarely reports), it writes every frame as a JPEG to $TMPDIR before stitching — ~0.8 GB for this
// 150 s edit. To keep peak disk usage small this script bundles once, renders the video in muted
// chunks (each chunk's frames are deleted after it is encoded), renders the audio mix once as WAV,
// then concatenates the chunks (stream copy, no re-encode) and muxes AAC audio with ffmpeg.
//
// usage: node scripts/remotion-render.mjs <out.mp4> [--poster out/poster.png --poster-frame 285]
// env:   REMOTION_BROWSER (chrome-headless-shell path), CHUNK_FRAMES (default 300), CONCURRENCY, CRF (18)
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
const CHUNK = Number(process.env.CHUNK_FRAMES || 300);
const CRF = Number(process.env.CRF || 18);
const concurrency = Number(process.env.CONCURRENCY || Math.max(2, Math.floor(os.cpus().length * 0.4)));
const browserExecutable = process.env.REMOTION_BROWSER || null;

const work = path.join(root, "out/.chunks");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const t0 = Date.now();
const log = (...m) => console.log(`[remotion +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);

log("bundling…");
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaoslab-bundle-"));
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), outDir: bundleDir, publicDir: path.join(root, "public") });
const browser = await openBrowser("chrome", { browserExecutable, chromiumOptions: {} });
try {
  const composition = await selectComposition({ serveUrl, id: "ChaosLabDemo", puppeteerInstance: browser, browserExecutable });
  const total = composition.durationInFrames;
  log(`composition ${composition.width}x${composition.height} @${composition.fps}fps, ${total} frames; chunks of ${CHUNK}, concurrency ${concurrency}`);

  // AUDIO_ONLY=1: re-mix narration/music/SFX and remux onto the existing video stream of <out>
  // (only valid when scene lengths are unchanged — the script checks the frame count).
  if (process.env.AUDIO_ONLY) {
    const nb = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", out]).toString().trim();
    if (Number(nb) !== total) throw new Error(`AUDIO_ONLY: ${out} has ${nb} frames but the edit now has ${total} — run a full render`);
    const wav = path.join(work, "audio.wav");
    log("AUDIO_ONLY: rendering audio mix…");
    await renderMedia({ serveUrl, composition, puppeteerInstance: browser, browserExecutable, concurrency, codec: "wav", outputLocation: wav, overwrite: true });
    const tmpOut = path.join(work, "remux.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", out, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", tmpOut], { stdio: "inherit" });
    fs.renameSync(tmpOut, out);
    log(`remuxed audio → ${path.relative(root, out)}`);
  } else {
  const chunks = [];
  for (let start = 0, i = 0; start < total; start += CHUNK, i++) {
    const end = Math.min(total - 1, start + CHUNK - 1);
    const file = path.join(work, `chunk-${String(i).padStart(3, "0")}.mp4`);
    let lastPct = -1;
    await renderMedia({
      serveUrl, composition, puppeteerInstance: browser, browserExecutable, concurrency,
      codec: "h264", crf: CRF, pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 95,
      frameRange: [start, end], muted: true, outputLocation: file, overwrite: true,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== lastPct) { lastPct = pct; if (pct % 50 === 0) log(`chunk ${i} [${start}-${end}] ${pct}%`); }
      },
    });
    chunks.push(file);
  }

  log("rendering audio mix…");
  const wav = path.join(work, "audio.wav");
  await renderMedia({ serveUrl, composition, puppeteerInstance: browser, browserExecutable, concurrency, codec: "wav", outputLocation: wav, overwrite: true });

  log("concatenating + muxing…");
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", wav,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" });
  }

  if (posterOut) {
    log(`poster frame ${posterFrame} → ${posterOut}`);
    await renderStill({ serveUrl, composition, puppeteerInstance: browser, browserExecutable, frame: posterFrame, output: path.resolve(posterOut), imageFormat: "png", overwrite: true });
  }
} finally {
  await browser.close({ silent: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
log(`done → ${path.relative(root, out)}`);
