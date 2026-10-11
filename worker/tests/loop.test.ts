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
  it("picks up a job within two seconds even after a minute of idle polling", async () => {
    vi.useFakeTimers();
    const queue = backend();
    let available = false;
    queue.claim = vi.fn(async () => available ? { jobId: "fixture-job", leaseToken: "fixture-lease", leaseUntil: Date.now() + 45_000, packetJson: JSON.stringify(exampleContextPacket) } : null);
    const provider = new FakeInferenceProvider({ [exampleContextPacket.incomingText]: exampleAgentDecision });
    const controller = new AbortController();
    const running = runWorker(queue, provider, { signal: controller.signal });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.claim).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(queue.claim).toHaveBeenCalledTimes(31);
      expect(provider.calls).toHaveLength(0);
      available = true;
      await vi.advanceTimersByTimeAsync(1_999);
      expect(provider.calls).toHaveLength(1);
      expect(queue.complete).toHaveBeenCalledTimes(1);
    } finally { controller.abort(); await running; vi.useRealTimers(); }
  });
  it("waits thirty seconds after backend failure instead of retrying rapidly", async () => {
    vi.useFakeTimers();
    const queue = backend(); queue.claim = vi.fn(async () => { throw new Error("fixture outage"); });
    const controller = new AbortController();
    const provider = new FakeInferenceProvider();
    const running = runWorker(queue, provider, { signal: controller.signal });
    try {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(queue.claim).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(queue.claim).toHaveBeenCalledTimes(2);
      expect(provider.calls).toHaveLength(0);
    } finally { controller.abort(); await running; vi.useRealTimers(); }
  });
});
