import { useState } from "react";
import { Save } from "lucide-react";
import type { Ctx } from "../../pages/ProjectPage";
import { api } from "../../lib/api";
import { Button, Card, CodeBlock, CopyField } from "../ui";

export default function IntegrateTab({ ctx }: { ctx: Ctx }) {
  const { project, chaosUrl, endpoints, scenarios } = ctx;
  const [upstream, setUpstream] = useState(project.upstreamUrl ?? "");
  const [saving, setSaving] = useState(false);
  const ep = endpoints.find((e) => e.method === "POST") ?? endpoints[0];
  const sc = scenarios.find((s) => s.enabled) ?? scenarios[0];
  const origin = window.location.origin;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4 p-6 lg:col-span-2">
        <div className="text-lg font-semibold">1 · Swap your base URL</div>
        <p className="text-sm text-muted">Every path in your spec is served under your chaos URL. Healthy requests return spec-faithful mocks{project.upstreamUrl ? " proxied from your upstream" : ""}; armed scenarios inject faults at the configured intensity.</p>
        <CopyField value={chaosUrl} />
        <div className="grid gap-4 md:grid-cols-2">
          <CodeBlock lang="bash · healthy-or-chaos" code={`curl -i ${chaosUrl}${ep?.path.replace(/\{[^}]+\}/g, "123") ?? "/"} \\\n  -X ${ep?.method ?? "GET"} -H 'x-chaos-client: my-app' \\\n  -H 'content-type: application/json' -d '{}'`} />
          <CodeBlock lang="bash · force a specific failure" code={`# deterministic: force a fault type\ncurl -i ${chaosUrl}${ep?.path.replace(/\{[^}]+\}/g, "123") ?? "/"} -X ${ep?.method ?? "GET"} \\\n  -H 'x-chaos-fault: rate_limit_429'\n\n# or a scenario from the matrix\ncurl -i ... -H 'x-chaos-scenario: ${sc?.id ?? "scn_xxx"}'`} />
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <div className="text-lg font-semibold">Request headers</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {[
              ["x-chaos-client", "Name your client/app so its behavior is graded separately (e.g. web, ios, worker)."],
              ["x-chaos-fault", "Force a fault id (timeout, http_500, rate_limit_429, malformed_json, …) or 'none'."],
              ["x-chaos-scenario", "Force an exact matrix scenario by id."],
              ["idempotency-key", "Recorded per request — retries of POST/PATCH without a stable key are flagged CRITICAL."],
            ].map(([h, d]) => (
              <tr key={h}><td className="py-2 pr-3 align-top font-mono text-xs text-chaos-orange">{h}</td><td className="py-2 text-muted">{d}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="pt-2 text-sm font-semibold">Response headers</div>
        <p className="text-sm text-muted"><code className="font-mono text-xs text-chaos-orange">x-chaos-fault</code>, <code className="font-mono text-xs text-chaos-orange">x-chaos-scenario</code>, <code className="font-mono text-xs text-chaos-orange">x-chaos-event</code> tell your tests exactly what was injected.</p>
      </Card>

      <Card className="space-y-3 p-6">
        <div className="text-lg font-semibold">Outcome beacon (optional)</div>
        <p className="text-sm text-muted">The server can see retries and timing, but not whether your UI survived a corrupted 200. Report it and silent faults get verified too.</p>
        <CodeBlock lang="typescript" code={`await fetch("${chaosUrl}/__chaos/outcome", {
  method: "POST",
  headers: { "content-type": "application/json", "x-chaos-client": "web" },
  body: JSON.stringify({
    endpointKey: "GET /products",
    fault: res.headers.get("x-chaos-fault"),
    handled: true,              // false if the UI crashed
    fallback: "cached catalog", // what the user saw instead
  }),
});`} />
      </Card>

      <Card className="space-y-3 p-6">
        <div className="text-lg font-semibold">CI gate — CLI</div>
        <CodeBlock lang="bash" code={`# runs your tests against the chaos URL, then fails the build
# if the resilience score is below the threshold
npx chaoslab run \\
  --api ${origin} \\
  --project ${project.id} \\
  --intensity 0.5 --min-score 80 \\
  -- npm test      # your tests read $CHAOSLAB_URL as the API base`} />
      </Card>

      <Card className="space-y-3 p-6">
        <div className="text-lg font-semibold">GitHub Actions</div>
        <CodeBlock lang="yaml" code={`- name: Chaos test API integration
  run: npx chaoslab run --api ${origin} --project ${project.id} --min-score 80 -- npm test
  env:
    API_BASE_URL: \${{ env.CHAOSLAB_URL }}`} />
      </Card>

      <Card className="space-y-3 p-6 lg:col-span-2">
        <div className="text-lg font-semibold">Proxy mode</div>
        <p className="text-sm text-muted">Point ChaosLab at a real upstream. Healthy requests are forwarded (headers + body) and responses are mutated by the armed scenarios — test against production-shaped data without touching your backend.</p>
        <div className="flex flex-col gap-2 md:flex-row">
          <input value={upstream} onChange={(e) => setUpstream(e.target.value)} placeholder="https://api.example.com (blank = mock mode)" className="flex-1 rounded-xl border border-line bg-[#0a0a12] px-3 py-2 font-mono text-sm outline-none focus:border-chaos-orange/60" />
          <Button loading={saving} icon={<Save className="h-4 w-4" />} onClick={async () => { setSaving(true); await api.patchProject(project.id, { upstreamUrl: upstream || null }); await ctx.reload(); setSaving(false); }}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
