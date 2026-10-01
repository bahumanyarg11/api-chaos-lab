import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { api, modelLabel, waitJob, type AiExplain as T } from "../lib/api";
import { Badge, Button, CodeBlock, Spinner } from "./ui";

export function AiExplain({ projectId, input, label = "Explain & fix with AI" }: { projectId: string; input: Record<string, unknown>; label?: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [res, setRes] = useState<T>();
  const [model, setModel] = useState<string>();
  const [lang, setLang] = useState("typescript");
  const [err, setErr] = useState<string>();

  async function run() {
    setState("running");
    setErr(undefined);
    try {
      const { jobId } = await api.explain(projectId, { ...input, language: lang });
      const { result, model } = await waitJob<T>(jobId);
      setRes(result);
      setModel(model);
      setState("done");
    } catch (e: any) {
      setErr(e.message);
      setState("error");
    }
  }

  if (state === "idle" || state === "error")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} icon={<Sparkles className="h-3.5 w-3.5 text-chaos-violet" />}>{label}</Button>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs text-muted outline-none">
          {["typescript", "python", "go", "java"].map((l) => <option key={l}>{l}</option>)}
        </select>
        {err && <span className="text-xs text-chaos-red">{err}</span>}
      </div>
    );
  if (state === "running")
    return (
      <div className="flex items-center gap-2 rounded-xl border border-chaos-violet/30 bg-chaos-violet/10 px-3 py-2.5 text-sm text-[#d9b8ff]">
        <Spinner /> Asking Amazon Bedrock…
      </div>
    );
  return (
    <div className="space-y-3 rounded-xl border border-chaos-violet/30 bg-chaos-violet/[0.06] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-chaos-violet" /> {res!.headline}</div>
        <Badge color="#b14dff">{modelLabel(model)}</Badge>
      </div>
      <p className="text-sm text-muted">{res!.whatHappened}</p>
      <div className="rounded-lg border border-chaos-red/20 bg-chaos-red/[0.06] p-3 text-sm text-[#ffc2cb]"><span className="font-semibold text-chaos-red">User impact: </span>{res!.userImpact}</div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        {res!.howToHandle.map((h, i) => <li key={i}>{h}</li>)}
      </ol>
      <CodeBlock code={res!.code.snippet} lang={res!.code.language} />
    </div>
  );
}
