# API Chaos Lab — brand & story brief

**Product:** API Chaos Lab (short: ChaosLab). AI-powered API resilience testing on AWS.
**Tagline:** "Break your APIs before your users do."
**Sub-tagline:** "Paste an OpenAPI spec. Get an AI-generated chaos matrix. Point your app at a chaos endpoint. Get a resilience score."

## Visual identity
- Background: near-black `#07070B`, surface `#0F0F17`, raised `#161622`, border `#25253A`
- Text: `#F4F4F8` primary, `#A1A1B5` muted
- Chaos gradient (hero accent): `#FF3D5A` (red) → `#FF8A00` (orange) → `#B14DFF` (violet)
- Status: success `#22D3A5` (mint), warning `#FFB020`, danger `#FF3D5A`, info `#4DA3FF`
- Fonts: "Inter" (UI, 400–800), "JetBrains Mono" (code, endpoints, numbers). Both on Google Fonts.
- Motif: a grid/matrix of endpoint × fault cells that "glitch" (RGB split, jitter) when chaos is injected; heartbeat/latency lines; terminal-style logs.
- Tone: confident, technical, a little playful ("controlled chaos").

## Fault catalog (shown in matrix)
latency, timeout, http_500, http_502_html (load-balancer HTML page), http_503 (Retry-After), rate_limit_429 (Retry-After), malformed_json, missing_fields, wrong_types, schema_drift, empty_body, intermittent (fail N then succeed), auth_401, conflict_409, payload_bloat

## Story (for the demo video, ~2–2.5 min)
1. Hook (0–10s): "Your app works... until the API doesn't." Glitching 500 / 429 / timeout cards.
2. Problem (10–25s): Manually faking timeouts, 429s, malformed JSON is tedious; most teams never test it; outages cost $$$ (e.g. "the average outage minute costs thousands"; retry storms; double charges on POST /payments).
3. Solution (25–40s): API Chaos Lab — paste OpenAPI → Amazon Bedrock understands API semantics → chaos matrix.
4. Demo (40–110s): screen recordings of the real app: upload spec → AI matrix → toggle faults → live traffic monitor → playground: naive client vs resilient client side by side → Resilience Report with score (naive F/30s vs resilient A/90s) + AI fix suggestions with code.
5. Under the hood (110–130s): AWS architecture: CloudFront + S3 → API Gateway → Lambda (control plane, chaos data plane, AI worker) → DynamoDB + S3 → Amazon Bedrock → CloudWatch metrics & dashboard. CI: `npx chaoslab run -- npm test` gate.
6. Close (130–150s): "Break your APIs before your users do." URL + logo.

## Key differentiator (say it loudly)
ChaosLab doesn't just inject faults — it **observes how your client behaves under failure from the server side**: retry storms, missing backoff, ignoring Retry-After, retrying non-idempotent POSTs without an Idempotency-Key (double-charge risk), no client timeout. Then Bedrock explains each finding and writes the fix.
