import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Brain, ClipboardPaste, FileUp, Globe, Sparkles, Store, Wand2 } from "lucide-react";
import { clsx } from "clsx";
import { Nav } from "../components/Nav";
import { Button, Card } from "../components/ui";
import { api } from "../lib/api";

type Mode = "sample" | "paste" | "upload" | "url";

export default function NewProject() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("sample");
  const [samples, setSamples] = useState<{ id: string; name: string; description: string }[]>([]);
  const [sampleId, setSampleId] = useState("acme-store");
  const [spec, setSpec] = useState("");
  const [specUrl, setSpecUrl] = useState("");
  const [name, setName] = useState("");
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [stage, setStage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.samples().then((r) => setSamples(r.samples)).catch(() => undefined);
  }, []);

  async function create() {
    setErr(undefined);
    setBusy(true);
    setStage(1);
    const t = setInterval(() => setStage((s) => Math.min(3, s + 1)), 700);
    try {
      const body: any = { name: name || undefined, upstreamUrl: upstreamUrl || undefined };
      if (mode === "sample") body.sampleId = sampleId;
      else if (mode === "url") body.specUrl = specUrl;
      else body.spec = spec;
      const r = await api.createProject(body);
      nav(`/app/p/${r.project.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      clearInterval(t);
      setBusy(false);
      setStage(0);
    }
  }

  const tabs: { k: Mode; label: string; icon: any }[] = [
    { k: "sample", label: "Sample APIs", icon: Store },
    { k: "paste", label: "Paste spec", icon: ClipboardPaste },
    { k: "upload", label: "Upload file", icon: FileUp },
    { k: "url", label: "From URL", icon: Globe },
  ];

  return (
    <div className="min-h-screen grid-bg">
      <Nav app />
      <main className="mx-auto max-w-4xl px-5 py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-raised/60 px-3 py-1 text-xs text-muted">
            <Sparkles className="h-3.5 w-3.5 text-chaos-orange" /> Step 1 of 3
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Give us your API. We'll find the ways it breaks.</h1>
          <p className="mt-2 text-muted">OpenAPI 3.x or Swagger 2.0, JSON or YAML. Generative AI on Amazon Bedrock reads the semantics and builds the chaos matrix.</p>
        </motion.div>

        <Card className="mt-8 p-2">
          <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
            {tabs.map((t) => (
              <button key={t.k} onClick={() => setMode(t.k)} className={clsx("flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm transition cursor-pointer", mode === t.k ? "bg-raised text-fg shadow-inner" : "text-muted hover:text-fg")}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {mode === "sample" && (
              <div className="grid gap-3 md:grid-cols-3">
                {samples.map((s) => (
                  <button key={s.id} onClick={() => setSampleId(s.id)} className={clsx("rounded-xl border p-4 text-left transition cursor-pointer", sampleId === s.id ? "chaos-border" : "border-line bg-raised/40 hover:border-white/20")}>
                    <div className="font-semibold">{s.name}</div>
                    <div className="mt-1 text-xs text-muted">{s.description}</div>
                    {s.id === "acme-store" && <div className="mt-3 inline-block rounded-md bg-mint/15 px-2 py-0.5 text-[11px] text-mint">Recommended · powers the Playground</div>}
                  </button>
                ))}
              </div>
            )}
            {mode === "paste" && (
              <div>
                <textarea value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={"openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\npaths:\n  /users:\n    get: ..."} className="scrollbar-thin h-80 w-full resize-y rounded-xl border border-line bg-[#0a0a12] p-4 font-mono text-xs text-[#d7d7e6] outline-none focus:border-chaos-orange/60" />
                <button className="mt-2 text-xs text-chaos-orange hover:underline cursor-pointer" onClick={async () => setSpec((await api.sample("acme-store")).spec)}>
                  Insert example spec
                </button>
              </div>
            )}
            {mode === "upload" && (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) setSpec(await f.text());
                }}
                className="flex h-56 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-[#0a0a12] text-center hover:border-chaos-orange/60"
              >
                <FileUp className="h-8 w-8 text-dim" />
                <div className="mt-3 text-sm">{spec ? `Loaded ${spec.length.toLocaleString()} characters ✓` : "Drop openapi.json / openapi.yaml here or click to browse"}</div>
                <input ref={fileRef} type="file" accept=".json,.yaml,.yml" className="hidden" onChange={async (e) => e.target.files?.[0] && setSpec(await e.target.files[0].text())} />
              </div>
            )}
            {mode === "url" && (
              <div>
                <input value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" className="w-full rounded-xl border border-line bg-[#0a0a12] px-4 py-3 font-mono text-sm outline-none focus:border-chaos-orange/60" />
                <p className="mt-2 text-xs text-dim">The spec URL must be publicly reachable.</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="mt-4 grid gap-4 p-5 md:grid-cols-2">
          <label className="block">
            <span className="text-xs text-dim">Project name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Checkout service" className="mt-1 w-full rounded-xl border border-line bg-[#0a0a12] px-3 py-2 text-sm outline-none focus:border-chaos-orange/60" />
          </label>
          <label className="block">
            <span className="text-xs text-dim">Upstream URL — proxy mode (optional)</span>
            <input value={upstreamUrl} onChange={(e) => setUpstreamUrl(e.target.value)} placeholder="https://api.mycompany.com (blank = spec-faithful mocks)" className="mt-1 w-full rounded-xl border border-line bg-[#0a0a12] px-3 py-2 font-mono text-sm outline-none focus:border-chaos-orange/60" />
          </label>
        </Card>

        {err && <div className="mt-4 rounded-xl border border-chaos-red/30 bg-chaos-red/10 p-3 text-sm text-chaos-red">{err}</div>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs text-muted">
            {["Parsing spec", "Mapping semantics", "Building chaos matrix"].map((s, i) => (
              <span key={s} className={clsx("flex items-center gap-2 transition", stage > i ? "text-fg" : "")}>
                <span className={clsx("h-2 w-2 rounded-full", stage > i ? "chaos-bg" : "bg-line")} /> {s}
              </span>
            ))}
          </div>
          <Button size="lg" loading={busy} onClick={create} disabled={(mode === "paste" || mode === "upload") && !spec.trim()} icon={<Wand2 className="h-5 w-5" />}>
            Generate chaos matrix
          </Button>
        </div>
        <div className="mt-10 flex items-start gap-3 rounded-xl border border-line bg-raised/40 p-4 text-sm text-muted">
          <Brain className="mt-0.5 h-5 w-5 shrink-0 text-chaos-violet" />
          A rules engine produces an instant baseline matrix; Amazon Bedrock then refines it asynchronously with domain-specific scenarios (you'll see it update live).
        </div>
      </main>
    </div>
  );
}
