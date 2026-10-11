import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { messagingHarness } from "./harness";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T14:00:00Z"));
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const h = await messagingHarness();
  for (const text of ["create an event", "Fixture picnic", "Oct 12, 2026 at 2 PM", "Eastern", "skip", "yes, create it"]) await h.receive(h.phones.alex, text);
  const tasks = () => h.t.run(ctx => ctx.db.query("tasks").collect());
  const session = async () => {
    const row = await h.t.run(ctx => ctx.db.query("phoneSetupSessions").unique());
    return row ? { ...row, state: JSON.parse(row.stateJson) as Record<string, unknown> } : null;
  };
  async function firstTask() {
    for (const text of ["add a task", "setup", "1 PM", "2 PM", "2", "yes, add it"]) await h.receive(h.phones.alex, text);
  }
  return { ...h, tasks, session, firstTask };
}

describe("task wizard continuity — signed simulated inputs, no model/provider", () => {
  it("keeps the exact next-title/time fragment in a reviewed wizard instead of creating model jobs", async () => {
    const h = await fixture(); await h.firstTask();
    expect(h.fake.sends.at(-1)!.content).toContain("next task's name");
    expect(h.fake.sends.at(-1)!.content).toContain("done");
    const firstSession = await h.session();
    for (const text of ["speakers", "1:30 PM", "2:30 PM", "1"]) await h.receive(h.phones.alex, text);
    expect(await h.tasks()).toHaveLength(1);
    expect(h.fake.sends.at(-1)!.content).toContain("Review speakers");
    await h.receive(h.phones.alex, "yes, add it", "confirm-speakers");
    await h.receive(h.phones.alex, "yes, add it", "confirm-speakers");
    await h.receive(h.phones.alex, "yes, add it");
    expect((await h.tasks()).map(task => ({ title: task.title, capacity: task.capacity, status: task.status }))).toEqual([
      { title: "setup", capacity: 2, status: "unassigned" }, { title: "speakers", capacity: 1, status: "unassigned" },
    ]);
    expect((await h.session())?._id).not.toBe(firstSession?._id);
    expect((await h.session())?.state).toMatchObject({ step: "next_task" });
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toHaveLength(0);
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
  });

  it("finishes with done, starts again explicitly, and discards an unfinished task without changing saved tasks", async () => {
    const h = await fixture(); await h.firstTask();
    await h.receive(h.phones.alex, "done");
    expect(await h.session()).toBeNull();
    expect(h.fake.sends.at(-1)!.content).toContain("Saved tasks");
    for (const text of ["add a task", "cleanup", "3 PM", "4 PM", "2"]) await h.receive(h.phones.alex, text);
    expect(await h.tasks()).toHaveLength(1);
    await h.receive(h.phones.alex, "done");
    expect(await h.session()).toBeNull(); expect(await h.tasks()).toHaveLength(1);
    await h.receive(h.phones.alex, "add a task");
    expect((await h.session())?.state).toMatchObject({ step: "title" });
  });

  it("passes deterministic commands through while preserving the next-task prompt", async () => {
    const h = await fixture(); await h.firstTask();
    for (const text of ["STATUS", "whats my status", "what's my status?", "YES", "NO", "HELP", "APPROVE speakers", "STOP", "RESUME"]) await h.receive(h.phones.alex, text);
    expect((await h.session())?.state).toMatchObject({ step: "next_task" });
    await h.receive(h.phones.alex, "speakers");
    expect((await h.session())?.state).toMatchObject({ step: "start", title: "speakers" });
    expect(await h.tasks()).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toHaveLength(0);
  });

  it.each(["Can Maya cover setup?", "I can cover setup", "Who can help with setup?", "assign Maya to setup", "what's happening?"])("does not consume '%s' as a next task title", async text => {
    const h = await fixture(); await h.firstTask(); await h.receive(h.phones.alex, text);
    expect(await h.tasks()).toHaveLength(1);
    expect((await h.session())?.state.step).not.toBe("start");
    expect(h.fake.sends.at(-1)!.content).not.toContain(`When does ${text}`);
  });

  it("does not consume a coordination request or a misplaced consent phrase in an explicit title prompt", async () => {
    const h = await fixture(); await h.firstTask();
    await h.receive(h.phones.alex, "add a task");
    await h.receive(h.phones.alex, "yes, add it");
    expect((await h.session())?.state).toMatchObject({ step: "title" });
    expect((await h.session())?.state.title).toBeUndefined();
    await h.receive(h.phones.alex, "Can Maya cover setup?");
    expect(await h.session()).toBeNull(); expect(await h.tasks()).toHaveLength(1);
    expect(h.fake.sends.at(-1)!.content).not.toContain("When does");
  });

  it.each([0, 10])("allows reset/add-a-task/cancel and rejects an older queued title after a newer restart (%sms apart)", async elapsed => {
    const h = await fixture(); await h.firstTask();
    for (const text of ["speakers", "1:30 PM", "reset"]) await h.receive(h.phones.alex, text);
    expect((await h.session())?.state).toMatchObject({ step: "title" });
    expect((await h.session())?.state.title).toBeUndefined();
    // Persist the earlier signed title without draining its scheduled router.
    const old = await h.receive(h.phones.alex, "old title", "delayed-title", false);
    vi.setSystemTime(Date.now() + elapsed);
    const fresh = await h.receive(h.phones.alex, "add a task", "fresh-start", false);
    await h.t.mutation(internal.commands.route, { messageId: fresh });
    await h.t.mutation(internal.commands.route, { messageId: old });
    await h.drain();
    expect((await h.session())?.state).toMatchObject({ step: "title" });
    expect((await h.session())?.state.title).toBeUndefined();
    await h.receive(h.phones.alex, "cancel setup");
    expect(await h.session()).toBeNull(); expect(await h.tasks()).toHaveLength(1);
  });

  it("expires the continuation without suggesting saved tasks were lost", async () => {
    const h = await fixture(); await h.firstTask();
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
    await h.receive(h.phones.alex, "speakers");
    expect(await h.session()).toBeNull(); expect(await h.tasks()).toHaveLength(1);
    expect(h.fake.sends.at(-1)!.content).toContain("Saved tasks");
    expect(h.fake.sends.at(-1)!.content).toContain("expired");
  });

  it("creates one task when two separately signed review confirmations race", async () => {
    const h = await fixture(); await h.firstTask();
    for (const text of ["speakers", "1:30 PM", "2:30 PM", "1"]) await h.receive(h.phones.alex, text);
    const a = await h.receive(h.phones.alex, "yes, add it", "confirmation-a", false);
    const b = await h.receive(h.phones.alex, "yes, add it", "confirmation-b", false);
    await Promise.all([a, b].map(messageId => h.t.mutation(internal.commands.route, { messageId })));
    await h.drain();
    expect((await h.tasks()).map(task => task.title)).toEqual(["setup", "speakers"]);
    expect((await h.session())?.state).toMatchObject({ step: "next_task" });
    for (const messageId of [a, b]) expect((await h.t.run(ctx => ctx.db.get(messageId)))?.processingState).toBe("processed");
  });
});
