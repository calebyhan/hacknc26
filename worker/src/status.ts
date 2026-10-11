import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { reasoningJobStatuses, ReasoningJobStatusSchema } from "../../packages/shared/enums.ts";
import { convexCommand, developmentTarget, type ConvexCommand } from "./setup.ts";

const errorCategories = new Set(["INFERENCE_TIMEOUT", "INFERENCE_UNAVAILABLE", "INVALID_DECISION", "RATE_LIMIT", "BACKEND_UNAVAILABLE", "WORKER_ERROR"]);
const limit = 1000;
type Row = Record<string, unknown>;
function rows(text: string): Row[] {
  // Convex 1.46.0 prints empty stdout for an empty table, even with --format json.
  const value: unknown = text.trim() ? JSON.parse(text) : [];
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("HEALTH_READ_FAILED");
  return value as Row[];
}
export function summarizeHealth(heartbeats: Row[], jobs: Row[], now = Date.now()) {
  const latest = heartbeats.filter(row => typeof row.lastHeartbeatAt === "number" && Number.isFinite(row.lastHeartbeatAt)).sort((a, b) => Number(b.lastHeartbeatAt) - Number(a.lastHeartbeatAt))[0];
  const ageMs = latest ? Math.max(0, now - Number(latest.lastHeartbeatAt)) : null;
  const counts = Object.fromEntries(reasoningJobStatuses.map(status => [status, 0])) as Record<(typeof reasoningJobStatuses)[number], number>;
  let oldestPendingAgeMs: number | null = null;
  for (const job of jobs) {
    const status = ReasoningJobStatusSchema.parse(job.status); counts[status]++;
    if (["queued", "claimed"].includes(status) && typeof job._creationTime === "number" && Number.isFinite(job._creationTime)) oldestPendingAgeMs = Math.max(oldestPendingAgeMs ?? 0, now - job._creationTime);
  }
  return {
    worker: { online: ageMs !== null && ageMs < 90_000, heartbeatAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000), model: latest && typeof latest.modelId === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(latest.modelId) ? latest.modelId : null, errorCategory: latest?.lastError ? errorCategories.has(String(latest.lastError)) ? latest.lastError : "WORKER_ERROR" : null },
    jobs: { sampled: jobs.length, counts, oldestSampledPendingAgeSeconds: oldestPendingAgeMs === null ? null : Math.round(oldestPendingAgeMs / 1000) },
    sampleLimit: limit, possiblyTruncated: jobs.length >= limit || heartbeats.length >= limit,
  };
}
/** Admin-authenticated CLI reads only; no model/provider call or DB mutation. */
export async function workerStatus(root: string, run: ConvexCommand, now = Date.now()) {
  const deployment = developmentTarget(parseEnv(await readFile(join(root, ".env.local"), "utf8")));
  const samples: Row[][] = [];
  for (const table of ["workerHeartbeats", "reasoningJobs"]) {
    const result = await run(["data", table, "--limit", String(limit), "--format", "json", "--deployment", deployment]);
    if (result.status !== 0) throw new Error("HEALTH_READ_FAILED");
    samples.push(rows(result.stdout));
  }
  return { deployment, checkedAt: new Date(now).toISOString(), ...summarizeHealth(samples[0]!, samples[1]!, now) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try { console.info(JSON.stringify(await workerStatus(root, convexCommand(root)), null, 2)); }
  catch { console.error("Worker status unavailable. Verify development selection and Convex login. No private records were logged."); process.exitCode = 1; }
}
