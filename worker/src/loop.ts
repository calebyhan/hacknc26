import { AgentDecisionSchema } from "../../packages/shared/agentDecision.ts";
import { ContextPacketSchema } from "../../packages/shared/contextPacket.ts";
import type { InferenceProvider } from "../../packages/shared/adapters.ts";

export interface WorkerJob { jobId: string; leaseToken: string; leaseUntil: number; packetJson: string }
export interface QueueBackend {
  claim(): Promise<WorkerJob | null>;
  complete(args: { jobId: string; leaseToken: string; decisionJson: string }): Promise<void>;
  heartbeat(lastError?: string): Promise<void>;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); resolve(); };
    const timer = setTimeout(stop, milliseconds);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

/** One claim, one bounded inference, one completion. Domain owns every effect. */
export async function processOneJob(backend: QueueBackend, provider: InferenceProvider): Promise<"idle" | "processed" | "error"> {
  let job: WorkerJob | null;
  try { job = await backend.claim(); }
  catch { return "error"; }
  if (!job) return "idle";
  let decisionJson: string;
  try {
    if (job.leaseUntil - Date.now() < 35_000 || job.packetJson.length > 65_536) throw new Error("INVALID_JOB");
    const packet = ContextPacketSchema.parse(JSON.parse(job.packetJson));
    decisionJson = JSON.stringify(AgentDecisionSchema.parse(await provider.decide(packet)));
  } catch {
    // Frozen complete contract has no error payload: invalid JSON records a
    // terminal INVALID_DECISION with one trusted fallback, never a fabricated action.
    try { await backend.complete({ jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: "{}" }); } catch { /* Lease watchdog remains authoritative. */ }
    return "error";
  }
  try { await backend.complete({ jobId: job.jobId, leaseToken: job.leaseToken, decisionJson }); return "processed"; }
  catch { return "error"; }
}

export async function runWorker(backend: QueueBackend, provider: InferenceProvider, options: { signal: AbortSignal; report?: (category: string) => void }): Promise<void> {
  let heartbeatAt = 0;
  while (!options.signal.aborted) {
    if (Date.now() >= heartbeatAt) {
      try { await backend.heartbeat(); } catch { options.report?.("BACKEND_UNAVAILABLE"); }
      heartbeatAt = Date.now() + 30_000;
    }
    const result = await processOneJob(backend, provider);
    if (result === "error") { options.report?.("WORKER_ERROR"); try { await backend.heartbeat("WORKER_ERROR"); } catch { /* No secret/error payload is logged. */ } }
    // Interactive demo worker: keep idle pickup within two seconds plus network
    // latency. This costs at most 43,200 idle claims/day per worker; stop it when
    // unused. Backend/inference errors still back off, and jobs stay sequential.
    const wait = result === "processed" ? 1_000 : result === "error" ? 30_000 : 2_000;
    await pause(wait, options.signal);
  }
}
