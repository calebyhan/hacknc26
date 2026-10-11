import { loadWorkerConfig, WorkerConfigError } from "./config.ts";
import { ConvexHttpClient } from "convex/browser";
import { randomUUID } from "node:crypto";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel";
import { createProvider } from "./provider.ts";
import { runWorker, type QueueBackend } from "./loop.ts";

try {
  const config = loadWorkerConfig(process.env);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const provider = createProvider(config.provider, config.model, controller.signal);
  await provider.checkReady();
  const client = new ConvexHttpClient(config.convexUrl, {
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }),
  });
  const credentials = { workerToken: config.workerToken, workerId: randomUUID() };
  const backend: QueueBackend = {
    claim: () => client.mutation(api.reasoningJobs.claim, credentials),
    complete: async (args) => { await client.mutation(api.reasoningJobs.complete, { ...credentials, ...args, jobId: args.jobId as Id<"reasoningJobs"> }); },
    heartbeat: async (lastError) => { await client.mutation(api.reasoningJobs.heartbeat, { ...credentials, modelId: config.model, ...(lastError ? { lastError } : {}) }); },
  };
  // Check server authentication before starting a long-running loop.
  await backend.heartbeat();
  console.info(`Rally ${config.provider} worker started. Single-job constrained inference.`);
  await runWorker(backend, provider, { signal: controller.signal, report: (category) => console.warn(category) });
} catch (error) {
  console.error(
    error instanceof WorkerConfigError
      ? error.message
      : "Worker initialization failed. Check provider login and server worker configuration. Values were not logged.",
  );
  process.exitCode = 1;
}
