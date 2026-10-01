import React from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, Easing } from "remotion";
import { C, CHAOS, inter, mono } from "../theme";
import { clamp, Kicker, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

export type CalloutSpec = { at: number; title: string; body: string; accent?: string; code?: boolean };
export type DemoSpec = {
  step: number;
  label: string;
  path: string;
  callouts: CalloutSpec[]; // `at` = fraction of the narration where it appears
};

const FRAME_W = 1400;
const CHROME_H = 50;
const CONTENT_H = Math.round(FRAME_W / 1.6);
const FRAME_H = CONTENT_H + CHROME_H;
const LEFT = 70;
const TOP = Math.round((1080 - FRAME_H) / 2) + 6;

const Recording: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  if (!t.rec) {
    return (
      <AbsoluteFill style={{ background: C.surface, alignItems: "center", justifyContent: "center", fontFamily: mono, color: C.muted, fontSize: 28 }}>
        recording missing — see video/README.md
      </AbsoluteFill>
    );
  }
  const src = staticFile(t.rec.file);
  const zoom = interpolate(frame, [0, t.frames], [1, 1.025], clamp);
  const video = (
    <OffthreadVideo
      src={src}
      muted
      playbackRate={t.rec.playbackRate}
      pauseWhenBuffering
      style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
    />
  );
  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 0%" }}>
      <Sequence durationInFrames={t.rec.playFrames} layout="none">
        {video}
      </Sequence>
      {t.rec.freezeFrames > 0 && (
        <Sequence from={t.rec.playFrames} layout="none">
          <Freeze frame={Math.max(0, t.rec.playFrames - 2)}>{video}</Freeze>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

export const BrowserFrame: React.FC<{ url: string; children: React.ReactNode }> = ({ url, children }) => (
  <div
    style={{
      width: FRAME_W,
      height: FRAME_H,
      borderRadius: 20,
      overflow: "hidden",
      background: C.surface,
      border: `1px solid ${C.border}`,
      boxShadow: "0 50px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03), 0 0 120px rgba(177,77,255,0.10)",
      position: "relative",
    }}
  >
    <div
      style={{
        height: CHROME_H,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 18,
        background: "linear-gradient(180deg, #181826, #12121C)",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: "flex", gap: 9 }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 99, background: c, opacity: 0.9 }} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          maxWidth: 720,
          margin: "0 auto",
          height: 32,
          borderRadius: 9,
          background: "#0B0B12",
          border: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          fontFamily: mono,
          fontSize: 17,
          color: C.muted,
          transform: "translateX(-40px)",
        }}
      >
        <svg width="13" height="15" viewBox="0 0 13 15">
          <rect x="1" y="6" width="11" height="8" rx="2" fill={C.mint} />
          <path d="M3.5 6V4.5a3 3 0 0 1 6 0V6" stroke={C.mint} strokeWidth="1.6" fill="none" />
        </svg>
        <span style={{ color: C.text }}>{url.split("/")[0]}</span>
        <span>{url.includes("/") ? "/" + url.split("/").slice(1).join("/") : ""}</span>
      </div>
    </div>
    <div style={{ position: "relative", height: CONTENT_H, overflow: "hidden", background: C.bg }}>{children}</div>
  </div>
);

const Callout: React.FC<{ spec: CalloutSpec; delay: number; index: number }> = ({ spec, delay, index }) => {
  const frame = useCurrentFrame();
  const p = useSpringIn(delay, { damping: 18, stiffness: 140, mass: 0.8 });
  const accent = spec.accent ?? [C.orange, C.violet, C.mint][index % 3];
  const line = interpolate(frame - delay, [4, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: "relative",
        opacity: Math.min(1, p * 1.4),
        transform: `translateX(${(1 - p) * 60}px) scale(${0.96 + p * 0.04})`,
        background: "linear-gradient(180deg, rgba(22,22,34,0.96), rgba(15,15,23,0.96))",
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        padding: "22px 24px 22px 28px",
        boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 40px ${accent}14`,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent, transform: `scaleY(${line})`, transformOrigin: "top" }} />
      <div style={{ fontFamily: mono, fontSize: 15, color: accent, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
        {String(index + 1).padStart(2, "0")}
      </div>
      <div style={{ fontFamily: inter, fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", color: C.text, lineHeight: 1.15 }}>{spec.title}</div>
      <div
        style={{
          marginTop: 10,
          fontFamily: spec.code ? mono : inter,
          fontWeight: 500,
          fontSize: spec.code ? 17 : 20,
          color: C.muted,
          lineHeight: 1.4,
          ...(spec.code
            ? { background: "#0B0B12", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, wordBreak: "break-all" as const }
            : {}),
        }}
      >
        {spec.body}
      </div>
    </div>
  );
};

export const DemoScene: React.FC<{ t: SceneTiming; spec: DemoSpec; liveUrl: string; totalSteps: number }> = ({ t, spec, liveUrl, totalSteps }) => {
  const frame = useCurrentFrame();
  const enter = useSpringIn(0, { damping: 20, stiffness: 90, mass: 1 });
  const exit = interpolate(frame, [t.frames - 10, t.frames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const voFrames = t.vo?.frames ?? t.frames;
  const voStart = t.vo?.offset ?? 0;
  const progress = interpolate(frame, [0, t.frames], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      {/* browser */}
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: TOP,
          perspective: 1800,
        }}
      >
        <div
          style={{
            transform: `translateY(${(1 - enter) * 70}px) rotateX(${(1 - enter) * 10}deg) scale(${0.95 + enter * 0.05 - exit * 0.02})`,
            transformOrigin: "50% 100%",
            opacity: Math.min(1, enter * 1.3),
            filter: exit > 0 ? `blur(${exit * 8}px)` : undefined,
          }}
        >
          <BrowserFrame url={`${liveUrl}${spec.path}`}>
            <Recording t={t} />
          </BrowserFrame>
        </div>
      </div>

      {/* right rail */}
      <div style={{ position: "absolute", left: LEFT + FRAME_W + 44, right: 56, top: TOP, height: FRAME_H, display: "flex", flexDirection: "column" }}>
        <Kicker delay={4}>
          Step {spec.step} / {totalSteps}
        </Kicker>
        <div
          style={{
            marginTop: 14,
            fontFamily: inter,
            fontWeight: 800,
            fontSize: 46,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: C.text,
            opacity: interpolate(frame, [6, 18], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [6, 22], [16, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
          }}
        >
          {spec.label}
        </div>
        <div style={{ marginTop: 18, height: 3, borderRadius: 3, background: C.border, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", backgroundImage: CHAOS }} />
        </div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 20 }}>
          {spec.callouts.map((c, i) => (
            <Callout key={i} spec={c} index={i} delay={Math.round(voStart + c.at * voFrames)} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
