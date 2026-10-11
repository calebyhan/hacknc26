import { describe, expect, it, vi } from "vitest";
import { FakeInferenceProvider } from "../../packages/shared/adapters";
import { exampleAgentDecision, exampleContextPacket } from "../../packages/shared/fixtures";
import { processOneJob, runWorker, type QueueBackend } from "../src/loop.ts";

function backend(): QueueBackend {
  return { claim: vi.fn(async () => ({ jobId: "fixture-job", leaseToken: "fixture-lease", leaseUntil: Date.now() + 45_000, packetJson: JSON.stringify(exampleContextPacket) })), complete: vi.fn(async () => {}), heartbeat: vi.fn(async () => {}) };
}
describe("single-job worker loop (simulation)", () => {
  it("sends only a validated decision back through the completion endpoint", async () => {
    const queue = backend();
    const provider = new FakeInferenceProvider({ [exampleContextPacket.incomingText]: exampleAgentDecision });
    expect(await processOneJob(queue, provider)).toBe("processed");
    expect(queue.complete).toHaveBeenCalledWith(expect.objectContaining({ jobId: "fixture-job", leaseToken: "fixture-lease", decisionJson: JSON.stringify(exampleAgentDecision) }));
    expect(provider.calls).toHaveLength(1);
  });
  it("does not invoke inference when idle", async () => {
    const queue = backend(); queue.claim = vi.fn(async () => null);
    const provider = new FakeInferenceProvider();
    expect(await processOneJob(queue, provider)).toBe("idle");
    expect(provider.calls).toHaveLength(0);
  });
  it("rejects a corrupt packet before model access and fails the leased job", async () => {
    const queue = backend(); queue.claim = vi.fn(async () => ({ jobId: "fixture-job", leaseToken: "fixture-lease", leaseUntil: Date.now() + 45_000, packetJson: "{}" }));
    const provider = new FakeInferenceProvider();
    expect(await processOneJob(queue, provider)).toBe("error");
    expect(provider.calls).toHaveLength(0);
    expect(queue.complete).toHaveBeenCalledWith(expect.objectContaining({ decisionJson: "{}" }));
  });
  it("marks inference failure without inventing a decision", async () => {
    const queue = backend();
    expect(await processOneJob(queue, new FakeInferenceProvider())).toBe("error");
    expect(queue.complete).toHaveBeenCalledWith(expect.objectContaining({ decisionJson: "{}" }));
  });
  it("does not invoke a model with an almost-expired lease", async () => {
    const queue = backend(); queue.claim = vi.fn(async () => ({ jobId: "fixture-job", leaseToken: "fixture-lease", leaseUntil: Date.now() + 1_000, packetJson: JSON.stringify(exampleContextPacket) }));
    const provider = new FakeInferenceProvider();
    expect(await processOneJob(queue, provider)).toBe("error");
    expect(provider.calls).toHaveLength(0);
  });
  it("backs off empty polling to 10, 20 and 30 seconds and stops on shutdown", async () => {
    vi.useFakeTimers();
    const queue = backend(); queue.claim = vi.fn(async () => null);
    const provider = new FakeInferenceProvider();
    const controller = new AbortController();
    const running = runWorker(queue, provider, { signal: controller.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.claim).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(queue.claim).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(queue.claim).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(queue.claim).toHaveBeenCalledTimes(4);
      expect(provider.calls).toHaveLength(0);
    } finally { controller.abort(); await running; vi.useRealTimers(); }
  });
});
