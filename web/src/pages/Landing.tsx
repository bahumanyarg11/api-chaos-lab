import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  Activity, ArrowRight, Bot, Brain, Check, CircuitBoard, Cloud, Code2, Database, FileJson, Gauge, GitBranch, Layers, Lock, Play, Radar, Repeat, ScanEye, ShieldAlert, Sparkles, Terminal, Timer, Zap,
} from "lucide-react";
import { Nav, Footer } from "../components/Nav";
import { HeroMatrix } from "../components/HeroMatrix";
import { Button, Card, CodeBlock } from "../components/ui";
import { api } from "../lib/api";

const fade = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: 0.6 } };

function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1400);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

function LiveCounters() {
  const [s, setS] = useState({ requests: 0, faults: 0, projects: 0, reports: 0 });
  useEffect(() => {
    api.stats().then(setS).catch(() => undefined);
    const t = setInterval(() => api.stats().then(setS).catch(() => undefined), 8000);
    return () => clearInterval(t);
  }, []);
  const r = useCountUp(s.requests);
  const f = useCountUp(s.faults);
  const p = useCountUp(s.projects);
  const rep = useCountUp(s.reports);
  const items = [
    { k: "Chaos requests served", v: r },
    { k: "Faults injected", v: f },
    { k: "APIs under test", v: p },
    { k: "Resilience reports", v: rep },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
      {items.map((i) => (
        <div key={i.k} className="bg-panel px-6 py-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-mint pulse-ring" /> live · {i.k}
          </div>
          <div className="mt-1 font-mono text-3xl font-bold tabular-nums">{i.v.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  { icon: Brain, t: "AI chaos matrix", d: "Generative AI on Amazon Bedrock reads your OpenAPI spec and understands semantics — payments get idempotency tests, auth gets token-expiry, lists get empty & bloat." },
  { icon: Zap, t: "15 realistic faults", d: "Latency, hangs, 500/502-HTML/503, 429 + Retry-After, malformed JSON, missing fields, wrong types, schema drift, flaky fail-then-succeed, 401, 409, payload bloat." },
  { icon: ScanEye, t: "Server-side behavior analysis", d: "We watch your client from the other side of the wire: retry storms, missing backoff, ignored Retry-After, unsafe POST retries without Idempotency-Key." },
  { icon: Gauge, t: "Resilience score", d: "Every client gets an A–F grade with evidence. Track it per run and fail CI when it drops." },
  { icon: Sparkles, t: "AI explanations & fixes", d: "Click any failure: Bedrock explains what happened, the user impact, and writes the fix in TypeScript, Python, Go or Java." },
  { icon: Layers, t: "Mock or proxy mode", d: "No backend yet? We serve spec-faithful mocks. Have one? Proxy to your real upstream and inject chaos on top." },
  { icon: GitBranch, t: "CI gate", d: "npx chaoslab run -- npm test. Starts a run, executes your tests against the chaos URL, fails the build under your threshold." },
  { icon: Activity, t: "Live traffic + CloudWatch", d: "Watch requests stream in real time; every fault is emitted as CloudWatch metrics with a ready-made dashboard." },
  { icon: Lock, t: "Deterministic when you need it", d: "Force any scenario per request with x-chaos-fault / x-chaos-scenario headers for reproducible tests." },
];

const PLANS = [
  { n: "Hobby", p: "$0", d: "For side projects", f: ["3 APIs", "10k chaos requests / mo", "AI matrix generation", "Community support"], cta: "Start free" },
  { n: "Pro", p: "$29", d: "per developer / month", f: ["Unlimited APIs", "500k chaos requests / mo", "AI reports & code fixes", "CI gate + run history", "Proxy mode"], cta: "Start 14-day trial", hot: true },
  { n: "Team", p: "$199", d: "per team / month", f: ["Everything in Pro", "5M requests / mo", "Shared projects & SSO", "Slack alerts on score drops", "Scheduled game days"], cta: "Talk to us" },
  { n: "Enterprise", p: "Custom", d: "VPC / self-hosted on AWS", f: ["Deploy in your AWS account", "Private Bedrock models", "Audit logs & SLAs", "Dedicated resilience engineer"], cta: "Contact sales" },
];

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Nav />
      {/* HERO */}
      <section className="relative grid-bg">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(177,77,255,0.12),transparent_55%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-raised/60 px-3 py-1 text-xs text-muted">
              <Sparkles className="h-3.5 w-3.5 text-chaos-orange" /> AI-powered API resilience testing · powered by Amazon Bedrock
            </div>
            <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight md:text-7xl">
              Break your APIs <br />
              <span className="chaos-text">before your users do.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Paste an OpenAPI spec. Our AI builds a chaos matrix of timeouts, 429s, malformed JSON and flaky failures for every endpoint. Point your app at the chaos URL and get a <span className="text-fg">resilience score</span> — with the fixes written for you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/app/new">
                <Button size="lg" icon={<Zap className="h-5 w-5" />}>Start chaos testing — free</Button>
              </Link>
              <a href="#demo">
                <Button size="lg" variant="outline" icon={<Play className="h-5 w-5" />}>Watch the demo</Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-dim">
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-mint" /> No SDK required</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-mint" /> Works with any HTTP client</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-mint" /> Serverless on AWS</span>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.15 }}>
            <HeroMatrix />
          </motion.div>
        </div>
        <div className="relative mx-auto max-w-7xl px-5 pb-16">
          <LiveCounters />
        </div>
      </section>

      {/* PROBLEM */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <motion.div {...fade} className="max-w-3xl">
          <div className="text-sm font-semibold text-chaos-orange">The problem</div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Your app works. Until the API doesn't.</h2>
          <p className="mt-4 text-lg text-muted">Every app depends on APIs that time out, rate-limit, and ship breaking changes. Teams test the happy path because faking failures by hand is tedious — so failure handling ships untested.</p>
        </motion.div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            { i: Repeat, c: "#ff3d5a", t: "Retry storms", d: "A naive retry loop turns a 2-second blip into a self-inflicted outage — every client hammers the struggling service at once." },
            { i: ShieldAlert, c: "#ff8a00", t: "Double charges", d: "A POST /payments times out. Was the card charged? Retrying without an Idempotency-Key charges the customer twice." },
            { i: FileJson, c: "#b14dff", t: "Silent contract breaks", d: "A field disappears or becomes a string. Nothing errors — your UI just renders NaN, 'undefined' or a white screen." },
          ].map((x) => (
            <motion.div key={x.t} {...fade}>
              <Card className="h-full p-6">
                <div className="mb-4 inline-flex rounded-xl p-2.5" style={{ background: `${x.c}1a`, color: x.c }}>
                  <x.i className="h-5 w-5" />
                </div>
                <div className="text-lg font-semibold">{x.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{x.d}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="border-y border-line/70 bg-panel/40">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <motion.div {...fade} className="text-center">
            <div className="text-sm font-semibold text-chaos-orange">How it works</div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">From spec to resilience score in 2 minutes</h2>
          </motion.div>
          <div className="mt-14 grid gap-5 md:grid-cols-4">
            {[
              { n: "01", i: FileJson, t: "Paste your OpenAPI", d: "JSON or YAML, Swagger 2 or OpenAPI 3.x. Upload, paste, or point at a URL." },
              { n: "02", i: Bot, t: "AI builds the matrix", d: "Bedrock maps endpoint semantics to the failures that matter, with rationale and expected handling." },
              { n: "03", i: Radar, t: "Point your app at chaos", d: "Swap your base URL for your ChaosLab URL. We mock or proxy, and inject faults by probability or on demand." },
              { n: "04", i: Gauge, t: "Get scored & fixed", d: "Behavioral findings, an A–F grade per client, and AI-written fixes. Gate CI on the score." },
            ].map((s, i) => (
              <motion.div key={s.n} {...fade} transition={{ duration: 0.6, delay: i * 0.08 }}>
                <Card className="relative h-full p-6">
                  <div className="font-mono text-xs text-dim">{s.n}</div>
                  <s.i className="mt-3 h-6 w-6 text-chaos-orange" />
                  <div className="mt-4 font-semibold">{s.t}</div>
                  <p className="mt-2 text-sm text-muted">{s.d}</p>
                </Card>
              </motion.div>
            ))}
          </div>
          <motion.div {...fade} className="mx-auto mt-10 max-w-3xl">
            <CodeBlock
              lang="bash"
              code={`# 1. your app, normally
API_BASE=https://api.acme-store.example.com/v2 npm test

# 2. your app, under controlled chaos
API_BASE=https://<your-lab>.cloudfront.net/x/<projectId> npm test

# 3. or gate CI on resilience
npx chaoslab run --project <projectId> --min-score 80 -- npm test`}
            />
          </motion.div>
        </div>
      </section>

      {/* DIFFERENTIATOR */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <motion.div {...fade}>
            <div className="text-sm font-semibold text-chaos-orange">The unfair advantage</div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">We don't just break things. <span className="chaos-text">We watch how you react.</span></h2>
            <p className="mt-4 text-lg text-muted">Fault injectors stop at "here's a 500". ChaosLab sits on the server side of every request, so it can see what your client does next — and grade it.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {["Retry storms & missing exponential backoff", "Retry-After ignored on 429 / 503", "Non-idempotent POSTs retried without an Idempotency-Key", "Retrying non-retryable 4xx errors", "No client timeout on hung connections", "Crashes on malformed or drifted payloads (via outcome beacon)"].map((x) => (
                <li key={x} className="flex items-start gap-2.5 text-muted">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> {x}
                </li>
              ))}
            </ul>
          </motion.div>
          <motion.div {...fade}>
            <Card className="p-6">
              <CompareTimeline />
            </Card>
          </motion.div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-y border-line/70 bg-panel/40">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <motion.div {...fade} className="max-w-2xl">
            <div className="text-sm font-semibold text-chaos-orange">Features</div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Everything you need to ship failure-proof integrations</h2>
          </motion.div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.t} {...fade} transition={{ duration: 0.5, delay: (i % 3) * 0.06 }}>
                <Card className="h-full p-6 transition hover:border-white/15">
                  <f.icon className="h-5 w-5 text-chaos-orange" />
                  <div className="mt-4 font-semibold">{f.t}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section id="demo" className="mx-auto max-w-6xl px-5 py-24">
        <motion.div {...fade} className="text-center">
          <div className="text-sm font-semibold text-chaos-orange">Demo</div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">See it break. See it heal.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted">Two minutes: an OpenAPI spec becomes an AI chaos matrix, a naive client gets an F, a resilient client gets an A, and Bedrock writes the fix.</p>
        </motion.div>
        <motion.div {...fade} className="chaos-border mt-10 overflow-hidden rounded-2xl">
          <video className="aspect-video w-full bg-black" src="/demo.mp4" poster="/poster.jpg" controls preload="metadata" playsInline />
        </motion.div>
        <div className="mt-6 text-center">
          <Link to="/app/new">
            <Button size="lg" icon={<ArrowRight className="h-5 w-5" />}>Try it on your own API</Button>
          </Link>
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section id="architecture" className="border-y border-line/70 bg-panel/40">
        <div className="mx-auto max-w-7xl px-5 py-24">
          <motion.div {...fade} className="max-w-2xl">
            <div className="text-sm font-semibold text-chaos-orange">Architecture</div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">100% serverless on AWS</h2>
            <p className="mt-4 text-muted">Scales to zero, scales to millions of chaos requests. Every component is managed.</p>
          </motion.div>
          <motion.div {...fade} className="mt-12">
            <Architecture />
          </motion.div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-7xl px-5 py-24">
        <motion.div {...fade} className="text-center">
          <div className="text-sm font-semibold text-chaos-orange">Pricing</div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Cheaper than one outage</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">Start free. Upgrade when chaos testing becomes part of your release process.</p>
        </motion.div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <motion.div key={p.n} {...fade}>
              <div className={`h-full rounded-2xl p-6 ${p.hot ? "chaos-border shadow-[0_0_60px_rgba(255,61,90,0.15)]" : "glass"}`}>
                {p.hot && <div className="mb-3 inline-block rounded-full chaos-bg px-2.5 py-0.5 text-[11px] font-semibold text-white">Most popular</div>}
                <div className="font-semibold">{p.n}</div>
                <div className="mt-3 text-4xl font-extrabold">{p.p}</div>
                <div className="text-xs text-dim">{p.d}</div>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {p.f.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-muted">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/app/new" className="mt-6 block">
                  <Button className="w-full" variant={p.hot ? "primary" : "outline"}>{p.cta}</Button>
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-5 pb-24">
        <div className="chaos-border relative overflow-hidden rounded-3xl px-8 py-16 text-center">
          <div className="absolute inset-0 grid-bg opacity-60" />
          <div className="relative">
            <h2 className="text-4xl font-extrabold tracking-tight md:text-5xl">Controlled chaos, on demand.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">Upload a spec and get your first resilience score in under two minutes.</p>
            <Link to="/app/new" className="mt-8 inline-block">
              <Button size="lg" icon={<Zap className="h-5 w-5" />}>Break my API</Button>
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

function CompareTimeline() {
  const naive = [0, 40, 75, 110, 150, 185];
  const good = [0, 210, 640, 1500];
  const W = 520;
  const scale = (ms: number) => 20 + (ms / 1700) * (W - 40);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="font-mono text-xs text-dim">server-side view · POST /payments · 503 injected</div>
      </div>
      {[
        { name: "naive-client", pts: naive, color: "#ff3d5a", grade: "F · 28", note: "6 retries in 185 ms · no Idempotency-Key · ignored Retry-After" },
        { name: "resilient-client", pts: good, color: "#22d3a5", grade: "A · 94", note: "backoff 210 → 430 → 860 ms + jitter · same Idempotency-Key · recovered" },
      ].map((c) => (
        <div key={c.name} className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-sm" style={{ color: c.color }}>{c.name}</span>
            <span className="rounded-md px-2 py-0.5 font-mono text-sm font-bold" style={{ color: c.color, background: `${c.color}1a` }}>{c.grade}</span>
          </div>
          <svg viewBox={`0 0 ${W} 46`} className="w-full">
            <line x1="20" y1="23" x2={W - 20} y2="23" stroke="#25253a" strokeWidth="2" />
            {c.pts.map((p, i) => (
              <motion.g key={i} initial={{ opacity: 0, scale: 0 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15 }}>
                <circle cx={scale(p)} cy="23" r="8" fill={i === c.pts.length - 1 && c.name.startsWith("res") ? "#22d3a5" : c.color} opacity={0.9} />
                <text x={scale(p)} y="27" textAnchor="middle" fontSize="9" fill="#07070b" fontWeight="700">{i === c.pts.length - 1 && c.name.startsWith("res") ? "✓" : i + 1}</text>
              </motion.g>
            ))}
          </svg>
          <div className="mt-1 text-xs text-muted">{c.note}</div>
        </div>
      ))}
      <div className="flex items-start gap-2 rounded-xl border border-chaos-red/30 bg-chaos-red/10 p-3 text-xs text-[#ffc2cb]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-chaos-red" />
        CRITICAL · naive-client retried a non-idempotent write 6× without an Idempotency-Key — potential double charge.
      </div>
    </div>
  );
}

function Architecture() {
  const box = "rounded-xl border border-line bg-raised/70 px-4 py-3";
  const Node = ({ icon: I, t, d, c = "#ff8a00" }: { icon: any; t: string; d: string; c?: string }) => (
    <div className={box}>
      <div className="flex items-center gap-2 text-sm font-semibold"><I className="h-4 w-4" style={{ color: c }} /> {t}</div>
      <div className="mt-1 text-xs text-muted">{d}</div>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_auto_1.3fr_auto_1fr] lg:items-center">
      <div className="space-y-3">
        <Node icon={Code2} t="Your app / tests / CI" d="any HTTP client → chaos URL" c="#4da3ff" />
        <Node icon={Terminal} t="chaoslab CLI" d="runs, gates, reports" c="#4da3ff" />
        <Node icon={Cloud} t="CloudFront + S3" d="React dashboard, same-origin API" c="#4da3ff" />
      </div>
      <ArrowRight className="mx-auto hidden h-6 w-6 text-dim lg:block" />
      <div className="chaos-border space-y-3 rounded-2xl p-4">
        <Node icon={CircuitBoard} t="Amazon API Gateway (HTTP API)" d="/api/* control plane · /x/* chaos data plane · throttling" />
        <div className="grid grid-cols-3 gap-3">
          <Node icon={Layers} t="Control Lambda" d="projects, matrix, runs" />
          <Node icon={Zap} t="Chaos Lambda" d="mock/proxy + inject" />
          <Node icon={Bot} t="AI worker" d="async jobs" />
        </div>
      </div>
      <ArrowRight className="mx-auto hidden h-6 w-6 text-dim lg:block" />
      <div className="space-y-3">
        <Node icon={Brain} t="Amazon Bedrock" d="foundation models · structured JSON" c="#b14dff" />
        <Node icon={Database} t="DynamoDB + S3" d="single-table events w/ TTL · specs" c="#22d3a5" />
        <Node icon={Timer} t="CloudWatch" d="EMF metrics, dashboard, alarms, X-Ray" c="#22d3a5" />
      </div>
    </div>
  );
}
