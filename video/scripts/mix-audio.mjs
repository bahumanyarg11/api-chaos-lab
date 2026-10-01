// Mixes the soundtrack (narration + ducked music bed + SFX) with ffmpeg from the same plan the
// Remotion composition uses (src/audio-plan.mjs). Seconds instead of minutes, and ~30 MB of disk.
// usage: node scripts/mix-audio.mjs <out.wav>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAudioPlan } from "../src/audio-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || path.join(root, "out/.mix.wav"));
const timing = JSON.parse(fs.readFileSync(path.join(root, "src/generated/timing.json"), "utf8"));
const plan = buildAudioPlan(timing);
const fps = plan.fps;
const dur = (plan.totalFrames / fps).toFixed(4);
const pub = (rel) => path.join(root, "public", rel);

// music gain envelope as an ffmpeg expression of t (seconds) — mirrors musicGainAt()
const m = plan.music;
const F = `(t*${fps})`;
const dist = plan.voIntervals.map(([a, b]) => `max(max(${a}-${F},${F}-${b}),0)`).reduce((acc, e) => (acc ? `min(${acc},${e})` : e), "") || "1e9";
const open = `clip((${dist}-${m.guardFrames})/${m.rampFrames},0,1)`;
const gain = `(${m.duckedGain.toFixed(5)}+${(m.openGain - m.duckedGain).toFixed(5)}*${open})`;
const fadeIn = `clip(${F}/${m.fadeInFrames},0,1)`;
const fadeOut = `clip((${m.fadeOutEnd}-${F})/${m.fadeOutEnd - m.fadeOutStart},0,1)`;
const musicExpr = `${gain}*${fadeIn}*${fadeOut}`;

const inputs = [pub(m.file)];
const filters = [`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${dur},volume='${musicExpr}':eval=frame[m]`];
const labels = ["[m]"];
for (const ev of [...plan.voice, ...plan.sfx]) {
  if (!fs.existsSync(pub(ev.file))) { console.warn(`[mix] missing ${ev.file} — skipped`); continue; }
  const idx = inputs.push(pub(ev.file)) - 1;
  const ms = Math.round((ev.from / fps) * 1000);
  const maxSec = (ev.frames / fps).toFixed(3);
  filters.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${maxSec},volume=${ev.volume},adelay=${ms}:all=1[a${idx}]`);
  labels.push(`[a${idx}]`);
}
filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,atrim=0:${dur},alimiter=limit=0.95:level=0[out]`);

fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync("ffmpeg", ["-y", "-v", "error", ...inputs.flatMap((i) => ["-i", i]), "-filter_complex", filters.join(";"), "-map", "[out]",
  "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out], { stdio: "inherit" });
console.log(`[mix] ${plan.voice.length} narration lines + ${plan.sfx.length} SFX + music → ${path.relative(root, out)} (${dur}s)`);
