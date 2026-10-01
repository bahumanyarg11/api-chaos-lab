// Traffic generator: a naive client and a resilient client hit the chaos endpoint.
const BASE = process.argv[2] ?? "http://localhost:8787";
const PID = process.argv[3];
if (!PID) throw new Error("usage: tsx test/simulate.ts <base> <projectId>");
const X = `${BASE}/x/${PID}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function naive(i: number) {
  const h = { "content-type": "application/json", "x-chaos-client": "naive-app" };
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(`${X}/payments`, { method: "POST", headers: h, body: JSON.stringify({ orderId: `ord_${i}`, amount: 49.99, currency: "USD", cardToken: "tok_visa" }), signal: AbortSignal.timeout(20000) });
      if (r.ok) { await r.json(); break; }
    } catch {}
  }
  try { const r = await fetch(`${X}/products`, { headers: h }); await r.json(); } catch {}
}

async function resilient(i: number) {
  const key = crypto.randomUUID();
  const h = { "content-type": "application/json", "x-chaos-client": "resilient-app", "idempotency-key": key };
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`${X}/payments`, { method: "POST", headers: h, body: JSON.stringify({ orderId: `ord_${i}`, amount: 49.99, currency: "USD", cardToken: "tok_visa" }), signal: AbortSignal.timeout(3000) });
      if (r.ok) break;
      if (r.status < 500 && r.status !== 429) break;
      const ra = Number(r.headers.get("retry-after"));
      await sleep(ra ? ra * 1000 : 150 * 2 ** a + Math.random() * 100);
    } catch { await sleep(150 * 2 ** a); }
  }
}

await Promise.all([...Array(6)].map((_, i) => naive(i)));
await Promise.all([...Array(6)].map((_, i) => resilient(i)));
const a = await (await fetch(`${BASE}/api/projects/${PID}/analysis`)).json();
for (const c of a.analysis.clients) {
  console.log(`${c.clientId}: score ${c.score} ${c.grade} req=${c.requests} faults=${c.faultsSeen} retries=${c.retries}`);
  for (const f of c.findings.slice(0, 6)) console.log(`   - [${f.severity}] ${f.title} @ ${f.endpointKey} x${f.count}`);
  for (const s of c.strengths.slice(0, 6)) console.log(`   + ${s.title} @ ${s.endpointKey}`);
}
console.log("totals", a.analysis.totals, "coverage", a.analysis.coverage.exercised, "/", a.analysis.coverage.enabled);
export {};
