// Single source of truth for the soundtrack: used by the Remotion composition (preview/Studio and
// plain `remotion render`) AND by scripts/mix-audio.mjs, which mixes the same plan with ffmpeg for the
// chunked production render. Plain JS (no TS) so Node can import it directly.

// Narration beats (fractions of a scene's voice-over) shared by visuals and SFX.
export const DIFF_BEATS = { lanes: 0.17, storm: 0.42, retryAfter: 0.56, post: 0.7, end: 0.78, alert: 0.66, dialF: 0.8, dialA: 0.89 };
export const ARCH_BEATS = { client: 0.04, edge: 0.13, api: 0.23, lambdas: 0.3, data: 0.48, bedrock: 0.57, cw: 0.66, term: 0.73, fail: 0.93 };
export const SOLUTION_TICKS = [0.68, 0.73, 0.78, 0.83, 0.88, 0.93];
// HyperFrames intro: seconds where its cards glitch / collapse / the logo lands (see hyperframes/intro).
export const INTRO_GLITCH_SEC = [3.45, 4.05, 4.85, 5.45, 6.0];
export const INTRO_WHOOSH_SEC = 6.45;
export const INTRO_IMPACT_SEC = 7.15;

const VOICE_LUFS = -16; // scripts/tts.mjs loudnorm target
const BED_LUFS = -20; // scripts/make-audio.sh loudnorm target

/**
 * @param {{fps:number,totalFrames:number,musicVolumeDb:number,scenes:any[],voIntervals:[number,number][]}} timing
 */
export function buildAudioPlan(timing) {
  const fps = timing.fps;
  const scene = (id) => timing.scenes.find((s) => s.id === id);
  const beat = (id, frac) => {
    const s = scene(id);
    if (!s) return -1;
    const vo = s.vo ?? { offset: 0, frames: s.frames };
    return Math.round(s.from + vo.offset + frac * vo.frames);
  };
  const cuts = timing.scenes.slice(1).map((s) => s.from);
  const sfx = [];
  const add = (from, file, volume, frames = 45) => {
    if (from >= 0 && from < timing.totalFrames) sfx.push({ from: Math.round(from), file, volume, frames });
  };

  cuts.forEach((c) => add(c - 9, "sfx/whoosh.wav", 0.28, 24));
  cuts.forEach((c) => add(c - 2, "sfx/glitch.wav", 0.1, 12));
  const intro = scene("intro");
  if (intro?.hf) {
    INTRO_GLITCH_SEC.forEach((sec) => add(intro.from + sec * fps, "sfx/glitch.wav", 0.16, 12));
    add(intro.from + INTRO_WHOOSH_SEC * fps, "sfx/whoosh.wav", 0.3, 24);
    add(intro.from + INTRO_IMPACT_SEC * fps, "sfx/impact.wav", 0.55);
  } else if (intro) {
    add(intro.from + intro.frames * 0.68, "sfx/impact.wav", 0.55);
  }
  const outro = scene("outro");
  if (outro) add(outro.from + 0.25 * fps, "sfx/impact.wav", 0.4);
  if (scene("solution")) SOLUTION_TICKS.forEach((f) => add(beat("solution", f), "sfx/tick.wav", 0.12, 6));
  if (scene("problem")) add(beat("problem", 0.74) + 40, "sfx/glitch.wav", 0.14, 12);
  if (scene("differentiator")) {
    add(beat("differentiator", DIFF_BEATS.alert), "sfx/glitch.wav", 0.18, 12);
    add(beat("differentiator", DIFF_BEATS.dialF), "sfx/impact.wav", 0.35);
    add(beat("differentiator", DIFF_BEATS.dialA), "sfx/impact.wav", 0.35);
  }
  if (scene("architecture")) add(beat("architecture", ARCH_BEATS.fail), "sfx/glitch.wav", 0.16, 12);

  const voice = timing.scenes
    .filter((s) => s.vo)
    .map((s) => ({ from: s.from + s.vo.offset, file: s.vo.file, frames: s.vo.frames + 6, volume: 1 }));

  const duckedGain = Math.pow(10, (VOICE_LUFS + timing.musicVolumeDb - BED_LUFS) / 20); // under voice
  const music = {
    file: "music/bed.wav",
    duckedGain,
    openGain: duckedGain * 1.8, // between lines
    guardFrames: 6,
    rampFrames: 15,
    fadeInFrames: 45,
    fadeOutStart: timing.totalFrames - 75,
    fadeOutEnd: timing.totalFrames - 5,
  };
  return { fps, totalFrames: timing.totalFrames, voIntervals: timing.voIntervals, music, voice, sfx };
}

/** Music gain at composition frame f (same curve the ffmpeg mixer reproduces). */
export function musicGainAt(plan, f) {
  const m = plan.music;
  const d = plan.voIntervals.reduce((acc, [a, b]) => Math.min(acc, f < a ? a - f : f > b ? f - b : 0), 1e9);
  const open = Math.min(1, Math.max(0, (d - m.guardFrames) / m.rampFrames));
  const g = m.duckedGain + (m.openGain - m.duckedGain) * open;
  const fadeIn = Math.min(1, Math.max(0, f / m.fadeInFrames));
  const fadeOut = Math.min(1, Math.max(0, (m.fadeOutEnd - f) / (m.fadeOutEnd - m.fadeOutStart)));
  return g * fadeIn * fadeOut;
}
