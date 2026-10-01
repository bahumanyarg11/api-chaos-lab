#!/usr/bin/env bash
# API Chaos Lab — demo video pipeline. Idempotent: re-run any time.
#   1. assets  : placeholder recordings (only for missing files), music bed + SFX, narration (say)
#   2. HyperFrames : intro + outro → public/hf/*.mp4 (skipped when sources/config unchanged)
#   3. probe   : ffprobe durations → src/generated/timing.json
#   4. Remotion: out/chaoslab-demo.mp4 (1080p, h264 crf 18)
#   5. extras  : out/chaoslab-demo-720p.mp4 + out/poster.png
#
# Env knobs: SKIP_HF=1 (reuse existing hf mp4s), FORCE_HF=1, FORCE_TTS=1, POSTER_FRAME=<n>,
#            REMOTION_BROWSER=<path to chrome-headless-shell>, CONCURRENCY=<n>, CHUNK_FRAMES=<n>, CRF=<n>
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
log () { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

command -v ffmpeg >/dev/null || { echo "ffmpeg is required"; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe is required"; exit 1; }
[[ -d node_modules/remotion && -d node_modules/hyperframes ]] || { log "Installing npm dependencies"; npm ci --no-audit --no-fund || npm install --no-audit --no-fund; }
mkdir -p out public/hf public/rec public/vo public/music public/sfx src/generated

log "1/5 Assets"
bash scripts/make-placeholders.sh
bash scripts/make-audio.sh
node scripts/tts.mjs ${FORCE_TTS:+--force}

log "2/5 HyperFrames segments"
VARS="$ROOT/out/.hf-variables.json"
node -e 'const c=require("./config.json");require("fs").writeFileSync(process.argv[1],JSON.stringify({liveUrl:String(c.liveUrl||"chaoslab.app")}))' "$VARS"
hash_of () { cat "$@" | shasum | cut -d" " -f1; }
render_hf () {  # name, uses-vars(0/1), extra args...
  local name="$1" usesvars="$2"; shift 2
  local out="public/hf/$name.mp4" stamp="public/hf/.$name.hash"
  local h; if [[ "$usesvars" == 1 ]]; then h="$(hash_of hyperframes/$name/index.html "$VARS")"; else h="$(hash_of hyperframes/$name/index.html)"; fi
  if [[ -z "${FORCE_HF:-}" && -s "$out" && -f "$stamp" && "$(cat "$stamp")" == "$h" ]]; then
    echo "[hf] $name up to date"; return 0
  fi
  if [[ -n "${SKIP_HF:-}" ]]; then echo "[hf] SKIP_HF set — keeping existing $out"; return 0; fi
  if node scripts/hf-render.mjs "hyperframes/$name" "$out" "$@"; then
    echo "$h" > "$stamp"
  else
    echo "[hf] WARNING: HyperFrames render of $name failed."
    if [[ -s "$out" ]]; then echo "[hf] keeping previous $out"; else echo "[hf] Remotion fallback scene will be used"; fi
  fi
}
render_hf intro 0
render_hf outro 1 --variables-file "$VARS"

log "3/5 Probe durations"
node scripts/probe.mjs

# Browser for Remotion: explicit env > HyperFrames' cached chrome-headless-shell > Remotion's own download.
if [[ -z "${REMOTION_BROWSER:-}" ]]; then
  REMOTION_BROWSER="$(find "$HOME/.cache/hyperframes/chrome" -name chrome-headless-shell -type f -perm -u+x 2>/dev/null | head -1 || true)"
fi
export REMOTION_BROWSER
POSTER_FRAME="${POSTER_FRAME:-285}"   # intro logo reveal

log "4/5 Remotion render (1080p, chunked) + poster"
# Equivalent single-shot command (needs ~1 GB free temp disk on machines without parallel encoding):
#   npx remotion render src/index.ts ChaosLabDemo out/chaoslab-demo.mp4 --codec=h264 --crf=18
node scripts/remotion-render.mjs out/chaoslab-demo.mp4 --poster out/poster.png --poster-frame "$POSTER_FRAME"

log "5/5 720p copy"
ffmpeg -y -v error -i out/chaoslab-demo.mp4 -vf "scale=1280:720:flags=lanczos" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out/chaoslab-demo-720p.mp4

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/chaoslab-demo.mp4)"
log "Done — $(printf '%.1f' "$DUR")s"
ls -lh out/chaoslab-demo.mp4 out/chaoslab-demo-720p.mp4 out/poster.png
