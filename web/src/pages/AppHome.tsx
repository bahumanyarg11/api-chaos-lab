import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderGit2, Plus, Zap } from "lucide-react";
import { Nav } from "../components/Nav";
import { Button, Card, Empty, Spinner } from "../components/ui";
import { api } from "../lib/api";

export default function AppHome() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="min-h-screen">
      <Nav app />
      <main className="mx-auto max-w-7xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Chaos projects</h1>
            <p className="mt-1 text-sm text-muted">Each project is one API under test, with its own chaos URL and resilience history.</p>
          </div>
          <Link to="/app/new">
            <Button icon={<Plus className="h-4 w-4" />}>New project</Button>
          </Link>
        </div>
        <div className="mt-8">
          {err && <div className="rounded-xl border border-chaos-red/30 bg-chaos-red/10 p-4 text-sm text-chaos-red">{err}</div>}
          {!projects && !err && (
            <div className="flex items-center gap-2 text-muted">
              <Spinner /> Loading…
            </div>
          )}
          {projects && projects.length === 0 && (
            <Empty icon={<Zap className="h-8 w-8" />} title="No projects yet">
              Upload an OpenAPI spec (or use a sample) to generate your first chaos matrix.
              <div className="mt-4">
                <Link to="/app/new">
                  <Button>Create your first project</Button>
                </Link>
              </div>
            </Empty>
          )}
          {projects && projects.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link key={p.id} to={`/app/p/${p.id}`}>
                  <Card className="h-full p-5 transition hover:border-white/20 hover:bg-raised/60">
                    <div className="flex items-center gap-2 text-xs text-dim">
                      <FolderGit2 className="h-4 w-4" /> <span className="font-mono">{p.id}</span>
                    </div>
                    <div className="mt-2 truncate text-lg font-semibold">{p.name}</div>
                    <div className="truncate text-sm text-muted">{p.title}</div>
                    <div className="mt-4 flex items-center justify-between text-xs text-dim">
                      <span>{p.endpointCount} endpoints</span>
                      <span>{new Date(p.createdAt).toLocaleString()}</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
