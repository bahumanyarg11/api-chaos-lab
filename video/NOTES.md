# Build notes

## HyperFrames — works (with one local workaround)

`hyperframes@0.8.99` renders both segments on this Mac (Node 25, ffmpeg 8.0.1, Apple M4):

```bash
node scripts/hf-render.mjs hyperframes/intro public/hf/intro.mp4
node scripts/hf-render.mjs hyperframes/outro public/hf/outro.mp4 --variables-file out/.hf-variables.json
# which run:
#   node node_modules/hyperframes/dist/cli.js render hyperframes/<name> -o public/hf/<name>.mp4 \
#        --fps 30 --quality delivery --workers 4 --quiet [--variables-file …]
# (equivalent to: npx hyperframes render hyperframes/<name> -o public/hf/<name>.mp4 …)
```

Each segment renders in ~13 s. First run downloads chrome-headless-shell (~190 MB) into
`~/.cache/hyperframes/chrome`; render.sh then reuses that same binary for Remotion, so Remotion does
not download a second browser.

### The one problem: HyperFrames' 1 GiB free-disk preflight

The machine had only ~0.6–0.8 GB free. `hyperframes render` hard-fails before rendering:

```
✗  Low disk space
   0.6 GB free at /var/folders/rq/wtfj4n4d4kg1t2dgd58237g40000gn/T
   Renders produce large temp files. Free disk space before rendering.
✗  Low disk space
   0.6 GB free at /Users/bahumanyarg/AWS/chaoslab/video/public/hf
```

The threshold is hard-coded (`checkDisk`, `freeMb < 1024`, no env override). The SDR MP4 path streams
frames to ffmpeg (`image2pipe`), so a 10 s render actually needs only ~50 MB (measured: free space
dropped ~45 MB during the intro render). `scripts/hf-render.mjs` therefore:

* runs the CLI unmodified when ≥ 1 GiB is free;
* otherwise preloads `scripts/hf-lowdisk-shim.mjs` (`node --import …`), which adds 1 GiB to
  `fs.statfsSync().bavail` for that process only, **and** enforces its own real floor
  (`HF_MIN_FREE_MB`, default 250 MB) — below that it refuses to render.

No files in `node_modules` are patched. On a machine with normal free space the shim is never loaded.

### Lint

`npx hyperframes lint hyperframes/intro` → 0 errors, 6 warnings (`nested_structure_needs_subcomposition`:
Studio-timeline hint suggesting nested layers be moved into sub-composition files; it does not
affect rendering).

## Remotion — renders in chunks (low-disk workaround)

Remotion only streams frames straight into ffmpeg ("parallel encoding") when it sees > ~4 GB of
*free* RAM at 1080p (`freemem() - 2 GB*Mpx > 2 GB`); macOS usually reports ~3 GB free, so Remotion
falls back to writing every frame as a JPEG into `$TMPDIR` before stitching. For this 148 s edit that
is ~0.8 GB and the first single-shot render (`npx remotion render … ChaosLabDemo out/chaoslab-demo.mp4`)
was about to fill the disk, so it was stopped. `scripts/remotion-render.mjs` instead:

1. bundles once (`@remotion/bundler`, temp dir, deleted afterwards),
2. renders muted 300-frame chunks with `renderMedia({ frameRange })` (each chunk's frames are deleted
   after encoding), h264 CRF 18,
3. renders the full audio mix once as WAV (`codec: "wav"`),
4. concatenates the chunks with ffmpeg's concat demuxer (`-c:v copy`, no re-encode) and muxes AAC,
5. renders the poster still with the same browser.

Peak extra disk use ≈ 400 MB. Knobs: `CHUNK_FRAMES`, `CONCURRENCY`, `CRF`. On a machine with plenty
of disk the plain `npx remotion render src/index.ts ChaosLabDemo out/chaoslab-demo.mp4 --codec=h264 --crf=18`
produces the same result.

## Other notes

* Homebrew ffmpeg 8 here has **no `drawtext`** filter, so placeholder recordings are drawn with
  Python/Pillow (`scripts/placeholder_frame.py`) and animated with `overlay`/`drawbox`.
* Remotion 4.0.531 renders with `--browser-executable` pointed at the HyperFrames
  chrome-headless-shell (152.x). Remove it / set `REMOTION_BROWSER` to use another browser.
* Narration is macOS "Samantha" at 185 wpm, loudness-normalized to −16 LUFS. The music bed is
  −20 LUFS and mixed at −24 dB relative to the voice (gain 0.1), opening to ~0.18 between lines.
* Disk is tight on this machine (~0.6 GB free while building): a full render needs ~400–500 MB of
  headroom. Free space before re-rendering if possible.
* A full render takes ~11 min on the M4 (≈ 7 min video chunks, ≈ 3 min audio mix pass).
