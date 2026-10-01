import React from "react";
import { AbsoluteFill, Html5Audio, random, Sequence, staticFile, useCurrentFrame } from "remotion";
import config from "../config.json";
import { Backdrop, Vignette } from "./components/ui";
import { C, inter } from "./theme";
import { timing, type SceneTiming } from "./timing";
import { Architecture } from "./scenes/Architecture";
import { buildAudioPlan, musicGainAt } from "./audio-plan.mjs";
import { HFSegment, IntroFallback, OutroFallback } from "./scenes/Bookends";
import { DemoScene, type DemoSpec } from "./scenes/DemoScene";
import { Differentiator } from "./scenes/Differentiator";
import { Problem } from "./scenes/Problem";
import { Solution } from "./scenes/Solution";

const LIVE_URL = String((config as { liveUrl?: string }).liveUrl || timing.liveUrl || "chaoslab.app").replace(/^https?:\/\//, "").replace(/\/$/, "");

const DEMOS: Record<string, DemoSpec> = {
  "demo-landing": {
    step: 1,
    label: "Start a project",
    path: "",
    callouts: [
      { at: 0.05, title: "The real, working app", body: LIVE_URL, code: true },
      { at: 0.5, title: "Spec to score in minutes", body: "start chaos testing from the landing page" },
    ],
  },
  "demo-upload": {
    step: 2,
    label: "Upload a spec",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.02, title: "Paste or upload OpenAPI", body: "YAML or JSON · every endpoint parsed" },
      { at: 0.5, title: "Bedrock reads your API semantics", body: "payments · auth · idempotency", accent: C.orange },
    ],
  },
  "demo-matrix": {
    step: 3,
    label: "AI chaos matrix",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.03, title: "Endpoints × faults", body: "generated with Amazon Bedrock" },
      { at: 0.35, title: "Realistic failure modes", body: "latency · timeouts · 429 + Retry-After · schema drift" },
      { at: 0.82, title: "Toggle any cell", body: "you stay in control of the chaos", accent: C.mint },
    ],
  },
  "demo-live": {
    step: 4,
    label: "Live traffic",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.02, title: "Swap one base URL", body: "API_BASE_URL → chaos endpoint", code: true },
      { at: 0.45, title: "Watch faults land", body: "every request, every injected fault, in real time" },
    ],
  },
  "demo-playground": {
    step: 5,
    label: "Playground",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.05, title: "Naive vs resilient", body: "two clients, side by side", accent: C.red },
      { at: 0.42, title: "Same chaos, same seed", body: "a fair fight — only the client differs", accent: C.orange },
      { at: 0.78, title: "The verdict", body: "naive F · resilient A", accent: C.mint },
    ],
  },
  "demo-report": {
    step: 6,
    label: "Resilience report",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.05, title: "A score you can track", body: "every run graded A–F", accent: C.mint },
      { at: 0.45, title: "Findings, explained", body: "Bedrock explains each one", accent: C.orange },
      { at: 0.75, title: "AI-written fixes", body: "code you can paste back into your client", accent: C.violet },
    ],
  },
  "demo-integrate": {
    step: 7,
    label: "Integrate",
    path: "/projects/jtqavpxsis",
    callouts: [
      { at: 0.03, title: "One-line integration", body: `API_BASE_URL=https://${LIVE_URL}/x/jtqavpxsis`, code: true },
      { at: 0.5, title: "Gate CI on resilience", body: "npx chaoslab run -- npm test", code: true, accent: C.mint },
    ],
  },
};
const TOTAL_STEPS = Object.keys(DEMOS).length;

const renderScene = (t: SceneTiming) => {
  if (t.id === "intro") return <HFSegment t={t} fallback={<IntroFallback t={t} />} />;
  if (t.id === "outro") return <HFSegment t={t} fallback={<OutroFallback t={t} liveUrl={LIVE_URL} />} />;
  if (t.id === "problem") return <Problem t={t} />;
  if (t.id === "solution") return <Solution t={t} />;
  if (t.id === "differentiator") return <Differentiator t={t} />;
  if (t.id === "architecture") return <Architecture t={t} />;
  const spec = DEMOS[t.id];
  if (spec) return <DemoScene t={t} spec={spec} liveUrl={LIVE_URL} totalSteps={TOTAL_STEPS} />;
  return null;
};

const CUTS = timing.scenes.slice(1).map((s) => s.from);

/** Digital-glitch cut: jitter + RGB split on the content, slices + flash on top. */
const useCutGlitch = () => {
  const frame = useCurrentFrame();
  const cut = CUTS.find((c) => frame >= c - 4 && frame < c + 5);
  if (cut === undefined) return { active: false, cut: 0, frame };
  return { active: true, cut, frame };
};

const GlitchSlices: React.FC = () => {
  const { active, cut, frame } = useCutGlitch();
  if (!active) return null;
  const k = frame - cut;
  const strength = 1 - Math.abs(k + 0.5) / 5;
  const slices = new Array(7).fill(0).map((_, i) => ({
    top: random(`st-${frame}-${i}`) * 100,
    h: 4 + random(`sh-${frame}-${i}`) * 34,
    x: (random(`sx-${frame}-${i}`) - 0.5) * 220 * strength,
    color: [C.red, C.info, C.violet, C.orange][i % 4],
  }));
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
      {slices.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${s.top}%`, height: s.h, transform: `translateX(${s.x}px)`, background: s.color, opacity: 0.22 * strength }} />
      ))}
      <AbsoluteFill style={{ background: "#fff", opacity: k === 0 ? 0.08 : 0 }} />
    </AbsoluteFill>
  );
};

const Content: React.FC = () => {
  const { active, cut, frame } = useCutGlitch();
  let style: React.CSSProperties = {};
  if (active) {
    const k = frame - cut;
    const s = 1 - Math.abs(k + 0.5) / 5;
    const dx = (random(`cx-${frame}`) - 0.5) * 40 * s;
    style = {
      transform: `translateX(${dx}px)`,
      filter: `drop-shadow(${-8 * s}px 0 rgba(255,61,90,0.7)) drop-shadow(${8 * s}px 0 rgba(77,163,255,0.7))`,
    };
  }
  return (
    <AbsoluteFill style={style}>
      {timing.scenes.map((t) => (
        <Sequence key={t.id} from={t.from} durationInFrames={t.frames} name={t.id}>
          {renderScene(t)}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ---------- audio (same plan as scripts/mix-audio.mjs) ----------
const PLAN = buildAudioPlan(timing);

const Soundtrack: React.FC = () => (
  <>
    <Html5Audio src={staticFile(PLAN.music.file)} volume={(f) => musicGainAt(PLAN, f)} />
    {[...PLAN.voice, ...PLAN.sfx].map((ev, i) => (
      <Sequence key={`a${i}`} from={ev.from} durationInFrames={ev.frames} layout="none">
        <Html5Audio src={staticFile(ev.file)} volume={ev.volume} />
      </Sequence>
    ))}
  </>
);

export const ChaosLabDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, color: C.text, fontFamily: inter }}>
    <Backdrop />
    <Content />
    <GlitchSlices />
    <Vignette />
    <Soundtrack />
  </AbsoluteFill>
);
