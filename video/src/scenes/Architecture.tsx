import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { C, inter, mono } from "../theme";
import { clamp, GradientText, Kicker, SceneShell, useSpringIn } from "../components/ui";
import type { SceneTiming } from "../timing";

export const ARCH_BEATS = { client: 0.04, edge: 0.13, api: 0.23, lambdas: 0.3, data: 0.48, bedrock: 0.57, cw: 0.66, term: 0.73, fail: 0.93 };

const NODE_W = 252;
const NODE_H = 104;
const COLS = [92, 392, 692, 992, 1292, 1592];
const ROWS = [228, 372, 516];

type Icon = "user" | "cdn" | "bucket" | "gateway" | "lambda" | "dynamo" | "bedrock" | "watch";
type NodeDef = { id: string; col: number; row: number; title: string; sub: string; icon: Icon; color: string; beat: keyof typeof ARCH_BEATS; stagger?: number };

const NODES: NodeDef[] = [
  { id: "client", col: 0, row: 1, title: "Your app", sub: "browser · CI runner", icon: "user", color: C.text, beat: "client" },
  { id: "cf", col: 1, row: 0, title: "CloudFront", sub: "CDN · HTTPS", icon: "cdn", color: C.info, beat: "edge" },
  { id: "s3web", col: 2, row: 0, title: "S3", sub: "static web app", icon: "bucket", color: C.mint, beat: "edge", stagger: 6 },
  { id: "apigw", col: 2, row: 1, title: "API Gateway", sub: "HTTP API", icon: "gateway", color: C.violet, beat: "api" },
  { id: "l-ctrl", col: 3, row: 0, title: "Lambda", sub: "control plane API", icon: "lambda", color: C.orange, beat: "lambdas" },
  { id: "l-chaos", col: 3, row: 1, title: "Lambda", sub: "chaos data plane", icon: "lambda", color: C.orange, beat: "lambdas", stagger: 6 },
  { id: "l-ai", col: 3, row: 2, title: "Lambda", sub: "AI worker", icon: "lambda", color: C.orange, beat: "lambdas", stagger: 12 },
  { id: "ddb", col: 4, row: 0, title: "DynamoDB", sub: "projects · runs", icon: "dynamo", color: C.info, beat: "data" },
  { id: "s3data", col: 4, row: 1, title: "S3", sub: "specs · reports", icon: "bucket", color: C.mint, beat: "data", stagger: 6 },
  { id: "bedrock", col: 4, row: 2, title: "Amazon Bedrock", sub: "foundation models", icon: "bedrock", color: C.red, beat: "bedrock" },
  { id: "cw", col: 5, row: 1, title: "CloudWatch", sub: "metrics · dashboard", icon: "watch", color: C.warn, beat: "cw" },
];

const nodeBox = (id: string) => {
  const n = NODES.find((x) => x.id === id)!;
  return { x: COLS[n.col], y: ROWS[n.row], w: NODE_W, h: NODE_H };
};
const right = (id: string) => { const b = nodeBox(id); return [b.x + b.w, b.y + b.h / 2] as const; };
const left = (id: string) => { const b = nodeBox(id); return [b.x, b.y + b.h / 2] as const; };
const bottom = (id: string) => { const b = nodeBox(id); return [b.x + b.w / 2, b.y + b.h] as const; };

const curve = (a: readonly [number, number], b: readonly [number, number]) => {
  const mx = (a[0] + b[0]) / 2;
  return `M ${a[0]} ${a[1]} C ${mx} ${a[1]}, ${mx} ${b[1]}, ${b[0]} ${b[1]}`;
};

const BUS_Y = 662;
type EdgeDef = { d: string; beat: keyof typeof ARCH_BEATS; color: string; dashed?: boolean; len: number };
const approxLen = (d: string) => {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  let L = 0;
  for (let i = 2; i < n.length; i += 2) L += Math.hypot(n[i] - n[i - 2], n[i + 1] - n[i - 1]);
  return L;
};
const mk = (d: string, beat: EdgeDef["beat"], color: string, dashed = false): EdgeDef => ({ d, beat, color, dashed, len: approxLen(d) });
const EDGES: EdgeDef[] = [
  mk(curve(right("client"), left("cf")), "edge", C.info),
  mk(`M ${right("cf")[0]} ${right("cf")[1]} L ${left("s3web")[0]} ${left("s3web")[1]}`, "edge", C.mint),
  mk(`M ${right("client")[0]} ${right("client")[1]} L ${left("apigw")[0]} ${left("apigw")[1]}`, "api", C.violet),
  mk(curve(right("apigw"), left("l-ctrl")), "lambdas", C.orange),
  mk(`M ${right("apigw")[0]} ${right("apigw")[1]} L ${left("l-chaos")[0]} ${left("l-chaos")[1]}`, "lambdas", C.orange),
  mk(curve(right("l-ctrl"), left("ddb")), "data", C.info),
  mk(curve(right("l-ctrl"), left("s3data")), "data", C.mint),
  mk(curve(right("l-chaos"), left("ddb")), "data", C.info),
  mk(curve(right("l-ai"), left("s3data")), "data", C.mint),
  mk(`M ${right("l-ai")[0]} ${right("l-ai")[1]} L ${left("bedrock")[0]} ${left("bedrock")[1]}`, "bedrock", C.red),
  // metrics bus: all lambdas → CloudWatch
  mk(`M ${bottom("l-ai")[0]} ${bottom("l-ai")[1]} L ${bottom("l-ai")[0]} ${BUS_Y} L ${bottom("cw")[0]} ${BUS_Y} L ${bottom("cw")[0]} ${bottom("cw")[1]}`, "cw", C.warn, true),
];

const IconSvg: React.FC<{ kind: Icon; color: string }> = ({ kind, color }) => {
  const s = { stroke: color, strokeWidth: 2.2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "user":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><rect x="3" y="5" width="24" height="17" rx="3" {...s} /><path d="M10 26h10M15 22v4" {...s} /></svg>);
    case "cdn":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="11" {...s} /><path d="M4 15h22M15 4c4 4 4 18 0 22M15 4c-4 4-4 18 0 22" {...s} /></svg>);
    case "bucket":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><ellipse cx="15" cy="8" rx="10" ry="3.5" {...s} /><path d="M5 8l2.5 16c.3 1.6 3.6 2.5 7.5 2.5s7.2-.9 7.5-2.5L25 8" {...s} /></svg>);
    case "gateway":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><path d="M4 9h22M4 15h22M4 21h22" {...s} /><path d="M20 5l5 4-5 4M10 17l-5 4 5 4" {...s} /></svg>);
    case "lambda":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><path d="M7 25L14 12M9 5h4l11 20" {...s} /></svg>);
    case "dynamo":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><ellipse cx="15" cy="7" rx="10" ry="3.5" {...s} /><path d="M5 7v16c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5V7M5 15c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5" {...s} /></svg>);
    case "bedrock":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 3l2.8 8.2L26 14l-8.2 2.8L15 25l-2.8-8.2L4 14l8.2-2.8z" fill={color} /></svg>);
    case "watch":
      return (<svg width="30" height="30" viewBox="0 0 30 30"><path d="M3 20l6-6 5 4 6-9 7 6" {...s} /><path d="M3 26h24" {...s} /></svg>);
  }
};

const Node: React.FC<{ n: NodeDef; delay: number }> = ({ n, delay }) => {
  const frame = useCurrentFrame();
  const p = useSpringIn(delay, { damping: 15, stiffness: 140 });
  const active = interpolate(frame - delay, [0, 6, 22], [0, 1, 0.25], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: COLS[n.col],
        top: ROWS[n.row],
        width: NODE_W,
        height: NODE_H,
        opacity: Math.min(1, p * 1.5),
        transform: `scale(${0.85 + p * 0.15})`,
        borderRadius: 18,
        background: "linear-gradient(180deg, #161622, #101019)",
        border: `1px solid ${n.color === C.text ? C.border : `${n.color}66`}`,
        boxShadow: `0 20px 50px rgba(0,0,0,0.45), 0 0 ${10 + active * 40}px ${n.color}${active > 0.3 ? "55" : "22"}`,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: 14,
          background: `${n.color}1A`,
          border: `1px solid ${n.color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconSvg kind={n.icon} color={n.color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: inter, fontWeight: 700, fontSize: 23, color: C.text, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{n.title}</div>
        <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, marginTop: 4, whiteSpace: "nowrap" }}>{n.sub}</div>
      </div>
    </div>
  );
};

const TERM_LINES: { text: string; color: string }[] = [
  { text: "▸ chaos endpoint  https://api.chaoslab.app/c/demo-shop", color: C.muted },
  { text: "▸ profile         payments-hardening · 8 faults", color: C.muted },
  { text: "✓ GET  /products   latency +2s       handled", color: C.mint },
  { text: "✓ GET  /users      malformed_json    handled", color: C.mint },
  { text: "✗ POST /payments   timeout → retried without Idempotency-Key", color: C.red },
  { text: "✗ GET  /products   429 → Retry-After ignored (14 retries)", color: C.red },
  { text: "Resilience score  61 / 100 (D)   ·   gate ≥ 80", color: C.warn },
];

const Terminal: React.FC<{ delay: number; failAt: number }> = ({ delay, failAt }) => {
  const frame = useCurrentFrame();
  const p = useSpringIn(delay, { damping: 18, stiffness: 120 });
  const cmd = "npx chaoslab run --project demo-shop -- npm test";
  const typed = Math.max(0, Math.min(cmd.length, Math.floor(((frame - delay - 8) / 30) * 42)));
  const cmdDone = delay + 8 + Math.ceil((cmd.length / 42) * 30);
  const span = Math.max(TERM_LINES.length * 4, failAt - cmdDone - 6);
  const failP = useSpringIn(failAt, { damping: 12, stiffness: 160 });
  return (
    <div
      style={{
        position: "absolute",
        left: 700,
        top: 712,
        width: 1128,
        height: 334,
        opacity: Math.min(1, p * 1.4),
        transform: `translateY(${(1 - p) * 40}px)`,
        borderRadius: 18,
        background: "#0A0A10",
        border: `1px solid ${C.border}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: `1px solid ${C.border}`, background: "#12121C" }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c, opacity: 0.85 }} />
        ))}
        <span style={{ marginLeft: 14, fontFamily: mono, fontSize: 14, color: C.dim }}>ci · github-actions · test (chaos)</span>
      </div>
      <div style={{ padding: "14px 22px", fontFamily: mono, fontSize: 18, lineHeight: 1.5, whiteSpace: "pre" }}>
        <div style={{ color: C.text }}>
          <span style={{ color: C.mint }}>$ </span>
          {cmd.slice(0, typed)}
          {typed < cmd.length && Math.floor(frame / 8) % 2 === 0 && <span style={{ color: C.orange }}>▍</span>}
        </div>
        {TERM_LINES.map((l, i) => {
          const show = frame >= cmdDone + 4 + (i * span) / TERM_LINES.length;
          return show ? (
            <div key={i} style={{ color: l.color }}>
              {l.text}
            </div>
          ) : null;
        })}
      </div>
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 18,
          opacity: failP,
          transform: `scale(${0.8 + failP * 0.2})`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderRadius: 12,
          background: "rgba(255,61,90,0.14)",
          border: `1px solid ${C.red}`,
          fontFamily: mono,
          fontWeight: 700,
          fontSize: 18,
          color: C.red,
          boxShadow: `0 0 30px ${C.red}44`,
        }}
      >
        ✗ CI gate failed · exit 1
      </div>
    </div>
  );
};

export const Architecture: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const vo = t.vo ?? { offset: 0, frames: t.frames };
  const at = (f: number) => Math.round(vo.offset + f * vo.frames);
  const title = interpolate(frame, [2, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const ciP = interpolate(frame, [at(ARCH_BEATS.term) - 6, at(ARCH_BEATS.term) + 10], [0, 1], clamp);

  return (
    <SceneShell durationInFrames={t.frames}>
      <AbsoluteFill style={{ padding: "64px 92px 0" }}>
        <Kicker>04 · Under the hood</Kicker>
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
          }}
        >
          Serverless on <GradientText>AWS</GradientText>
        </div>
      </AbsoluteFill>

      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        {EDGES.map((e, i) => {
          const d0 = at(ARCH_BEATS[e.beat]) + 4;
          const p = interpolate(frame, [d0, d0 + 18], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
          if (p <= 0) return null;
          return (
            <g key={i}>
              <path d={e.d} fill="none" stroke={C.border} strokeWidth="2" />
              <path
                d={e.d}
                fill="none"
                stroke={e.color}
                strokeOpacity={0.75}
                strokeWidth="2.5"
                strokeDasharray={e.dashed ? "8 8" : `${e.len} ${e.len}`}
                strokeDashoffset={e.dashed ? -frame * 0.8 : e.len * (1 - p)}
                opacity={e.dashed ? p : 1}
              />
              {p >= 1 && <Packet d={e.d} len={e.len} frame={frame - d0} color={e.color} />}
            </g>
          );
        })}
      </svg>

      {NODES.map((n) => (
        <Node key={n.id} n={n} delay={at(ARCH_BEATS[n.beat]) + (n.stagger ?? 0)} />
      ))}

      {/* CI caption */}
      <div style={{ position: "absolute", left: 92, top: 742, width: 560, opacity: ciP, transform: `translateY(${(1 - ciP) * 20}px)` }}>
        <Kicker delay={at(ARCH_BEATS.term) - 6} color={C.mint}>
          CI gate
        </Kicker>
        <div style={{ marginTop: 14, fontFamily: inter, fontWeight: 800, fontSize: 44, letterSpacing: "-0.035em", lineHeight: 1.08 }}>
          One command runs your tests <GradientText>against chaos.</GradientText>
        </div>
        <div style={{ marginTop: 16, fontFamily: inter, fontSize: 22, color: C.muted, lineHeight: 1.45 }}>
          Resilience regressions fail the build — before they reach users.
        </div>
      </div>
      <Terminal delay={at(ARCH_BEATS.term)} failAt={at(ARCH_BEATS.fail)} />
    </SceneShell>
  );
};

/** A glowing packet travelling along an SVG path (computed with getPointAtLength-free sampling). */
const Packet: React.FC<{ d: string; len: number; frame: number; color: string }> = ({ d, frame, color }) => {
  const pts = samplePath(d);
  const k = ((frame / 50) % 1 + 1) % 1;
  const idx = Math.min(pts.length - 1, Math.floor(k * (pts.length - 1)));
  const [x, y] = pts[idx];
  return <circle cx={x} cy={y} r="5" fill="#fff" opacity={Math.sin(k * Math.PI)} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />;
};

const cache = new Map<string, [number, number][]>();
const samplePath = (d: string): [number, number][] => {
  const hit = cache.get(d);
  if (hit) return hit;
  const tokens = d.match(/[MLC]|-?\d+(\.\d+)?/g)!;
  const out: [number, number][] = [];
  let i = 0;
  let cur: [number, number] = [0, 0];
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") { cur = [+tokens[i++], +tokens[i++]]; out.push(cur); }
    else if (cmd === "L") {
      const nxt: [number, number] = [+tokens[i++], +tokens[i++]];
      for (let s = 1; s <= 24; s++) out.push([cur[0] + ((nxt[0] - cur[0]) * s) / 24, cur[1] + ((nxt[1] - cur[1]) * s) / 24]);
      cur = nxt;
    } else if (cmd === "C") {
      const c1 = [+tokens[i++], +tokens[i++]], c2 = [+tokens[i++], +tokens[i++]], e = [+tokens[i++], +tokens[i++]];
      for (let s = 1; s <= 32; s++) {
        const t = s / 32, u = 1 - t;
        out.push([
          u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
          u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
        ]);
      }
      cur = [e[0], e[1]];
    }
  }
  cache.set(d, out);
  return out;
};
