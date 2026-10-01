// Records product demo clips with Playwright + system Chrome.
//   node record.mjs <baseUrl> [outDir] [only=01,03]
// Produces 01-landing.mp4 … 07-integrate.mp4 (1600x1000, h264) for the Remotion video.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const OUT = path.resolve(process.argv[3] ?? "../video/public/rec");
const ONLY = (process.argv.find((a) => a.startsWith("only=")) ?? "").slice(5).split(",").filter(Boolean);
const W = 1600, H = 1000;
const TMP = path.resolve("./.rec-tmp");
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const CURSOR = `
(() => {
  if (window.__cursor) return; window.__cursor = 1;
  const add = () => {
    const c = document.createElement('div');
    c.id='__cur';
    c.style.cssText='position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .08s;';
    c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#07070b" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const ring = document.createElement('div');
    ring.style.cssText='position:fixed;z-index:2147483646;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid #ff8a00;opacity:0;pointer-events:none;transition:opacity .3s, transform .3s;';
    document.body.appendChild(ring);
    addEventListener('mousemove', e => { c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }, true);
    addEventListener('mousedown', e => { ring.style.left=e.clientX+'px'; ring.style.top=e.clientY+'px'; ring.style.opacity='1'; ring.style.transform='scale(0.6)'; setTimeout(()=>{ring.style.opacity='0'; ring.style.transform='scale(1.4)';},180); }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clip(browser, name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: TMP, size: { width: W, height: H } }, colorScheme: "dark" });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  page.mouse.__x = W / 2; page.mouse.__y = H / 2;
  const t0 = Date.now();
  try {
    await fn(page);
  } catch (e) {
    console.error(`[${name}] error:`, e.message);
  }
  const dur = (Date.now() - t0) / 1000;
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  const mp4 = path.join(OUT, `${name}.mp4`);
  // trim the blank first ~0.4s; encode h264
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.4", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-an", mp4]);
  console.log(`✓ ${name}.mp4 (${dur.toFixed(1)}s)`);
}

async function move(page, x, y, steps = 25) {
  await page.mouse.move(x, y, { steps });
}
async function clickEl(page, locator, opts = {}) {
  const el = typeof locator === "string" ? page.locator(locator).first() : locator;
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw new Error("no bbox");
  await move(page, b.x + b.width / 2, b.y + b.height / 2, opts.steps ?? 22);
  await sleep(opts.pause ?? 250);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
async function smoothScroll(page, total, ms = 4000) {
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, total / steps);
    await sleep(16);
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-dark-mode"] });

// Shared project (created once so later clips are consistent)
let projectId = process.env.PROJECT_ID;
async function ensureProject() {
  if (projectId) return projectId;
  const r = await fetch(`${BASE}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId: "acme-store", name: "Acme Checkout" }) });
  projectId = (await r.json()).project.id;
  // wait for AI matrix
  for (let i = 0; i < 60; i++) {
    const p = await (await fetch(`${BASE}/api/projects/${projectId}`)).json();
    if (!["pending", "running"].includes(p.project.ai.status)) break;
    await sleep(2000);
  }
  return projectId;
}

await clip(browser, "01-landing", async (page) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await move(page, 700, 520, 10);
  await sleep(2500);
  await smoothScroll(page, 900, 2600);
  await sleep(900);
  await smoothScroll(page, 1400, 3000);
  await sleep(1200);
  await smoothScroll(page, 1100, 2400);
  await sleep(1200);
});

await clip(browser, "02-upload", async (page) => {
  await page.goto(BASE + "/app/new", { waitUntil: "networkidle" });
  await sleep(800);
  await clickEl(page, page.getByRole("button", { name: /Paste spec/ }));
  await sleep(400);
  await clickEl(page, page.getByText("Insert example spec"));
  await sleep(1400);
  await clickEl(page, page.getByRole("button", { name: /Sample APIs/ }));
  await sleep(500);
  await clickEl(page, page.getByText("Acme Store & Payments", { exact: true }));
  await sleep(500);
  await clickEl(page, "input[placeholder='Checkout service']");
  await page.keyboard.type("Acme Checkout", { delay: 60 });
  await sleep(300);
  await clickEl(page, page.getByRole("button", { name: /Generate chaos matrix/ }));
  await page.waitForURL(/\/app\/p\//, { timeout: 30000 });
  projectId = page.url().split("/app/p/")[1].split("/")[0];
  await sleep(2500);
  // let AI refine while we watch
  for (let i = 0; i < 12; i++) {
    const txt = await page.locator("text=refining the matrix").count();
    if (!txt) break;
    await sleep(1500);
  }
  await sleep(1500);
});

await clip(browser, "03-matrix", async (page) => {
  const id = await ensureProject();
  await page.goto(`${BASE}/app/p/${id}/matrix`, { waitUntil: "networkidle" });
  await sleep(1200);
  const cells = page.locator("table button");
  const n = await cells.count();
  const picks = [Math.min(n - 1, Math.floor(n * 0.55)), Math.min(n - 1, Math.floor(n * 0.62)), Math.min(n - 1, Math.floor(n * 0.7))];
  // find a POST /payments cell if present
  const rows = page.locator("table tbody tr");
  const rc = await rows.count();
  let payRow = -1;
  for (let i = 0; i < rc; i++) if ((await rows.nth(i).innerText()).includes("/payments")) payRow = i;
  if (payRow >= 0) {
    const btns = rows.nth(payRow).locator("button");
    await clickEl(page, btns.nth(1));
    await sleep(1600);
    await clickEl(page, btns.nth(Math.min(3, (await btns.count()) - 1)));
    await sleep(1600);
  } else {
    for (const p of picks) {
      await clickEl(page, cells.nth(p));
      await sleep(1400);
    }
  }
  await clickEl(page, page.getByRole("button", { name: /Fire once/ }));
  await sleep(2200);
  await clickEl(page, page.getByRole("button", { name: /Explain & fix with AI/ }).first());
  for (let i = 0; i < 40; i++) {
    if (await page.locator("text=User impact").count()) break;
    await sleep(800);
  }
  await sleep(800);
  await move(page, 1350, 600);
  await smoothScroll(page, 700, 2500);
  await sleep(1500);
});

await clip(browser, "04-live", async (page) => {
  const id = await ensureProject();
  await page.goto(`${BASE}/app/p/${id}/live`, { waitUntil: "networkidle" });
  await sleep(800);
  await clickEl(page, page.getByRole("button", { name: /Send 16 test requests/ }));
  await sleep(3500);
  await clickEl(page, page.getByRole("button", { name: /Send 16 test requests/ }));
  await sleep(4000);
  const rows = page.locator("main button.grid");
  if (await rows.count()) {
    await clickEl(page, rows.nth(1));
    await sleep(2000);
  }
  await smoothScroll(page, 500, 1500);
  await sleep(1500);
});

await clip(browser, "05-playground", async (page) => {
  const id = await ensureProject();
  await page.goto(`${BASE}/app/p/${id}/playground`, { waitUntil: "networkidle" });
  await sleep(1000);
  await clickEl(page, page.getByRole("button", { name: /Arm demo chaos/ }));
  await sleep(1800);
  await clickEl(page, page.getByRole("button", { name: /Run experiment/ }));
  await move(page, 800, 700, 30);
  await sleep(1500);
  await smoothScroll(page, 330, 1200);
  for (let i = 0; i < 90; i++) {
    if (await page.getByText("Open full AI resilience report").count()) break;
    await sleep(700);
  }
  await sleep(1200);
  await smoothScroll(page, 400, 1500);
  await sleep(2000);
  const href = page.url();
  fs.writeFileSync(path.join(TMP, "last-run.txt"), href);
});

await clip(browser, "06-report", async (page) => {
  const id = await ensureProject();
  const runs = await (await fetch(`${BASE}/api/projects/${id}/runs`)).json();
  const run = runs.runs.find((r) => r.label.startsWith("Playground")) ?? runs.runs[0];
  // wait for Bedrock narrative so the clip shows it
  for (let i = 0; i < 60 && run; i++) {
    const r = await (await fetch(`${BASE}/api/projects/${id}/runs/${run.id}`)).json();
    if (r.run.ai?.narrative) break;
    await sleep(2000);
  }
  await page.goto(`${BASE}/app/p/${id}/report${run ? `?run=${run.id}` : ""}`, { waitUntil: "networkidle" });
  await sleep(2500);
  await move(page, 900, 600);
  await smoothScroll(page, 600, 2200);
  await sleep(1500);
  await smoothScroll(page, 700, 2400);
  await sleep(1200);
  const finding = page.locator("main button:has-text('CRITICAL'), main button:has-text('HIGH')").first();
  if (await finding.count()) {
    await clickEl(page, finding);
    await sleep(1500);
  }
  await smoothScroll(page, 500, 1800);
  await sleep(1500);
});

await clip(browser, "07-integrate", async (page) => {
  const id = await ensureProject();
  await page.goto(`${BASE}/app/p/${id}/integrate`, { waitUntil: "networkidle" });
  await sleep(1500);
  await move(page, 800, 500);
  await smoothScroll(page, 600, 2500);
  await sleep(1200);
  await smoothScroll(page, 600, 2500);
  await sleep(1500);
});

await browser.close();
console.log("project:", projectId);
