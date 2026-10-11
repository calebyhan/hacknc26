import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { harness } from "./harness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("casual deterministic status — signed simulated input, fake delivery, no model", () => {
  it("aggregates every consented event through exact aliases without inference or domain changes", async () => {
    const h = await harness();
    const eventId = await h.app.mutation(api.events.create, { title: "Weekend picnic", kind: "event", startsAt: Date.now() + 172800000, timezone: "America/New_York", idempotencyKey: "status-second-event" });
    await h.app.mutation(api.tasks.create, { eventId, title: "snacks", capacity: 3, expectedEventVersion: 1, idempotencyKey: "status-snacks" });
    await h.app.mutation(api.events.confirmDraft, { eventId, expectedVersion: 1 });
    const invitation = await h.app.mutation(api.events.organizerInvitation, { eventId, idempotencyKey: "status-second-opt-in" });
    await h.receive(h.phones.alex, `JOIN ${invitation.code}`);
    const other = h.t.withIdentity({ subject: "simulation|status-private" });
    await other.mutation(api.accounts.register, { displayName: "Other" });
    await other.mutation(api.events.create, { title: "Secret unrelated appointment", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", idempotencyKey: "status-private" });
    const state = () => h.t.run(async ctx => ({ events: await ctx.db.query("events").collect(), tasks: await ctx.db.query("tasks").collect(), commitments: await ctx.db.query("commitments").collect(), proposals: await ctx.db.query("proposals").collect(), jobs: await ctx.db.query("reasoningJobs").collect() }));
    const before = await state();
    for (const text of ["whats my status", "what’s my status?", "show my status", "my status", "what am I assigned to"]) {
      const messageId = await h.receive(h.phones.alex, text);
      const reply = h.fake.sends.at(-1)!.content;
      expect(reply).toContain("Integration Charity 5K"); expect(reply).toContain("Weekend picnic");
      expect(reply).toContain("setup"); expect(reply).toContain("snacks"); expect(reply).not.toContain("Secret");
      expect((await h.t.run(ctx => ctx.db.get(messageId)))!.processingState).toBe("processed");
    }
    expect(await state()).toEqual(before);
    await h.receive(h.phones.maya, "my status");
    expect(h.fake.sends.at(-1)!.content).toContain("Integration Charity 5K");
    expect(h.fake.sends.at(-1)!.content).not.toContain("Weekend picnic");
    expect(await state()).toEqual(before);
  });
});
