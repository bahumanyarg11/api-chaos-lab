// Generates per-scene voice-over WAVs from narration/script.json using macOS `say`.
// Idempotent: a scene is re-synthesized only when its text/voice/rate changed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const script = JSON.parse(fs.readFileSync(path.join(root, "narration/script.json"), "utf8"));
const voDir = path.join(root, "public/vo");
const manifestPath = path.join(voDir, ".manifest.json");
fs.mkdirSync(voDir, { recursive: true });

const voice = process.env.VO_VOICE || config.voice || "Samantha";
const rate = String(process.env.VO_RATE || config.voiceRate || 185);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
const force = process.argv.includes("--force");

const hasSay = (() => {
  try { execFileSync("which", ["say"], { stdio: "ignore" }); return true; } catch { return false; }
})();

for (const entry of script) {
  const spoken = entry.speak || entry.text;
  const hash = createHash("sha1").update(`${voice}|${rate}|${spoken}`).digest("hex");
  const out = path.join(voDir, `${entry.scene}.wav`);
  if (!force && fs.existsSync(out) && manifest[entry.scene] === hash) {
    console.log(`[tts] ${entry.scene}: up to date`);
    continue;
  }
  if (!hasSay) {
    if (fs.existsSync(out)) { console.warn(`[tts] no 'say' available, keeping existing ${out}`); continue; }
    throw new Error("macOS `say` not found and no existing VO file; cannot synthesize narration");
  }
  const tmp = path.join(os.tmpdir(), `chaoslab-vo-${entry.scene}-${process.pid}.aiff`);
  execFileSync("say", ["-v", voice, "-r", rate, "-o", tmp, spoken]);
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", tmp,
    "-af", "highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.05",
    "-ar", "48000", "-ac", "1", out,
  ]);
  fs.rmSync(tmp, { force: true });
  manifest[entry.scene] = hash;
  console.log(`[tts] ${entry.scene}: synthesized (${voice} @ ${rate} wpm)`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
