#!/usr/bin/env bash
# Creates 12 s placeholder screen recordings for any missing public/rec/*.mp4.
# Never overwrites a real recording.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/rec
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
make_one () {
  local file="$1" idx="$2" title="$3" sub="$4"
  local out="public/rec/$file"
  if [[ -s "$out" ]]; then echo "[rec] $file exists — keeping"; return; fi
  python3 scripts/placeholder_frame.py "$TMP/$idx.png" "$idx" "$title" "$sub"
  # moving scan bar + pulsing progress so motion is visible in the edit
  ffmpeg -y -v error -loop 1 -framerate 30 -t 12 -i "$TMP/$idx.png" \
    -f lavfi -i "color=c=0xFF3D5A:s=160x6:r=30:d=12" \
    -filter_complex "[0:v][1:v]overlay=x='340+mod(t*260\,1120)':y=930[v];[v]drawbox=x=340:y=950:w='1120*t/12':h=4:color=0xB14DFF@0.9:t=fill,format=yuv420p[o]" \
    -map "[o]" -c:v libx264 -preset veryfast -crf 26 -r 30 -t 12 -movflags +faststart "$out"
  echo "[rec] $file placeholder created"
}
make_one 01-landing.mp4    01 "Landing"           "Create a project"
make_one 02-upload.mp4     02 "Upload spec"       "openapi.yaml → parsed endpoints"
make_one 03-matrix.mp4     03 "AI chaos matrix"   "endpoints × faults · toggle cells"
make_one 04-live.mp4       04 "Live traffic"      "requests stream in · faults injected"
make_one 05-playground.mp4 05 "Playground"        "naive vs resilient client"
make_one 06-report.mp4     06 "Resilience report" "score · findings · AI fixes"
make_one 07-integrate.mp4  07 "Integrate"         "base URL swap · CI gate"
