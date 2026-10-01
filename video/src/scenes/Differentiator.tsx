import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { C, inter, mono } from "../theme";
import { clamp, GlitchText, GradientText, Kicker, Panel, SceneShell, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

// narration beats (fraction of the voice-over) — also used for SFX in ChaosLabDemo
export const DIFF_BEATS = { lanes: 0.17, storm: 0.42, retryAfter: 0.56, post: 0.7, end: 0.78, alert: 0.66, dialF: 0.8, dialA: 0.89 };

type Ev = { t: number; kind: "dot" | "tick"; color: string; label?: string; below?: boolean };
type Win = { t1: number; t2: number; label: string; color: string };
type Brk = { t1: number; t2: number; label: string; color: string; showAt: number };

const T_MAX = 10;
const TRACK_X0 = 44;
const TRACK_W = 1030;
const tx = (t: number) => TRACK_X0 + (t / T_MAX) * TRACK_W;

const naiveEvents: Ev[] = [
  { t: 0.4, kind: "dot", color: C.red, label: "503" },
  ...[0.55, 0.7, 0.85, 1.0, 1.15, 1.3, 1.45, 1.6, 1.75, 1.9, 2.05, 2.2].map((t) => ({ t, kind: "tick" as const, color: C.red })),
  { t: 2.6, kind: "dot", color: C.orange, label: "429", below: true },
  ...[2.85, 3.15, 3.45, 3.75, 4.05, 4.35, 4.65, 4.95, 5.25].map((t) => ({ t, kind: "tick" as const, color: C.red })),
  { t: 6.3, kind: "dot", color: C.warn, label: "POST · timeout" },
  { t: 7.1, kind: "dot", color: C.red, label: "POST again · no key", below: true },
];
const naiveWins: Win[] = [{ t1: 2.6, t2: 5.6, label: "Retry-After: 3s · ignored", color: C.orange }];
const naiveBrk: Brk[] = [
  { t1: 0.4, t2: 2.2, label: "13 requests in 1.8 s · no backoff", color: C.red, showAt: 2.25 },
];

const goodEvents: Ev[] = [
  { t: 0.4, kind: "dot", color: C.red, label: "503" },
  { t: 1.05, kind: "dot", color: C.red, label: "503" },
  { t: 2.25, kind: "dot", color: C.red, label: "503" },
  { t: 4.5, kind: "dot", color: C.orange, label: "429", below: true },
  { t: 7.6, kind: "dot", color: C.mint, label: "200 ✓" },
  { t: 8.2, kind: "dot", color: C.warn, label: "POST · timeout", below: true },
  { t: 9.1, kind: "dot", color: C.mint, label: "same key · 200 ✓" },
];
const goodWins: Win[] = [{ t1: 4.5, t2: 7.5, label: "Retry-After: 3s · waited", color: C.mint }];
const goodBrk: Brk[] = [{ t1: 0.4, t2: 2.25, label: "backoff 0.6 → 1.2 s + jitter", color: C.mint, showAt: 2.3 }];

const Lane: React.FC<{
  name: string;
  color: string;
  playT: number;
  events: Ev[];
  wins: Win[];
  brks: Brk[];
  chips: { at: number; text: string; ok: boolean }[];
  frame: number;
  appear: number;
}> = ({ name, color, playT, events, wins, brks, chips, frame, appear }) => {
  const TRACK_Y = 150;
  return (
    <div style={{ position: "relative", height: 318, opacity: appear }}>
      <div style={{ position: "absolute", left: TRACK_X0, top: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 12, height: 12, borderRadius: 99, background: color, boxShadow: `0 0 12px ${color}` }} />
        <span style={{ fontFamily: inter, fontWeight: 700, fontSize: 28, color: C.text }}>{name}</span>
      </div>
      {/* track */}
      <div style={{ position: "absolute", left: TRACK_X0, width: TRACK_W, top: TRACK_Y, height: 2, background: C.border }} />
      <div style={{ position: "absolute", left: TRACK_X0, width: Math.max(0, tx(playT) - TRACK_X0), top: TRACK_Y, height: 2, background: `${color}AA` }} />
      {[0, 2, 4, 6, 8, 10].map((s) => (
        <div key={s} style={{ position: "absolute", left: tx(s) - 1, top: TRACK_Y + 6, width: 2, height: 8, background: C.border }} />
      ))}
      <div style={{ position: "absolute", left: TRACK_X0 + TRACK_W + 10, top: TRACK_Y - 9, fontFamily: mono, fontSize: 14, color: C.dim }}>10s</div>
      {/* windows */}
      {wins.map((w, i) => {
        if (playT < w.t1) return null;
        const end = Math.min(playT, w.t2);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: tx(w.t1),
              width: tx(end) - tx(w.t1),
              top: TRACK_Y - 52,
              height: 86,
              borderRadius: 10,
              background: `${w.color}14`,
              border: `1px dashed ${w.color}88`,
            }}
          >
            <div style={{ position: "absolute", left: 10, top: 5, fontFamily: mono, fontSize: 14, color: w.color, whiteSpace: "nowrap", opacity: interpolate(playT, [w.t1 + 0.6, w.t1 + 0.9], [0, 1], clamp) }}>{w.label}</div>
          </div>
        );
      })}
      {/* brackets */}
      {brks.map((b, i) => {
        const p = interpolate(playT, [b.showAt, b.showAt + 0.25], [0, 1], clamp);
        if (p <= 0) return null;
        return (
          <div key={i} style={{ position: "absolute", left: tx(b.t1), width: tx(b.t2) - tx(b.t1), top: TRACK_Y + 36, opacity: p }}>
            <div style={{ height: 8, borderLeft: `2px solid ${b.color}`, borderRight: `2px solid ${b.color}`, borderBottom: `2px solid ${b.color}` }} />
            <div style={{ position: "absolute", left: 0, top: 18, fontFamily: mono, fontSize: 15, color: b.color, whiteSpace: "nowrap", background: C.surface, paddingRight: 6 }}>
              {b.label}
            </div>
          </div>
        );
      })}
      {/* events */}
      {events.map((e, i) => {
        const p = interpolate(playT, [e.t, e.t + 0.12], [0, 1], clamp);
        if (p <= 0) return null;
        const pop = 1 + (1 - p) * 0.8;
        if (e.kind === "tick") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: tx(e.t) - 2,
                top: TRACK_Y - 16,
                width: 4,
                height: 32,
                borderRadius: 3,
                background: e.color,
                boxShadow: `0 0 10px ${e.color}`,
                transform: `scaleY(${pop})`,
                opacity: p,
              }}
            />
          );
        }
        return (
          <div key={i} style={{ position: "absolute", left: tx(e.t) - 9, top: TRACK_Y - 9, opacity: p }}>
            <div style={{ width: 18, height: 18, borderRadius: 99, background: e.color, boxShadow: `0 0 16px ${e.color}`, transform: `scale(${pop})` }} />
            {e.label && (
              <div
                style={{
                  position: "absolute",
                  left: 9,
                  transform: "translateX(-50%)",
                  top: e.below ? 30 : -34,
                  fontFamily: mono,
                  fontSize: 15,
                  fontWeight: 600,
                  color: e.color,
                  whiteSpace: "nowrap",
                }}
              >
                {e.label}
              </div>
            )}
          </div>
        );
      })}
      {/* playhead */}
      {playT > 0 && playT < T_MAX && (
        <div style={{ position: "absolute", left: tx(playT) - 1, top: TRACK_Y - 50, width: 2, height: 100, background: "rgba(255,255,255,0.6)", boxShadow: "0 0 12px #fff" }} />
      )}
      {/* finding chips */}
      <div style={{ position: "absolute", left: TRACK_X0, top: 254, display: "flex", gap: 12 }}>
        {chips.map((c, i) => {
          const p = interpolate(frame - c.at, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
          const col = c.ok ? C.mint : C.red;
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 14}px) scale(${0.9 + p * 0.1})`,
                fontFamily: mono,
                fontSize: 17,
                fontWeight: 600,
                color: col,
                background: `${col}14`,
                border: `1px solid ${col}55`,
                borderRadius: 10,
                padding: "9px 13px",
                whiteSpace: "nowrap",
              }}
            >
              {c.ok ? "✓" : "✗"} {c.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Dial: React.FC<{ delay: number; grade: string; score: number; color: string; label: string; sub: string }> = ({ delay, grade, score, color, label, sub }) => {
  const frame = useCurrentFrame();
  const appear = useSpringIn(delay, { damping: 14, stiffness: 130 });
  const fill = interpolate(frame - delay, [4, 40], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const R = 112;
  const SWEEP = 260;
  const circ = 2 * Math.PI * R;
  const arcLen = (SWEEP / 360) * circ;
  const val = Math.round(score * fill);
  return (
    <Panel glow={color} style={{ height: 372, padding: "22px 28px", opacity: Math.min(1, appear * 1.4), transform: `scale(${0.9 + appear * 0.1})` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: inter, fontWeight: 700, fontSize: 26, color: C.text }}>{label}</div>
        <div style={{ fontFamily: mono, fontSize: 15, color: C.muted }}>{sub}</div>
      </div>
      <div style={{ position: "relative", width: 280, height: 280, margin: "6px auto 0" }}>
        <svg width="280" height="280" viewBox="0 0 280 280" style={{ transform: `rotate(${90 + (360 - SWEEP) / 2}deg)` }}>
          <circle cx="140" cy="140" r={R} fill="none" stroke={C.border} strokeWidth="18" strokeDasharray={`${arcLen} ${circ}`} strokeLinecap="round" />
          <circle
            cx="140"
            cy="140"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="18"
            strokeDasharray={`${arcLen * (score / 100) * fill} ${circ}`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${color})` }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: inter, fontWeight: 800, fontSize: 112, lineHeight: 1, color, letterSpacing: "-0.04em", opacity: fill > 0.6 ? 1 : fill / 0.6 }}>{grade}</div>
          <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, color: C.text, marginTop: 6 }}>
            {val}
            <span style={{ color: C.dim, fontSize: 20 }}> / 100</span>
          </div>
        </div>
      </div>
    </Panel>
  );
};

export const Differentiator: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const vo = t.vo ?? { offset: 0, frames: t.frames };
  const at = (f: number) => Math.round(vo.offset + f * vo.frames);
  const b = DIFF_BEATS;
  // piecewise playhead so each failure lands on its narration beat
  const playT = interpolate(frame, [at(b.lanes), at(b.storm), at(b.retryAfter), at(b.post), at(b.end)], [0, 2.3, 5.6, 7.6, 10], clamp);
  const title = interpolate(frame, [2, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const lanes = interpolate(frame, [at(0.1), at(0.1) + 14], [0, 1], clamp);
  const alertP = useSpringIn(at(b.alert), { damping: 11, stiffness: 170 });
  const pulse = 0.75 + 0.25 * Math.sin(frame / 3);

  return (
    <SceneShell durationInFrames={t.frames}>
      <AbsoluteFill style={{ padding: "64px 120px 0" }}>
        <Kicker>03 · The difference</Kicker>
        <div
          style={{
            marginTop: 14,
            fontFamily: inter,
            fontWeight: 800,
            fontSize: 66,
            letterSpacing: "-0.045em",
            opacity: title,
            transform: `translateY(${(1 - title) * 24}px)`,
            filter: `blur(${(1 - title) * 8}px)`,
            whiteSpace: "nowrap",
          }}
        >
          We watch how your client behaves <GradientText>under failure.</GradientText>
        </div>

        <div style={{ marginTop: 34, display: "flex", gap: 36 }}>
          <Panel style={{ width: 1120, height: 770, opacity: lanes, transform: `translateY(${(1 - lanes) * 30}px)` }}>
            <div
              style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "0 28px",
                borderBottom: `1px solid ${C.border}`,
                fontFamily: mono,
                fontSize: 18,
                color: C.muted,
                background: "rgba(22,22,34,0.6)",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 99, background: C.red, opacity: pulse, boxShadow: `0 0 10px ${C.red}` }} />
              <span style={{ color: C.text }}>server-side view</span>
              <span>· chaos data plane · POST /payments, GET /orders</span>
              <span style={{ marginLeft: "auto", color: C.orange }}>observing clients</span>
            </div>
            <div style={{ padding: "6px 0 0" }}>
              <Lane
                name="Naive client"
                color={C.red}
                playT={playT}
                events={naiveEvents}
                wins={naiveWins}
                brks={naiveBrk}
                frame={frame}
                appear={1}
                chips={[
                  { at: at(b.storm), text: "retry storm · no backoff", ok: false },
                  { at: at(b.retryAfter), text: "Retry-After ignored", ok: false },
                  { at: at(b.post), text: "no Idempotency-Key", ok: false },
                ]}
              />
              <div style={{ height: 1, background: C.border, margin: "0 28px" }} />
              <Lane
                name="Resilient client"
                color={C.mint}
                playT={playT}
                events={goodEvents}
                wins={goodWins}
                brks={goodBrk}
                frame={frame}
                appear={1}
                chips={[
                  { at: at(b.storm + 0.02), text: "exp. backoff + jitter", ok: true },
                  { at: at(b.post - 0.02), text: "respects Retry-After", ok: true },
                  { at: at(b.end), text: "Idempotency-Key reused", ok: true },
                ]}
              />
            </div>
            {/* double-charge alert */}
            <div
              style={{
                position: "absolute",
                right: 26,
                top: 84,
                opacity: Math.min(1, alertP * 1.5),
                transform: `scale(${0.7 + alertP * 0.3})`,
                transformOrigin: "100% 0%",
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 20px",
                borderRadius: 14,
                background: `rgba(255,61,90,${0.16 + 0.1 * pulse})`,
                border: `1px solid ${C.red}`,
                boxShadow: `0 0 ${30 + 20 * pulse}px ${C.red}66`,
              }}
            >
              <span style={{ fontSize: 30 }}>⚠</span>
              <div>
                <div style={{ fontFamily: inter, fontWeight: 800, fontSize: 24, color: "#fff", letterSpacing: "0.02em" }}>
                  <GlitchText seed="alert" bursts={[at(b.alert) + 2, at(b.alert) + 26, at(b.alert) + 60]} intensity={0.7}>
                    DOUBLE-CHARGE RISK
                  </GlitchText>
                </div>
                <div style={{ fontFamily: mono, fontSize: 15, color: "#FFC2CC", marginTop: 4 }}>POST retried without Idempotency-Key</div>
              </div>
            </div>
          </Panel>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 26 }}>
            <Dial delay={at(b.dialF)} grade="F" score={28} color={C.red} label="Naive client" sub="resilience" />
            <Dial delay={at(b.dialA)} grade="A" score={94} color={C.mint} label="Resilient client" sub="resilience" />
          </div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
