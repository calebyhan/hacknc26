import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { messagingHarness } from "./harness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it("guided receipts permit only the exact own reply, for one signed message and bounded lifetime", async () => {
  const h = await messagingHarness();
  const messageId = await h.receive(h.phones.alex, "create an event");
  const receipt = (await h.t.run(ctx => ctx.db.query("phoneSetupReceipts").unique()))!;
  const content = h.fake.sends.at(-1)!.content;
  const enqueue = (content: string, directReplyToMessageId = messageId) => h.t.mutation(internal.outbox.enqueue, {
    idempotencyKey: crypto.randomUUID(), recipientUserId: receipt.userId, content, directReplyToMessageId,
  });
  await expect(enqueue("Unapproved message")).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  const other = await h.receive(h.phones.jordan, "HELP");
  await expect(enqueue(content, other)).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  await h.t.run(ctx => ctx.db.patch(receipt._id, { createdAt: Date.now() - 86_400_001 }));
  await expect(enqueue(content)).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  await h.t.run(ctx => ctx.db.patch(receipt._id, { createdAt: Date.now() }));
  await h.receive(h.phones.alex, "STOP");
  await expect(enqueue(content)).rejects.toThrow("MESSAGING_NOT_PERMITTED");
});
