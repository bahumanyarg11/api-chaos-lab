// Probes narration WAVs, screen recordings and HyperFrames segments with ffprobe and
// writes src/generated/timing.json, which drives every scene length in the Remotion edit.
//
// Scene length = lead-in + narration + padding (+ optional per-scene hold).
// Demo scenes fit their recording into that window: playbackRate is clamped to
// [playbackRateMin, playbackRateMax] (config.json); if the clip is still too long the scene
// stretches up to +MAX_DEMO_STRETCH s, then the clip is trimmed; if too short, the last frame freezes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const script = JSON.parse(fs.readFileSync(path.join(root, "narration/script.json"), "utf8"));

const FPS = 30;
const PAD = config.scenePaddingSec ?? 0.6;
const RATE_MIN = config.playbackRateMin ?? 0.75;
const RATE_MAX = config.playbackRateMax ?? 1.6;
const MAX_DEMO_STRETCH = 3.0;

// lead-in before the voice starts, and extra hold after it, per scene (seconds)
const LEAD = { intro: 0.4, outro: 0.35 };
const HOLD = { problem: 0.6, solution: 1.2, "demo-matrix": 0.5, differentiator: 1.8, architecture: 1.6 };
const DEFAULT_LEAD = 0.3;
// HyperFrames segments and their fallback lengths if the mp4 is missing
const HF = { intro: { file: "hf/intro.mp4", fallbackSec: 10 }, outro: { file: "hf/outro.mp4", fallbackSec: 8 } };

const probeDuration = (rel) => {
  const abs = path.join(root, "public", rel);
  if (!fs.existsSync(abs)) return null;
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs]).toString().trim();
    const d = parseFloat(out);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
};
const probeSize = (rel) => {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0",
      path.join(root, "public", rel)]).toString().trim();
    const [w, h] = out.split(",").map(Number);
    return { width: w, height: h };
  } catch {
    return null;
  }
};
const f = (sec) => Math.round(sec * FPS);

let cursor = 0;
const scenes = [];
const voIntervals = [];
for (const entry of script) {
  const id = entry.scene;
  const voRel = `vo/${id}.wav`;
  const voSec = probeDuration(voRel);
  if (voSec == null) console.warn(`[probe] missing narration ${voRel} — scene will be silent`);
  const lead = LEAD[id] ?? DEFAULT_LEAD;
  const base = lead + (voSec ?? 4) + PAD + (HOLD[id] ?? 0);
  const scene = { id, from: cursor, frames: f(base), vo: voSec != null ? { file: voRel, offset: f(lead), frames: Math.ceil(voSec * FPS) } : null };

  if (HF[id]) {
    const hfSec = probeDuration(HF[id].file);
    const sec = Math.max(base, hfSec ?? HF[id].fallbackSec);
    scene.frames = f(sec);
    scene.hf = hfSec != null ? { file: HF[id].file, frames: f(hfSec) } : null;
    if (hfSec == null) console.warn(`[probe] ${HF[id].file} missing — Remotion fallback scene will be used for ${id}`);
  }

  if (entry.rec) {
    const recRel = `rec/${entry.rec}`;
    const recSec = probeDuration(recRel);
    if (recSec == null) {
      console.warn(`[probe] missing recording ${recRel}`);
      scene.rec = null;
    } else {
      let sceneSec = base;
      if (recSec / RATE_MAX > sceneSec) sceneSec = Math.min(recSec / RATE_MAX, base + MAX_DEMO_STRETCH);
      const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, recSec / sceneSec));
      const playSec = Math.min(sceneSec, recSec / rate);
      scene.frames = f(sceneSec);
      const playFrames = Math.min(scene.frames, Math.round(playSec * FPS));
      scene.rec = {
        file: recRel,
        durationSec: +recSec.toFixed(3),
        size: probeSize(recRel),
        playbackRate: +rate.toFixed(4),
        playFrames,
        freezeFrames: scene.frames - playFrames,
        trimmedSec: +Math.max(0, recSec - (playFrames / FPS) * rate).toFixed(2),
      };
    }
  }

  if (scene.vo) voIntervals.push([scene.from + scene.vo.offset, scene.from + scene.vo.offset + scene.vo.frames]);
  scenes.push(scene);
  cursor += scene.frames;
}

const timing = {
  generatedAt: new Date().toISOString(),
  fps: FPS,
  width: 1920,
  height: 1080,
  totalFrames: cursor,
  totalSec: +(cursor / FPS).toFixed(2),
  liveUrl: config.liveUrl || "chaoslab.app",
  musicVolumeDb: config.musicVolumeDb ?? -24,
  scenes,
  voIntervals,
};
const outDir = path.join(root, "src/generated");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "timing.json"), JSON.stringify(timing, null, 2) + "\n");

console.log(`[probe] ${scenes.length} scenes · ${timing.totalSec}s (${cursor} frames @ ${FPS}fps)`);
for (const s of scenes) {
  const extra = s.rec ? ` rec ${s.rec.durationSec}s @${s.rec.playbackRate}x${s.rec.freezeFrames ? ` +freeze ${(s.rec.freezeFrames / FPS).toFixed(1)}s` : ""}${s.rec.trimmedSec ? ` (trim ${s.rec.trimmedSec}s)` : ""}` : "";
  console.log(`  ${s.id.padEnd(16)} ${(s.frames / FPS).toFixed(2).padStart(6)}s${extra}`);
}
