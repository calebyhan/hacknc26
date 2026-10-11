import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

import { harness } from "./harness";

// Actual A+B functions, signed synthetic webhooks and actual scheduler. Only
// the external provider boundary is fake. No real phones, Photon or Claude.
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });


describe("Lane A+B full pipeline (simulation; no real provider/model)", () => {
  it("signed JOIN -> request -> YES -> STATUS commits once; duplicate webhook and repeated YES do not renotify", async () => {
    const h = await harness(), before = (await h.outbox()).length;
    const p = await h.offer();
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    const request = (await h.outbox()).filter(r => r.proposalId === p);
    expect(request).toHaveLength(1); expect(request[0]).toMatchObject({ recipientUserId: h.ids.jordan, state: "sent", attemptCount: 1 });
    const jobsBeforeReplies = await h.t.run(ctx => ctx.db.query("reasoningJobs").collect());
    const providerMessageId = crypto.randomUUID();
    await h.receive(h.phones.jordan, "YES", providerMessageId);
    const after = (await h.outbox()).length;
    await h.receive(h.phones.jordan, "YES", providerMessageId);
    expect(await h.outbox()).toHaveLength(after);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    const proposalRows = (await h.outbox()).filter(r => r.proposalId === p);
    expect(proposalRows).toHaveLength(4);
    expect(proposalRows.every(r => r.state === "sent" && r.providerMessageId && r.attemptCount === 1)).toBe(true);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("setup: confirmed (1 accepted)");
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toEqual(jobsBeforeReplies);
    expect((await h.outbox()).length).toBeGreaterThan(before);
  });
  it("signed NO preserves Maya and emits one truthful notice to organizer and target", async () => {
    const h = await harness(), p = await h.offer();
    await h.receive(h.phones.jordan, "NO");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "declined" });
    expect((await h.outbox()).filter(r => r.proposalId === p)).toHaveLength(3);
    expect(h.fake.sends.filter(r => r.recipientUserId === h.ids.alex).at(-1)?.content).toContain("declined");
  });
  it.each(["STOP", "LEAVE Integration Charity 5K"])("%s cancels pending offers before the command returns", async command => {
    const h = await harness(), p = await h.offer();
    const messageId = await h.receive(h.phones.jordan, command, crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId });
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("STOP followed by immediate RESUME cannot revive an old offer", async () => {
    const h = await harness(), p = await h.offer();
    for (const text of ["STOP", "RESUME", "YES"]) {
      const messageId = await h.receive(h.phones.jordan, text, crypto.randomUUID(), false);
      await h.t.mutation(internal.commands.route, { messageId });
    }
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it.each(["version", "expiry"])("a stale %s offer cannot hide the target's one current offer", async kind => {
    const h = await harness(), stale = await h.offer();
    if (kind === "version") await h.t.run(ctx => ctx.db.patch(h.ids.task, { version: 3 })); // simulated concurrent task edit
    else await h.t.run(ctx => ctx.db.patch(stale, { expiresAt: Date.now() - 1 })); // expiry job has not run
    const current = await h.offer();
    await h.receive(h.phones.jordan, "YES");
    expect(await h.t.run(ctx => ctx.db.get(current))).toMatchObject({ state: "accepted" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    expect((await h.t.query(internal.domain.statusFor, { userId: h.ids.alex })).events[0]?.proposals.find(p => p._id === stale)?.state).toBe(kind === "version" ? "expired" : "superseded");
  });
  it("two valid offers require clarification and make no commitment change", async () => {
    const h = await harness(); await h.offer();
    const currentTask = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const secondTask = await h.app.mutation(api.tasks.create, { eventId: h.ids.event, title: "cleanup", windowStart: currentTask.windowEnd!, windowEnd: currentTask.windowEnd! + 3600000, expectedEventVersion: 2, idempotencyKey: "cleanup" });
    await h.offer(h.ids.jordan, "assignment", secondTask); await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    expect(h.fake.sends.at(-1)?.content).toContain("several pending offers");
  });
  it("STOP revokes a queued request before the scheduled provider boundary runs", async () => {
    const h = await harness(), p = await h.offer(h.ids.jordan, "reassignment", h.ids.task, false);
    const messageId = await h.receive(h.phones.jordan, "STOP", crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId }); await h.drain();
    expect((await h.outbox()).find(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toMatchObject({ state: "failed", attemptCount: 0 });
    expect(h.fake.sends.filter(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toEqual([]);
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
  });
  it("PAUSE ignores YES without losing consent; RESUME then YES commits once", async () => {
    const h = await harness(), p = await h.offer();
    const jobsBeforeReplies = await h.t.run(ctx => ctx.db.query("reasoningJobs").collect());
    await h.receive(h.phones.jordan, "PAUSE"); await h.receive(h.phones.jordan, "YES");
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "pending" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    await h.receive(h.phones.jordan, "RESUME"); await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toEqual(jobsBeforeReplies);
  });
  it("actual scheduled expiry leaves the assignment intact and notifies only once", async () => {
    const h = await harness(), p = await h.offer();
    await vi.advanceTimersByTimeAsync(600001); await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "expired" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    const closed = (await h.outbox()).filter(r => r.proposalId === p);
    expect(closed).toHaveLength(3); // request, organizer and target expiry notice
    await h.t.mutation(internal.proposals.expire, { proposalId: p }); await h.drain();
    expect((await h.outbox()).filter(r => r.proposalId === p)).toHaveLength(3);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("member suggestions contact only the organizer until app approval; target YES is still required", async () => {
    const h = await harness(), sourceMessageId = await h.receive(h.phones.maya, "Can Jordan cover setup?");
    const task = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const p = await h.t.mutation(internal.proposals.create, { eventId: h.ids.event, originatorId: h.ids.maya, sourceMessageId, type: "reassignment", subjectId: h.ids.maya, targetTaskId: h.ids.task, targetUserId: h.ids.jordan, expectedEventVersion: 2, expectedTaskVersion: task.version, expiresAt: Date.now() + 600000, idempotencyKey: "member-suggestion" });
    await h.drain();
    expect(h.fake.sends.filter(r => r.proposalId === p).map(r => r.recipientUserId)).toEqual([h.ids.alex]);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("1 awaiting organizer approval");
    expect(h.fake.sends.at(-1)?.content).not.toContain("awaiting response");
    await h.app.mutation(api.proposals.approve, { proposalId: p }); await h.app.mutation(api.proposals.approve, { proposalId: p }); await h.drain();
    expect(h.fake.sends.filter(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toHaveLength(1);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("1 awaiting response");
    expect(h.fake.sends.at(-1)?.content).not.toContain("awaiting organizer approval");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
  });
  it("STATUS uses actual scoped domain reads and never exposes another organizer's private event", async () => {
    const h = await harness(), other = h.t.withIdentity({ subject: "simulation|unrelated-organizer" });
    await other.mutation(api.accounts.register, { displayName: "Other" });
    const privateEvent = await other.mutation(api.events.create, { title: "Private laboratory", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", idempotencyKey: "private" });
    await other.mutation(api.tasks.create, { eventId: privateEvent, title: "Private budget", expectedEventVersion: 1, idempotencyKey: "private-task" });
    await h.receive(h.phones.jordan, "STATUS");
    const content = h.fake.sends.at(-1)!.content;
    expect(content).toContain("Integration Charity 5K"); expect(content).not.toContain("Private");
    await expect(h.app.query(api.events.detail, { eventId: privateEvent })).rejects.toThrow("UNAUTHORIZED");
  });
});
