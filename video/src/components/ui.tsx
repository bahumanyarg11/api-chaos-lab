import React from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, CHAOS, inter, mono } from "../theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Spring that starts at `delay` frames. */
export const useSpringIn = (delay = 0, config: Parameters<typeof spring>[0]["config"] = { damping: 200 }, durationInFrames?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config, durationInFrames });
};

/** Continuous, deterministic backdrop shared by every Remotion scene. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.35) % 80;
  const glowX = 50 + Math.sin(frame / 140) * 8;
  const glowY = 42 + Math.cos(frame / 170) * 6;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 720px at ${glowX}% ${glowY}%, rgba(177,77,255,0.10), transparent 62%), radial-gradient(900px 520px at ${100 - glowX}% 86%, rgba(255,61,90,0.07), transparent 60%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -80,
          transform: `translateY(${drift}px)`,
          backgroundImage: `linear-gradient(rgba(37,37,58,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(37,37,58,0.42) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 50% 50%, #000 25%, transparent 85%)",
          maskImage: "radial-gradient(ellipse 75% 70% at 50% 50%, #000 25%, transparent 85%)",
        }}
      />
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.6) 100%)" }} />
    <AbsoluteFill
      style={{ background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 4px)", mixBlendMode: "overlay" }}
    />
  </AbsoluteFill>
);

/** Enter (blur + rise) and exit (fade + slight zoom) for a whole scene. */
export const SceneShell: React.FC<{ children: React.ReactNode; durationInFrames: number; enter?: number; exit?: number }> = ({
  children,
  durationInFrames,
  enter = 14,
  exit = 10,
}) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [0, enter], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outP = interpolate(frame, [durationInFrames - exit, durationInFrames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const opacity = inP * (1 - outP);
  const blur = (1 - inP) * 10 + outP * 8;
  const scale = 1 + (1 - inP) * 0.015 + outP * 0.02;
  return (
    <AbsoluteFill style={{ opacity, filter: blur > 0.05 ? `blur(${blur}px)` : undefined, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
  );
};

export const GradientText: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span
    style={{
      backgroundImage: CHAOS,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      paddingBottom: "0.08em",
      ...style,
    }}
  >
    {children}
  </span>
);

/** Small mono label: "● 01 · THE PROBLEM" */
export const Kicker: React.FC<{ children: React.ReactNode; delay?: number; color?: string; style?: React.CSSProperties }> = ({
  children,
  delay = 0,
  color = C.orange,
  style,
}) => {
  const p = useSpringIn(delay);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        fontFamily: mono,
        fontWeight: 500,
        fontSize: 22,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: C.muted,
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
        ...style,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 99, background: color, boxShadow: `0 0 14px ${color}` }} />
      {children}
    </div>
  );
};

/** Text that occasionally glitches (RGB split + jitter) on deterministic frames. */
export const GlitchText: React.FC<{
  children: React.ReactNode;
  seed: string;
  bursts?: number[]; // frames (local) where a glitch burst starts
  burstLen?: number;
  intensity?: number;
  style?: React.CSSProperties;
}> = ({ children, seed, bursts = [], burstLen = 5, intensity = 1, style }) => {
  const frame = useCurrentFrame();
  const active = bursts.some((b) => frame >= b && frame < b + burstLen);
  const r = (k: string) => random(`${seed}-${frame}-${k}`) - 0.5;
  const dx = active ? r("x") * 22 * intensity : 0;
  const sk = active ? r("s") * 10 * intensity : 0;
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      {active && (
        <>
          <span aria-hidden style={{ position: "absolute", inset: 0, color: C.red, transform: `translate(${-6 - Math.abs(r("r")) * 12}px, ${r("ry") * 4}px)`, mixBlendMode: "screen", opacity: 0.85, WebkitTextFillColor: C.red }}>
            {children}
          </span>
          <span aria-hidden style={{ position: "absolute", inset: 0, color: C.info, transform: `translate(${6 + Math.abs(r("b")) * 12}px, ${r("by") * 4}px)`, mixBlendMode: "screen", opacity: 0.85, WebkitTextFillColor: C.info }}>
            {children}
          </span>
        </>
      )}
      <span style={{ position: "relative", display: "inline-block", transform: `translateX(${dx}px) skewX(${sk}deg)` }}>{children}</span>
    </span>
  );
};

export const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; glow?: string }> = ({ children, style, glow }) => (
  <div
    style={{
      position: "relative",
      background: "linear-gradient(180deg, #13131D 0%, #0D0D15 100%)",
      border: `1px solid ${C.border}`,
      borderRadius: 22,
      boxShadow: `0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)${glow ? `, 0 0 60px ${glow}22` : ""}`,
      overflow: "hidden",
      ...style,
    }}
  >
    {glow && (
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(500px 180px at 0% 0%, ${glow}33, transparent 70%)`, pointerEvents: "none" }} />
    )}
    {children}
  </div>
);

export const Chip: React.FC<{ color: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ color, children, style }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      fontFamily: mono,
      fontWeight: 600,
      fontSize: 16,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color,
      background: `${color}1F`,
      border: `1px solid ${color}59`,
      padding: "8px 12px",
      borderRadius: 999,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    <span style={{ width: 8, height: 8, borderRadius: 99, background: color, boxShadow: `0 0 10px ${color}` }} />
    {children}
  </span>
);

export const Method: React.FC<{ m: string; size?: number }> = ({ m, size = 18 }) => {
  const color = m === "GET" ? C.info : m === "POST" ? C.orange : m === "PUT" ? C.violet : C.red;
  return (
    <span
      style={{
        fontFamily: mono,
        fontWeight: 700,
        fontSize: size,
        color,
        background: `${color}1A`,
        border: `1px solid ${color}40`,
        borderRadius: 8,
        padding: "4px 8px",
        letterSpacing: "0.02em",
      }}
    >
      {m}
    </span>
  );
};

export const LogoMark: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 148 148">
    <defs>
      <linearGradient id="cl-mark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={C.red} />
        <stop offset="0.5" stopColor={C.orange} />
        <stop offset="1" stopColor={C.violet} />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="142" height="142" rx="36" fill={C.surface} stroke="url(#cl-mark)" strokeWidth="6" />
    {[
      [30, 30], [62, 30], [94, 30], [30, 62], [94, 62], [30, 94], [62, 94], [94, 94],
    ].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width="24" height="24" rx="6" fill="#2B2B44" />
    ))}
    <rect x="62" y="62" width="24" height="24" rx="6" fill="url(#cl-mark)" />
  </svg>
);

export const fontStack = { fontFamily: inter, color: C.text } as const;
