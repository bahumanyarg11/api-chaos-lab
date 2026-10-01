#!/usr/bin/env bash
# Synthesizes the ambient music bed and small SFX with ffmpeg (no external assets).
# Idempotent: skips files that already exist (pass --force to rebuild).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/music public/sfx
FORCE="${1:-}"
need () { [[ "$FORCE" == "--force" || ! -s "$1" ]]; }

# Ambient pad: two slowly cross-fading minor-ish chords (Am9 <-> Fmaj9) with detune,
# soft 60 bpm sub pulse, pink-noise air, lowpass + echo. 200 s so it covers any edit length.
if need public/music/bed.wav; then
  A="sin(2*PI*110*t)+0.5*sin(2*PI*110.35*t)+0.55*sin(2*PI*164.81*t)+0.45*sin(2*PI*196*t)+0.35*sin(2*PI*246.94*t)+0.25*sin(2*PI*329.63*t)"
  B="sin(2*PI*87.31*t)+0.5*sin(2*PI*87.6*t)+0.55*sin(2*PI*130.81*t)+0.45*sin(2*PI*164.81*t)+0.35*sin(2*PI*196*t)+0.25*sin(2*PI*261.63*t)"
  W="(0.5+0.5*cos(2*PI*t/16))"
  PULSE="0.35*sin(2*PI*55*t)*exp(-6*mod(t,1))"
  ffmpeg -y -v error \
    -f lavfi -i "aevalsrc='0.11*(${W}*(${A})+(1-${W})*(${B}))*(0.85+0.15*sin(2*PI*t/5))+0.12*${PULSE}':s=44100:d=200" \
    -f lavfi -i "anoisesrc=color=pink:amplitude=0.02:sample_rate=44100:duration=200" \
    -filter_complex "[0:a]lowpass=f=1400,aecho=0.8:0.6:180|360:0.25|0.15[pad];[1:a]lowpass=f=2500,highpass=f=400[air];[pad][air]amix=inputs=2:weights='1 0.6':normalize=0,afade=t=in:d=3,afade=t=out:st=194:d=6,alimiter=limit=0.7,loudnorm=I=-20:TP=-3:LRA=7" \
    -ar 44100 -ac 1 public/music/bed.wav
  echo "[audio] bed.wav"
fi

# Whoosh: band-limited noise with a rising/falling envelope.
if need public/sfx/whoosh.wav; then
  ffmpeg -y -v error -f lavfi -i "anoisesrc=color=pink:amplitude=0.9:sample_rate=44100:duration=0.7" \
    -af "volume='pow(sin(PI*t/0.7),2)':eval=frame,highpass=f=300,lowpass=f=3500,afade=t=out:st=0.5:d=0.2,volume=0.6" \
    -ac 1 public/sfx/whoosh.wav
  echo "[audio] whoosh.wav"
fi

# Glitch: stepped square-wave chirps, bit-crushed and gated.
if need public/sfx/glitch.wav; then
  ffmpeg -y -v error -f lavfi \
    -i "aevalsrc='0.35*sgn(sin(2*PI*(220+660*mod(floor(t*37),5))*t))*lt(mod(t,0.045),0.03)':s=44100:d=0.32" \
    -af "acrusher=bits=6:mix=0.8,lowpass=f=6000,afade=t=out:st=0.24:d=0.08" -ac 1 public/sfx/glitch.wav
  echo "[audio] glitch.wav"
fi

# Soft impact for logo / score reveals.
if need public/sfx/impact.wav; then
  ffmpeg -y -v error -f lavfi \
    -i "aevalsrc='0.8*sin(2*PI*(48+90*exp(-18*t))*t)*exp(-4.5*t)':s=44100:d=1.4" \
    -af "lowpass=f=900,afade=t=out:st=1.1:d=0.3" -ac 1 public/sfx/impact.wav
  echo "[audio] impact.wav"
fi

# UI tick for cells lighting up.
if need public/sfx/tick.wav; then
  ffmpeg -y -v error -f lavfi -i "aevalsrc='0.4*sin(2*PI*1800*t)*exp(-60*t)':s=44100:d=0.12" -ac 1 public/sfx/tick.wav
  echo "[audio] tick.wav"
fi
