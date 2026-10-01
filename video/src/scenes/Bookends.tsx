import React from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, Easing } from "remotion";
import { C, inter, mono } from "../theme";
import { clamp, GlitchText, GradientText, LogoMark, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

/** Plays a HyperFrames-rendered segment; freezes its last frame if the scene runs longer. */
export const HFSegment: React.FC<{ t: SceneTiming; fallback: React.ReactNode }> = ({ t, fallback }) => {
  if (!t.hf) return <>{fallback}</>;
  const src = staticFile(t.hf.file);
  const play = Math.min(t.frames, t.hf.frames);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={play} layout="none">
        <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%" }} />
      </Sequence>
      {t.frames > play && (
        <Sequence from={play} layout="none">
          <Freeze frame={play - 1}>
            <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%" }} />
          </Freeze>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

/** Remotion-native fallback for the HyperFrames intro (used only if public/hf/intro.mp4 is missing). */
export const IntroFallback: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const l1 = useSpringIn(6);
  const l2 = useSpringIn(48);
  const logoAt = Math.round(t.frames * 0.68);
  const logo = useSpringIn(logoAt, { damping: 14, stiffness: 120 });
  const hookOut = interpolate(frame, [logoAt - 12, logoAt], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: inter, color: C.text }}>
      <div style={{ opacity: hookOut, textAlign: "center", fontWeight: 800, fontSize: 112, letterSpacing: "-0.045em", lineHeight: 1.05 }}>
        <div style={{ opacity: l1, transform: `translateY(${(1 - l1) * 30}px)` }}>Your app works…</div>
        <div style={{ opacity: l2, transform: `translateY(${(1 - l2) * 30}px)` }}>
          <GlitchText seed="ifb" bursts={[50, 64, 120, 160]}>
            <GradientText>until the API doesn&apos;t.</GradientText>
          </GlitchText>
        </div>
      </div>
      <div style={{ position: "absolute", display: "flex", alignItems: "center", gap: 36, opacity: logo, transform: `scale(${0.9 + logo * 0.1})` }}>
        <LogoMark size={140} />
        <div style={{ fontWeight: 800, fontSize: 140, letterSpacing: "-0.05em" }}>
          API <GradientText>Chaos</GradientText> Lab
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Remotion-native fallback for the HyperFrames outro. */
export const OutroFallback: React.FC<{ t: SceneTiming; liveUrl: string }> = ({ t, liveUrl }) => {
  const frame = useCurrentFrame();
  const a = useSpringIn(6);
  const b = useSpringIn(26);
  const c = useSpringIn(60);
  const fade = interpolate(frame, [t.frames - 24, t.frames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: inter, color: C.text }}>
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: 132, letterSpacing: "-0.05em", lineHeight: 1.02 }}>
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>Break your APIs</div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 40}px)` }}>
          <GradientText>before your users do.</GradientText>
        </div>
      </div>
      <div style={{ marginTop: 70, display: "flex", alignItems: "center", gap: 22, opacity: c }}>
        <LogoMark size={64} />
        <div style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-0.04em" }}>
          API <GradientText>Chaos</GradientText> Lab
        </div>
        <div style={{ fontFamily: mono, fontSize: 40, padding: "14px 24px", borderRadius: 16, border: `1px solid ${C.border}`, background: C.raised }}>
          {liveUrl}
        </div>
      </div>
      <AbsoluteFill style={{ background: "#000", opacity: fade }} />
    </AbsoluteFill>
  );
};
