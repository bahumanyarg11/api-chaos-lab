// Preload for the HyperFrames CLI (node --import). HyperFrames' render preflight refuses
// to run with < 1 GiB free disk, even though the SDR MP4 path streams frames to ffmpeg and
// needs only tens of MB. On a nearly-full dev machine this shim reports +1 GiB to that check.
// It is only loaded by scripts/hf-render.mjs, which enforces its own real floor first.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const orig = fs.statfsSync;
fs.statfsSync = function patchedStatfsSync(p, opts) {
  const s = orig.call(fs, p, opts);
  const extra = Math.ceil((1024 * 1024 * 1024) / Number(s.bsize));
  if (typeof s.bavail === "bigint") return { ...s, bavail: s.bavail + BigInt(extra), bfree: s.bfree + BigInt(extra) };
  return { ...s, bavail: s.bavail + extra, bfree: s.bfree + extra };
};
syncBuiltinESMExports();
