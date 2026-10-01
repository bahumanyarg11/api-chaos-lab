import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing, random } from "remotion";
import { C, inter, mono } from "../theme";
import { Chip, clamp, GlitchText, GradientText, Kicker, Panel, SceneShell, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

const CARD_W = 540;
const CARD_H = 480;

const CardIn: React.FC<{ delay: number; children: React.ReactNode; glow: string }> = ({ delay, children, glow }) => {
  const p = useSpringIn(delay, { damping: 16, stiffness: 120, mass: 0.9 });
  return (
    <div style={{ opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 80}px) scale(${0.94 + 0.06 * p})` }}>
      <Panel glow={glow} style={{ width: CARD_W, height: CARD_H, padding: "30px 32px" }}>
        {children}
      </Panel>
    </div>
  );
};

const CardTitle: React.FC<{ chip: string; color: string; title: string }> = ({ chip, color, title }) => (
  <>
    <Chip color={color}>{chip}</Chip>
    <div style={{ marginTop: 18, fontFamily: inter, fontWeight: 800, fontSize: 38, letterSpacing: "-0.03em", color: C.text }}>{title}</div>
  </>
);

const Untested: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const rows: [string, boolean][] = [
    ["happy path · 200 OK", true],
    ["timeouts", false],
    ["429 + Retry-After", false],
    ["malformed JSON", false],
    ["schema drift", false],
  ];
  return (
    <CardIn delay={delay} glow={C.warn}>
      <CardTitle chip="test coverage" color={C.warn} title="Failure paths: untested" />
      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(([label, ok], i) => {
          const p = interpolate(frame - delay - 10 - i * 5, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const color = ok ? C.mint : C.red;
          return (
            <div
              key={label}
              style={{
                opacity: p,
                transform: `translateX(${(1 - p) * 24}px)`,
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontFamily: mono,
                fontSize: 21,
                color: ok ? C.text : C.muted,
                padding: "10px 14px",
                borderRadius: 12,
                background: ok ? "rgba(34,211,165,0.07)" : "rgba(255,61,90,0.05)",
                border: `1px solid ${ok ? "rgba(34,211,165,0.25)" : C.border}`,
              }}
            >
              <span style={{ color, fontWeight: 700, width: 20 }}>{ok ? "✓" : "✗"}</span>
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{ fontSize: 15, color, letterSpacing: "0.08em" }}>{ok ? "TESTED" : "NEVER"}</span>
            </div>
          );
        })}
      </div>
    </CardIn>
  );
};

const RetryStorm: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const bars = 22;
  const grow = interpolate(local, [8, 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const reqs = Math.round(interpolate(grow, [0, 1], [120, 4800]));
  return (
    <CardIn delay={delay} glow={C.red}>
      <CardTitle chip="retry storm" color={C.red} title="Retries pile up" />
      <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 56, color: grow > 0.45 ? C.red : C.text, letterSpacing: "-0.03em" }}>
          {reqs.toLocaleString("en-US")}
        </span>
        <span style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>req/s to a struggling service</span>
      </div>
      <div style={{ marginTop: 18, height: 170, display: "flex", alignItems: "flex-end", gap: 8 }}>
        {new Array(bars).fill(0).map((_, i) => {
          const base = 0.14 + random(`b${i}`) * 0.08;
          const storm = i < 7 ? 0 : Math.pow((i - 6) / (bars - 7), 1.6);
          const visible = interpolate(local, [6 + i * 2.6, 12 + i * 2.6], [0, 1], clamp);
          const h = (base + storm * 0.86 * grow) * visible;
          const hot = i >= 7 && grow > 0.2;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.min(1, h) * 100}%`,
                borderRadius: 5,
                background: hot ? `linear-gradient(180deg, ${C.red}, ${C.orange}AA)` : "#2E2E48",
                boxShadow: hot ? `0 0 14px ${C.red}55` : undefined,
              }}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 18, fontFamily: mono, fontSize: 17, color: C.dim }}>illustrative · every client retrying instantly</div>
    </CardIn>
  );
};

const DoubleCharge: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const lines: { t: string; c: string; hi?: boolean }[] = [
    { t: "POST /payments    → timeout", c: C.warn },
    { t: "POST /payments    → retry · no key", c: C.muted },
    { t: "charge ch_01  $49.00  captured", c: C.text },
    { t: "charge ch_02  $49.00  captured", c: C.red, hi: true },
  ];
  const alertP = useSpringIn(delay + 38, { damping: 12, stiffness: 160 });
  return (
    <CardIn delay={delay} glow={C.violet}>
      <CardTitle chip="post /payments" color={C.violet} title="Double charges" />
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        {lines.map((l, i) => {
          const p = interpolate(frame - delay - 8 - i * 7, [0, 8], [0, 1], clamp);
          return (
            <div
              key={i}
              style={{
                opacity: p,
                fontFamily: mono,
                fontSize: 19,
                color: l.c,
                padding: "10px 14px",
                borderRadius: 10,
                background: l.hi ? "rgba(255,61,90,0.10)" : "#0B0B12",
                border: `1px solid ${l.hi ? "rgba(255,61,90,0.45)" : C.border}`,
                whiteSpace: "pre",
              }}
            >
              {l.t}
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 22,
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          borderRadius: 12,
          background: C.red,
          color: "#fff",
          fontFamily: inter,
          fontWeight: 700,
          fontSize: 22,
          opacity: alertP,
          transform: `scale(${0.8 + alertP * 0.2})`,
          boxShadow: `0 0 40px ${C.red}66`,
        }}
      >
        <GlitchText seed="dc" bursts={[delay + 44, delay + 70]} intensity={0.6}>
          ⚠ Same order, charged twice
        </GlitchText>
      </div>
    </CardIn>
  );
};

export const Problem: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const vo = t.vo ?? { offset: 0, frames: t.frames };
  const at = (f: number) => Math.round(vo.offset + f * vo.frames);
  const frame = useCurrentFrame();
  const h1 = interpolate(frame, [4, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const h2 = interpolate(frame, [at(0.22), at(0.22) + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <SceneShell durationInFrames={t.frames}>
      <AbsoluteFill style={{ padding: "110px 120px" }}>
        <Kicker>01 · The problem</Kicker>
        <div style={{ marginTop: 22, fontFamily: inter, fontWeight: 800, fontSize: 80, letterSpacing: "-0.045em", lineHeight: 1.04 }}>
          <div style={{ opacity: h1, transform: `translateY(${(1 - h1) * 30}px)`, filter: `blur(${(1 - h1) * 8}px)` }}>Faking failure by hand is tedious.</div>
          <div style={{ opacity: h2, transform: `translateY(${(1 - h2) * 30}px)`, filter: `blur(${(1 - h2) * 8}px)` }}>
            <GradientText>So most teams never test it.</GradientText>
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 455, display: "flex", justifyContent: "center", gap: 36 }}>
        <Untested delay={at(0.3)} />
        <RetryStorm delay={at(0.55)} />
        <DoubleCharge delay={at(0.74)} />
      </div>
    </SceneShell>
  );
};
