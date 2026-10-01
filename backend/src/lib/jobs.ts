import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { Job } from "./types.js";

let lambda: LambdaClient | undefined;
let localRunner: ((payload: { jobId: string }) => Promise<void>) | undefined;
let keepAlive: ((p: Promise<unknown>) => void) | undefined;

/** In-process runner (local dev, Vercel). `keepAlive` extends the serverless invocation (e.g. Vercel waitUntil). */
export function setLocalJobRunner(fn: (payload: { jobId: string }) => Promise<void>, waitUntil?: (p: Promise<unknown>) => void) {
  localRunner = fn;
  keepAlive = waitUntil;
}

/** Fire-and-forget: async Lambda invoke on AWS, in-process elsewhere. */
export async function dispatch(job: Job) {
  const fn = process.env.WORKER_FN;
  if (fn) {
    lambda ??= new LambdaClient({});
    await lambda.send(new InvokeCommand({ FunctionName: fn, InvocationType: "Event", Payload: Buffer.from(JSON.stringify({ jobId: job.id })) }));
  } else if (localRunner) {
    const run = localRunner;
    const p = new Promise((r) => setTimeout(r, 5)).then(() => run({ jobId: job.id })).catch((e) => console.error("job failed", e));
    keepAlive?.(p);
  }
}
