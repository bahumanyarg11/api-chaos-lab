import raw from "./generated/timing.json";

export type SceneTiming = {
  id: string;
  from: number;
  frames: number;
  vo: { file: string; offset: number; frames: number } | null;
  hf?: { file: string; frames: number } | null;
  rec?: {
    file: string;
    sourceSec: number;
    startSec: number;
    startFrame: number;
    durationSec: number;
    playbackRate: number;
    playFrames: number;
    freezeFrames: number;
  } | null;
};

export type Timing = {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  totalSec: number;
  liveUrl: string;
  musicVolumeDb: number;
  scenes: SceneTiming[];
  voIntervals: [number, number][];
};

export const timing = raw as unknown as Timing;
export const sceneById = (id: string) => timing.scenes.find((s) => s.id === id);
