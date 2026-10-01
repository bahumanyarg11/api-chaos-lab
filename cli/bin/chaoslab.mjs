#!/usr/bin/env node
// API Chaos Lab CLI (zero dependencies).
//   chaoslab create  --api <base> --spec openapi.yaml [--name n]
//   chaoslab run     --api <base> --project <id> [--intensity 0.5] [--min-score 80] [--label x] [--client ci] -- <test command...>
//   chaoslab report  --api <base> --project <id> [--run <runId>]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const dd = argv.indexOf("--");
const flagsArr = dd >= 0 ? argv.slice(1, dd) : argv.slice(1);
const rest = dd >= 0 ? argv.slice(dd + 1) : [];
const flags = {};
for (let i = 0; i < flagsArr.length; i++) if (flagsArr[i].startsWith("--")) flags[flagsArr[i].slice(2)] = flagsArr[i + 1]?.startsWith("--") || flagsArr[i + 1] === undefined ? "true" : flagsArr[++i];

const API = (flags.api ?? process.env.CHAOSLAB_API ?? "").replace(/\/$/, "");
const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, mag: (s) => `\x1b[35m${s}\x1b[0m` };
const die = (m) => { console.error(c.red(`✗ ${m}`)); process.exit(2); };
async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) die(`${method} ${path} → ${r.status} ${j.error ?? ""}`);
  return j;
}
const sev = { critical: c.red("CRITICAL"), high: c.yellow("HIGH    "), medium: c.yellow("MEDIUM  "), low: c.dim("LOW     ") };

function printAnalysis(a) {
  console.log(`\n${c.bold("Resilience report")}  ${a.totals.requests} requests · ${a.totals.faults} faults injected · ${a.totals.retries} retries · coverage ${a.coverage.exercised}/${a.coverage.enabled}`);
  for (const cl of a.clients) {
    const col = cl.score == null ? c.dim : cl.score >= 80 ? c.green : cl.score >= 50 ? c.yellow : c.red;
    console.log(`\n  ${c.bold(cl.clientId)}  ${col(`${cl.grade} · ${cl.score ?? "n/a"}/100`)}`);
    for (const f of cl.findings.slice(0, 8)) console.log(`    ${sev[f.severity]} ${f.title} ${c.dim(f.endpointKey)}`);
    for (const s of cl.strengths.slice(0, 4)) console.log(`    ${c.green("✓")} ${s.title} ${c.dim(s.endpointKey)}`);
  }
  const col = a.overall.score == null ? c.dim : a.overall.score >= 80 ? c.green : a.overall.score >= 50 ? c.yellow : c.red;
  console.log(`\n  Overall: ${col(c.bold(`${a.overall.grade} · ${a.overall.score ?? "n/a"}/100`))}\n`);
}

if (!cmd || cmd === "help" || flags.help) {
  console.log(`chaoslab — API Chaos Lab CLI\n\n  create --api <url> --spec <file> [--name <n>]\n  run    --api <url> --project <id> [--intensity 0.5] [--min-score 80] [--client ci] -- <cmd>\n  report --api <url> --project <id> [--run <id>]\n`);
  process.exit(0);
}
if (!API) die("--api <base url> (or CHAOSLAB_API) is required");

if (cmd === "create") {
  if (!flags.spec) die("--spec <file> required");
  const { project, scenarios } = await call("POST", "/api/projects", { spec: readFileSync(flags.spec, "utf8"), name: flags.name });
  console.log(`${c.green("✓")} Project ${c.bold(project.id)} — ${project.endpointCount} endpoints, ${scenarios.length} scenarios`);
  console.log(`  chaos URL: ${API}/x/${project.id}`);
} else if (cmd === "run") {
  if (!flags.project) die("--project <id> required");
  if (!rest.length) die("provide a test command after --, e.g. -- npm test");
  const min = Number(flags["min-score"] ?? 0);
  const { run } = await call("POST", `/api/projects/${flags.project}/runs`, { label: flags.label ?? `CLI: ${rest.join(" ")}`.slice(0, 80), intensity: flags.intensity ? Number(flags.intensity) : undefined, armed: true });
  const url = `${API}/x/${flags.project}`;
  console.log(`${c.mag("⚡ chaos run")} ${run.id} → ${url}`);
  await new Promise((r) => setTimeout(r, 1800));
  const code = await new Promise((resolve) => {
    const child = spawn(rest[0], rest.slice(1), { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, CHAOSLAB_URL: url, CHAOSLAB_CLIENT: flags.client ?? "ci" } });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const { run: done } = await call("POST", `/api/projects/${flags.project}/runs/${run.id}/stop`);
  printAnalysis(done.analysis);
  const score = done.analysis.overall.score;
  if (code !== 0) { console.log(c.red(`✗ test command exited with ${code}`)); process.exit(code); }
  if (min && (score == null || score < min)) { console.log(c.red(`✗ resilience score ${score ?? "n/a"} is below --min-score ${min}`)); process.exit(1); }
  console.log(c.green(`✓ passed${min ? ` (score ${score} ≥ ${min})` : ""}`));
} else if (cmd === "report") {
  if (!flags.project) die("--project <id> required");
  const a = flags.run ? (await call("GET", `/api/projects/${flags.project}/runs/${flags.run}`)).run.analysis : (await call("GET", `/api/projects/${flags.project}/analysis`)).analysis;
  printAnalysis(a);
} else die(`unknown command ${cmd}`);
