# API Chaos Lab — demo video

Remotion (TypeScript) edit with HyperFrames-rendered intro/outro, macOS `say` narration,
and an ffmpeg-synthesized music bed. Everything is reproducible from one script:

```bash
cd video
./render.sh
```

Outputs:

| file | what |
| --- | --- |
| `out/chaoslab-demo.mp4` | 1920×1080, 30 fps, h264 CRF 18 + AAC |
| `out/chaoslab-demo-720p.mp4` | 1280×720 lighter copy (ffmpeg downscale, CRF 23) |
| `out/poster.png` | poster still (intro logo frame; override with `POSTER_FRAME=<n>`) |

Requirements: Node 22+, ffmpeg/ffprobe, macOS `say` (only to regenerate narration), python3 + Pillow
(only to generate placeholder recordings), internet on first render (Google Fonts, GSAP CDN, Chrome
download if none is cached).

## Re-render after replacing the screen recordings

Drop the real recordings over the placeholders (same names, any length, ~1600×1000 / 16:10):

```
public/rec/01-landing.mp4     02-upload.mp4     03-matrix.mp4    04-live.mp4
public/rec/05-playground.mp4  06-report.mp4     07-integrate.mp4
```

Then run `./render.sh`. The placeholder generator never overwrites an existing file.
`scripts/probe.mjs` reads every clip's real duration and fits it to its narration window:

* optional per-scene `recStart` / `recEnd` (seconds) in `narration/script.json` pick a sub-range of
  the source (e.g. the landing page uses 1.5–13.5 s of a 58 s capture); `recAnchor: "end"` keeps the
  end of the clip when trimming is needed (the playground keeps its final verdict);
* playback speed is adjusted within **0.75×–2.0×** (`playbackRateMin/Max` in `config.json`);
* if a clip is still too long, the scene stretches by up to `maxDemoStretchSec` (4 s), then the clip
  is trimmed;
* if it is too short, the last frame freezes.

The fit for every scene is printed by the probe step and saved in `src/generated/timing.json`.
Recordings are shown with `object-fit: cover` anchored to the top, so a 16:10 capture fills the
browser frame exactly; other aspect ratios are cropped at the bottom/sides.

To get placeholders back, delete the file(s) and re-run.

## Change the live URL

Edit `config.json` → `"liveUrl"` (currently `api-chaos-lab.vercel.app`) and re-run `./render.sh`. It is used by
* the HyperFrames outro (`{{LIVE_URL}}` in `hyperframes/outro/index.html`, passed via
  `--variables-file`; render.sh re-renders the outro automatically when the value changes), and
* the browser URL bars + integration callouts in the Remotion demo scenes.

## Edit narration / timing

* Text: `narration/script.json` — `text` is the script, optional `speak` is a pronunciation-friendly
  version fed to `say`. Only changed lines are re-synthesized (`FORCE_TTS=1` to redo all).
* Voice/rate: `config.json` (`voice`, `voiceRate`), or env `VO_VOICE` / `VO_RATE`.
* Scene length = lead-in + narration + `scenePaddingSec` (+ a per-scene hold, see `HOLD` in
  `scripts/probe.mjs`). Visual beats inside scenes are expressed as fractions of the narration, so
  they stay in sync if the wording changes.
* Music level: `musicVolumeDb` (default −24 dB under the voice; it opens up ~5 dB between lines).
* Soundtrack cues (narration, music ducking, SFX) live in `src/audio-plan.mjs`; the Remotion
  composition and the ffmpeg mixer (`scripts/mix-audio.mjs`) both read it. If you only changed audio
  and every scene kept its length, remix in seconds instead of re-rendering video:
  `node scripts/probe.mjs && AUDIO_ONLY=1 node scripts/remotion-render.mjs out/chaoslab-demo.mp4`
  (it refuses if the frame count changed), then re-run the 720p step from `render.sh`.

## Layout

```
config.json                 liveUrl, voice, padding, playback-rate limits
narration/script.json       narration per scene (scene ids drive the edit order)
hyperframes/intro|outro/    HyperFrames HTML + GSAP compositions (10 s / 8 s)
scripts/
  make-placeholders.sh      12 s placeholder recordings (missing files only)
  make-audio.sh             ambient bed + whoosh/glitch/impact/tick SFX (ffmpeg aevalsrc)
  tts.mjs                   say → public/vo/<scene>.wav (loudness-normalized, cached)
  hf-render.mjs             runs `hyperframes render` (see NOTES.md re: low-disk shim)
  probe.mjs                 ffprobe → src/generated/timing.json
  remotion-render.mjs       chunked Remotion render + ffmpeg concat/mux + poster (see NOTES.md)
  mix-audio.mjs             ffmpeg mix of the soundtrack plan → WAV
src/
  ChaosLabDemo.tsx          main composition (scenes, glitch cuts, soundtrack)
  audio-plan.mjs            narration/SFX/music cue sheet + shared narration beats
  scenes/                   Problem, Solution, DemoScene, Differentiator, Architecture, Bookends
  components/ui.tsx         backdrop, glitch text, panels, chips, logo mark
public/                     hf/, rec/, vo/, music/, sfx/
```

Preview / tweak interactively: `npm run studio` (Remotion Studio), or for the HyperFrames parts
`npx hyperframes preview hyperframes/intro`.

Useful env knobs for `render.sh`: `SKIP_HF=1` (reuse existing HyperFrames mp4s), `FORCE_HF=1`,
`FORCE_TTS=1`, `CONCURRENCY=4`, `CHUNK_FRAMES=300`, `CRF=18`, `POSTER_FRAME=285`,
`REMOTION_BROWSER=/path/to/chrome-headless-shell`. A full render takes ~8–10 min on an M4.
