import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeHealth, workerStatus } from "../src/status.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe("sanitized operator worker health", () => {
  it("reports no worker and no jobs without claiming availability", () => {
    const health = summarizeHealth([], [], 100_000);
    expect(health.worker.online).toBe(false); expect(health.worker.heartbeatAgeSeconds).toBeNull();
    expect(health.jobs.oldestSampledPendingAgeSeconds).toBeNull(); expect(health.jobs.counts.completed).toBe(0);
  });
  it("uses the latest heartbeat, scopes aggregate counts, and omits every record payload and credential", () => {
    const health = summarizeHealth([{ lastHeartbeatAt: 1, modelId: "old" }, { lastHeartbeatAt: 95_000, modelId: "fixture-model", lastError: "WORKER_ERROR", workerToken: "fixture-private" }], [
      { status: "queued", _creationTime: 20_000, leaseToken: "fixture-private", result: "private message" },
      { status: "claimed", _creationTime: 80_000 }, { status: "completed", _creationTime: 1 },
    ], 100_000);
    expect(health.worker).toEqual({ online: true, heartbeatAgeSeconds: 5, model: "fixture-model", errorCategory: "WORKER_ERROR" });
    expect(health.jobs.oldestSampledPendingAgeSeconds).toBe(80); expect(health.jobs.counts).toEqual({ queued: 1, claimed: 1, completed: 1, failed: 0, expired: 0 });
    expect(JSON.stringify(health)).not.toMatch(/fixture-private|private message|leaseToken|workerToken/);
  });
  it("marks old heartbeats offline and normalizes unexpected error strings", () => {
    expect(summarizeHealth([{ lastHeartbeatAt: 1, lastError: "private error details", modelId: "private phone +1555" }], [], 100_000).worker).toEqual({ online: false, heartbeatAgeSeconds: 100, model: null, errorCategory: "WORKER_ERROR" });
  });
  it("labels samples at the bound as possibly truncated", () => {
    expect(summarizeHealth([], Array.from({ length: 1000 }, () => ({ status: "completed" })), 100_000).possiblyTruncated).toBe(true);
  });
  it("handles the verified CLI's empty-table output and binds each read to the selected dev deployment", async () => {
    const root = await mkdtemp(join(tmpdir(), "rally-health-test-")); dirs.push(root);
    await writeFile(join(root, ".env.local"), "CONVEX_DEPLOYMENT=dev:fixture-dev\nCONVEX_URL=https://fixture-dev.convex.cloud\n");
    const health = await workerStatus(root, args => { expect(args[0]).toBe("data"); expect(args.slice(-2)).toEqual(["--deployment", "fixture-dev"]); return { status: 0, stdout: "" }; }, 100_000);
    expect(health.deployment).toBe("fixture-dev"); expect(health.worker.online).toBe(false);
    await expect(workerStatus(root, () => ({ status: 1, stdout: "private provider failure" }))).rejects.toThrow("HEALTH_READ_FAILED");
  });
});
