import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { requireMember, requireOrganizer, requireUser } from "./lib/auth";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/** These checks prove only fail-closed bootstrap behavior, not auth or delivery. */
describe("Convex bootstrap stubs (in-memory simulation)", () => {
  it("rejects public reads and writes for anonymous and authenticated callers", async () => {
    const t = convexTest(schema, modules);
    const authenticated = t.withIdentity({ subject: "fixture-subject" });
    for (const caller of [t, authenticated]) {
      await expect(caller.query(api.events.myEvents, {}))
        .rejects.toThrow("UNAUTHORIZED");
      await expect(caller.mutation(api.events.create, {
        title: "Fixture only", kind: "event", startsAt: 1_792_246_800_000,
        timezone: "America/New_York", idempotencyKey: "fixture-create",
      })).rejects.toThrow("UNAUTHORIZED");
    }
    expect(await t.run(async (ctx) => ctx.db.query("events").collect())).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  it("rejects fake worker credentials without creating a claim or heartbeat", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.reasoningJobs.claim, {
      workerToken: "fake-token-not-a-secret", workerId: "fixture-worker",
    })).rejects.toThrow("NOT_IMPLEMENTED(lane-c)");
    await expect(t.mutation(api.reasoningJobs.heartbeat, {
      workerToken: "fake-token-not-a-secret", workerId: "fixture-worker",
    })).rejects.toThrow("NOT_IMPLEMENTED(lane-c)");
    expect(await t.run(async (ctx) => ctx.db.query("reasoningJobs").collect())).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("workerHeartbeats").collect())).toEqual([]);
  });

  it("keeps fixture setup inaccessible without organizer identity", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.seed.bootstrap, {}))
      .rejects.toThrow("UNAUTHORIZED");
    expect(await t.run(async (ctx) => ctx.db.query("inboundMessages").collect())).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("events").collect())).toEqual([]);
  });

  it("does not treat database ownership as authenticated identity", async () => {
    const t = convexTest(schema, modules);
    const eventId = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        displayName: "Fixture owner", createdAt: 1_792_246_800_000,
        messagingState: "active", settings: {},
      });
      return ctx.db.insert("events", {
        title: "Fixture only", kind: "event", startsAt: 1_792_246_800_000,
        timezone: "America/New_York", ownerId, status: "draft", version: 1,
      });
    });
    await expect(t.run(async (ctx) => requireUser(ctx)))
      .rejects.toThrow("UNAUTHORIZED");
    await expect(t.run(async (ctx) => requireMember(ctx, eventId)))
      .rejects.toThrow("UNAUTHORIZED");
    await expect(t.run(async (ctx) => requireOrganizer(ctx, eventId)))
      .rejects.toThrow("UNAUTHORIZED");
  });
});
