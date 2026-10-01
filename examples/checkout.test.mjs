// Example integration test: a checkout flow run against $CHAOSLAB_URL by `chaoslab run`.
const BASE = process.env.CHAOSLAB_URL ?? "http://localhost:8787/x/demo";
const H = { "content-type": "application/json", "x-chaos-client": process.env.CHAOSLAB_CLIENT ?? "ci" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resilientFetch(path, init = {}, attempts = 4) {
  for (let a = 0; a < attempts; a++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(BASE + path, { ...init, headers: { ...H, ...(init.headers ?? {}) }, signal: ctrl.signal });
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get("retry-after"));
        await sleep(ra ? ra * 1000 : Math.random() * 200 * 2 ** a + 100);
        continue;
      }
      const text = await r.text();
      try { return { status: r.status, body: JSON.parse(text) }; } catch { await sleep(150 * 2 ** a); }
    } catch { await sleep(150 * 2 ** a); } finally { clearTimeout(t); }
  }
  return { status: 0, body: null };
}

let ok = 0;
for (let i = 0; i < 5; i++) {
  await resilientFetch("/products");
  const key = crypto.randomUUID();
  const pay = await resilientFetch("/payments", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ orderId: `ord_${i}`, amount: 19.99, currency: "USD", cardToken: "tok_test" }) });
  if (pay.status >= 200 && pay.status < 300) ok++;
}
console.log(`checkout flows succeeded: ${ok}/5`);
