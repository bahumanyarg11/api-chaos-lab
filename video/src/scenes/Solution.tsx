import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, Easing } from "remotion";
import { C, CHAOS, inter, mono } from "../theme";
import { clamp, GradientText, Kicker, Method, Panel, SceneShell, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

export const FAULTS = [
  { id: "latency", label: "latency", color: C.info },
  { id: "timeout", label: "timeout", color: C.warn },
  { id: "500", label: "http 500", color: C.red },
  { id: "429", label: "429", color: C.orange },
  { id: "malformed", label: "malformed JSON", color: C.violet },
  { id: "missing", label: "missing fields", color: "#E05CFF" },
  { id: "drift", label: "schema drift", color: "#FF6FB5" },
  { id: "intermittent", label: "intermittent", color: "#FFD166" },
];

export const ENDPOINTS: { m: string; p: string; risk?: string; cells: Record<string, string> }[] = [
  { m: "GET", p: "/users", cells: { latency: "+1.8s", "500": "15%", malformed: "trunc", drift: "v2" } },
  { m: "POST", p: "/payments", risk: "money · non-idempotent", cells: { timeout: "30s", "500": "20%", "429": "RA 30s", intermittent: "fail×2" } },
  { m: "GET", p: "/orders/{id}", cells: { latency: "+3s", malformed: "html", missing: "-status", drift: "type" } },
  { m: "POST", p: "/auth/login", risk: "rate-limit sensitive", cells: { timeout: "10s", "500": "5%", "429": "RA 60s" } },
  { m: "GET", p: "/products", cells: { latency: "+800ms", "429": "RA 10s", missing: "-price", intermittent: "fail×1" } },
];

const Stage: React.FC<{ delay: number; icon: React.ReactNode; title: string; sub: string; children: React.ReactNode; accent: string }> = ({
  delay,
  icon,
  title,
  sub,
  children,
  accent,
}) => {
  const p = useSpringIn(delay, { damping: 16, stiffness: 120 });
  return (
    <div style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 50}px) scale(${0.95 + p * 0.05})` }}>
      <Panel glow={accent} style={{ width: 480, height: 214, padding: "22px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 13,
              background: `${accent}1F`,
              border: `1px solid ${accent}55`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
          <div>
            <div style={{ fontFamily: inter, fontWeight: 700, fontSize: 27, color: C.text, letterSpacing: "-0.02em" }}>{title}</div>
            <div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 2 }}>{sub}</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
      </Panel>
    </div>
  );
};

const Connector: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const dots = [0, 1, 2];
  return (
    <div style={{ width: 100, height: 4, position: "relative", alignSelf: "center" }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: C.border }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${p * 100}%`, borderRadius: 4, backgroundImage: CHAOS }} />
      {p >= 1 &&
        dots.map((d) => {
          const x = ((frame - delay + d * 10) % 30) / 30;
          return (
            <div
              key={d}
              style={{
                position: "absolute",
                top: -4,
                left: `${x * 100}%`,
                width: 12,
                height: 12,
                borderRadius: 99,
                background: "#fff",
                boxShadow: `0 0 14px ${C.orange}`,
                opacity: Math.sin(x * Math.PI),
              }}
            />
          );
        })}
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: "absolute", right: -10, top: -7, opacity: p }}>
        <path d="M3 2 L13 9 L3 16" stroke={C.violet} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Typed: React.FC<{ text: string; delay: number; cps?: number; style?: React.CSSProperties }> = ({ text, delay, cps = 40, style }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor(((frame - delay) / 30) * cps));
  const shown = text.slice(0, n);
  return (
    <div style={{ fontFamily: mono, fontSize: 17, lineHeight: 1.55, whiteSpace: "pre", ...style }}>
      {shown}
      {n > 0 && n < text.length && <span style={{ color: C.orange }}>▍</span>}
    </div>
  );
};

export const ChaosMatrix: React.FC<{ delay: number; waveFrames: number; scale?: number }> = ({ delay, waveFrames, scale = 1 }) => {
  const frame = useCurrentFrame();
  const appear = useSpringIn(delay, { damping: 200 });
  const LABEL_W = 360;
  const CELL_W = 148;
  const CELL_H = 74;
  const GAP = 12;
  return (
    <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 40}px) scale(${scale})`, transformOrigin: "50% 0%" }}>
      <div style={{ display: "flex", gap: GAP, marginLeft: LABEL_W + GAP, marginBottom: 12 }}>
        {FAULTS.map((f, i) => {
          const p = interpolate(frame - delay - i * 2, [0, 10], [0, 1], clamp);
          return (
            <div
              key={f.id}
              style={{
                width: CELL_W,
                fontFamily: mono,
                fontSize: 16,
                color: f.color,
                textAlign: "center",
                opacity: p,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </div>
          );
        })}
      </div>
      {ENDPOINTS.map((e, r) => (
        <div key={e.p} style={{ display: "flex", gap: GAP, marginBottom: GAP, alignItems: "center" }}>
          <div
            style={{
              width: LABEL_W,
              height: CELL_H,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "0 18px",
              borderRadius: 14,
              background: C.surface,
              border: `1px solid ${C.border}`,
              opacity: interpolate(frame - delay - r * 3, [0, 10], [0, 1], clamp),
            }}
          >
            <Method m={e.m} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontFamily: mono, fontSize: 22, color: C.text, fontWeight: 500 }}>{e.p}</span>
              {e.risk && <span style={{ fontFamily: mono, fontSize: 13, color: C.orange, letterSpacing: "0.04em" }}>AI: {e.risk}</span>}
            </div>
          </div>
          {FAULTS.map((f, c) => {
            const val = e.cells[f.id];
            const t0 = delay + 14 + ((r + c) / (ENDPOINTS.length + FAULTS.length - 2)) * waveFrames;
            const lit = val ? interpolate(frame, [t0, t0 + 8], [0, 1], clamp) : 0;
            const flash = val ? interpolate(frame, [t0, t0 + 3, t0 + 12], [0, 1, 0], clamp) : 0;
            const glitchOn = val && frame > t0 + 12 && random(`g-${r}-${c}-${Math.floor(frame / 3)}`) < 0.035;
            const jx = glitchOn ? (random(`gx-${r}-${c}-${frame}`) - 0.5) * 14 : 0;
            return (
              <div
                key={f.id}
                style={{
                  width: CELL_W,
                  height: CELL_H,
                  borderRadius: 14,
                  position: "relative",
                  background: val ? `rgba(${hexToRgb(f.color)}, ${0.04 + lit * 0.16})` : "rgba(15,15,23,0.75)",
                  border: `1px solid ${val && lit > 0 ? `rgba(${hexToRgb(f.color)}, ${0.25 + lit * 0.5})` : C.border}`,
                  boxShadow: val ? `0 0 ${lit * 26 + flash * 30}px rgba(${hexToRgb(f.color)}, ${0.18 + flash * 0.5})` : undefined,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `translateX(${jx}px) scale(${1 + flash * 0.06})`,
                  filter: glitchOn ? `drop-shadow(-4px 0 ${C.red}) drop-shadow(4px 0 ${C.info})` : undefined,
                }}
              >
                {val ? (
                  <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color: f.color, opacity: lit }}>{val}</span>
                ) : (
                  <span style={{ width: 6, height: 6, borderRadius: 9, background: "#2B2B44" }} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
};

export const Solution: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const vo = t.vo ?? { offset: 0, frames: t.frames };
  const at = (f: number) => Math.round(vo.offset + f * vo.frames);
  const title = interpolate(frame, [2, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const lit = Object.values(ENDPOINTS).reduce((n, e) => n + Object.keys(e.cells).length, 0);
  return (
    <SceneShell durationInFrames={t.frames}>
      <AbsoluteFill style={{ padding: "64px 120px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <Kicker>02 · The solution</Kicker>
            <div
              style={{
                marginTop: 14,
                fontFamily: inter,
                fontWeight: 800,
                fontSize: 74,
                letterSpacing: "-0.045em",
                opacity: title,
                transform: `translateY(${(1 - title) * 26}px)`,
                filter: `blur(${(1 - title) * 8}px)`,
              }}
            >
              Meet API <GradientText>Chaos</GradientText> Lab
            </div>
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 20,
              color: C.muted,
              paddingBottom: 18,
              opacity: interpolate(frame, [at(0.62), at(0.62) + 12], [0, 1], clamp),
            }}
          >
            {ENDPOINTS.length} endpoints × {FAULTS.length} faults → <span style={{ color: C.orange }}>{lit} AI-picked scenarios</span>
          </div>
        </div>

        <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Stage
            delay={at(0.1)}
            accent={C.info}
            title="Paste OpenAPI"
            sub="openapi.yaml · v3"
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path d="M6 2h8l5 5v15H6z" fill="none" stroke={C.info} strokeWidth="2" strokeLinejoin="round" />
                <path d="M9 12h7M9 16h7" stroke={C.info} strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          >
            <Typed delay={at(0.12)} cps={70} style={{ color: C.muted }} text={"paths:\n  /payments:\n    post: { operationId: createPayment }"} />
          </Stage>
          <Connector delay={at(0.27)} />
          <Stage
            delay={at(0.29)}
            accent={C.orange}
            title="Bedrock understands"
            sub="generative AI on Amazon Bedrock"
            icon={
              <svg width="26" height="26" viewBox="0 0 26 26">
                <path d="M13 2l2.6 7.4L23 12l-7.4 2.6L13 22l-2.6-7.4L3 12l7.4-2.6z" fill={C.orange} />
              </svg>
            }
          >
            <Typed delay={at(0.33)} cps={46} style={{ color: C.text }} text={"POST /payments → moves money,\n  not idempotent → test retries\nPOST /auth/login → 429-sensitive"} />
          </Stage>
          <Connector delay={at(0.58)} />
          <Stage
            delay={at(0.6)}
            accent={C.violet}
            title="Chaos matrix"
            sub="endpoints × faults"
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24">
                {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={2 + c * 7.5} y={2 + r * 7.5} width="5.5" height="5.5" rx="1.5" fill={r === 1 && c === 1 ? C.violet : `${C.violet}66`} />))}
              </svg>
            }
          >
            <div style={{ fontFamily: mono, fontSize: 17, lineHeight: 1.55, color: C.muted, opacity: interpolate(frame, [at(0.64), at(0.64) + 10], [0, 1], clamp) }}>
              realistic faults, ranked by risk
              <br />
              <span style={{ color: C.text }}>tailored to <span style={{ color: C.violet }}>your</span> API</span>
            </div>
          </Stage>
        </div>

        <div style={{ marginTop: 40, display: "flex", justifyContent: "center" }}>
          <ChaosMatrix delay={at(0.62)} waveFrames={Math.max(30, at(0.97) - at(0.66))} />
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
