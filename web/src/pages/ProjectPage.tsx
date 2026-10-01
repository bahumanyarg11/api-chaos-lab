import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { Activity, Bot, FlaskConical, Gamepad2, Grid3x3, Plug, ShieldCheck } from "lucide-react";
import { Nav } from "../components/Nav";
import { Badge, CopyField, Spinner, Toggle } from "../components/ui";
import { api, chaosBase, modelLabel, type Endpoint, type Fault, type Project, type Scenario } from "../lib/api";
import MatrixTab from "../components/tabs/MatrixTab";
import LiveTab from "../components/tabs/LiveTab";
import PlaygroundTab from "../components/tabs/PlaygroundTab";
import ReportTab from "../components/tabs/ReportTab";
import IntegrateTab from "../components/tabs/IntegrateTab";

export interface Ctx {
  project: Project;
  endpoints: Endpoint[];
  scenarios: Scenario[];
  faults: Record<string, Fault>;
  chaosUrl: string;
  reload: () => Promise<void>;
  setScenarios: React.Dispatch<React.SetStateAction<Scenario[]>>;
  setProject: React.Dispatch<React.SetStateAction<Project | undefined>>;
}

const TABS = [
  { k: "matrix", label: "Chaos matrix", icon: Grid3x3 },
  { k: "live", label: "Live traffic", icon: Activity },
  { k: "playground", label: "Playground", icon: Gamepad2 },
  { k: "report", label: "Resilience report", icon: ShieldCheck },
  { k: "integrate", label: "Integrate", icon: Plug },
];

export default function ProjectPage() {
  const { id = "", tab = "matrix" } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<Project>();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [faults, setFaults] = useState<Record<string, Fault>>({});
  const [err, setErr] = useState<string>();

  const reload = useCallback(async () => {
    const r = await api.project(id);
    setProject(r.project);
    setEndpoints(r.endpoints);
    setScenarios(r.scenarios);
  }, [id]);

  useEffect(() => {
    reload().catch((e) => setErr(e.message));
    api.faults().then((r) => setFaults(Object.fromEntries(r.faults.map((f) => [f.id, f])))).catch(() => undefined);
  }, [reload]);

  // Poll while Bedrock is refining the matrix.
  useEffect(() => {
    if (!project || !["pending", "running"].includes(project.ai.status)) return;
    const t = setInterval(() => reload().catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [project?.ai.status, reload]);

  const chaosUrl = useMemo(() => (project ? chaosBase(project) : ""), [project]);

  if (err)
    return (
      <div className="min-h-screen">
        <Nav app />
        <div className="mx-auto max-w-3xl px-5 py-20 text-center">
          <div className="text-xl font-semibold">Project not found</div>
          <div className="mt-2 text-muted">{err}</div>
          <Link to="/app" className="mt-6 inline-block text-chaos-orange">← Back to projects</Link>
        </div>
      </div>
    );
  if (!project)
    return (
      <div className="min-h-screen">
        <Nav app />
        <div className="flex items-center justify-center gap-2 py-32 text-muted"><Spinner /> Loading project…</div>
      </div>
    );

  const ctx: Ctx = { project, endpoints, scenarios, faults, chaosUrl, reload, setScenarios, setProject };
  const enabled = scenarios.filter((s) => s.enabled).length;
  const aiBusy = ["pending", "running"].includes(project.ai.status);

  async function patchChaos(patch: Partial<Project["chaos"]>) {
    const next = { ...project!.chaos, ...patch };
    setProject({ ...project!, chaos: next });
    await api.patchProject(project!.id, { chaos: next });
  }

  return (
    <div className="min-h-screen">
      <Nav app />
      <div className="border-b border-line/70 bg-panel/40">
        <div className="mx-auto max-w-7xl px-5 pt-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-dim">
                <Link to="/app" className="hover:text-fg">Projects</Link> <span>/</span> <span className="font-mono">{project.id}</span>
              </div>
              <h1 className="mt-1 truncate text-3xl font-bold tracking-tight">{project.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge>{project.title} v{project.version}</Badge>
                <Badge color="#4da3ff">{endpoints.length} endpoints</Badge>
                <Badge color="#ff8a00">{enabled}/{scenarios.length} scenarios armed</Badge>
                {project.upstreamUrl ? <Badge color="#22d3a5">proxy → {project.upstreamUrl}</Badge> : <Badge color="#22d3a5">mock mode</Badge>}
                {aiBusy ? (
                  <Badge color="#b14dff"><Spinner className="h-3 w-3" /> Bedrock is refining the matrix…</Badge>
                ) : (
                  <Badge color="#b14dff"><Bot className="h-3 w-3" /> {project.ai.model ? modelLabel(project.ai.model) : project.ai.status}</Badge>
                )}
              </div>
            </div>
            <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-raised/40 p-4">
              <div className="flex items-center justify-between">
                <Toggle on={project.chaos.armed} onChange={(v) => patchChaos({ armed: v })} label={project.chaos.armed ? "Chaos armed" : "Chaos disarmed (healthy mocks)"} />
                <div className="flex items-center gap-2 text-xs text-muted">
                  <FlaskConical className="h-3.5 w-3.5" /> intensity
                  <input type="range" min={0} max={100} value={Math.round(project.chaos.intensity * 100)} onChange={(e) => setProject({ ...project, chaos: { ...project.chaos, intensity: Number(e.target.value) / 100 } })} onMouseUp={(e) => patchChaos({ intensity: Number((e.target as HTMLInputElement).value) / 100 })} onTouchEnd={(e) => patchChaos({ intensity: Number((e.target as HTMLInputElement).value) / 100 })} className="w-28 accent-[#ff8a00]" />
                  <span className="w-9 text-right font-mono text-fg">{Math.round(project.chaos.intensity * 100)}%</span>
                </div>
              </div>
              <CopyField value={chaosUrl} />
            </div>
          </div>
          <div className="scrollbar-thin mt-6 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => nav(`/app/p/${project.id}/${t.k}`)} className={clsx("flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition cursor-pointer", tab === t.k ? "border-chaos-orange text-fg" : "border-transparent text-muted hover:text-fg")}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-5 py-8">
        {tab === "matrix" && <MatrixTab ctx={ctx} />}
        {tab === "live" && <LiveTab ctx={ctx} />}
        {tab === "playground" && <PlaygroundTab ctx={ctx} />}
        {tab === "report" && <ReportTab ctx={ctx} />}
        {tab === "integrate" && <IntegrateTab ctx={ctx} />}
      </main>
    </div>
  );
}
