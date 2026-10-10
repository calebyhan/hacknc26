import { defineTestApp } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const { createTest } = defineTestApp({ schema }).defineModules({});

describe("Convex storage contract (in-memory simulation)", () => {
  it("registers all sixteen documented tables", () => {
    expect(Object.keys(schema.tables).sort()).toEqual([
      "auditEvents", "availability", "commitments", "contactSelections",
      "conversationFocus", "events", "inboundMessages", "invitations",
      "memberships", "outboundMessages", "proposals", "reasoningJobs",
      "tasks", "users", "weatherObservations", "workerHeartbeats",
    ]);
  });

  it("indexes provider IDs with provider scope", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      for (const provider of ["fake-a", "fake-b"]) {
        await ctx.db.insert("inboundMessages", {
          provider,
          providerMessageId: "shared-fixture-id",
          senderPhone: "+15550000001",
          receivedAt: 1_792_246_800_000,
          contentType: "text/plain",
          processingState: "received",
        });
      }
      const messages = await ctx.db.query("inboundMessages")
        .withIndex("by_provider_message_id", (q) =>
          q.eq("provider", "fake-a").eq("providerMessageId", "shared-fixture-id"))
        .collect();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.provider).toBe("fake-a");
    });
  });

  it("rejects proposal/display states and direct assignees on committed task records", async () => {
    const t = createTest();
    const eventId = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        displayName: "Fixture organizer",
        createdAt: 1_792_246_800_000,
        messagingState: "active",
        settings: {},
      });
      return ctx.db.insert("events", {
        title: "Schema fixture", kind: "event", startsAt: 1_792_246_800_000,
        timezone: "America/New_York", ownerId, status: "draft", version: 1,
      });
    });
    await expect(t.run(async (ctx) => ctx.db.insert("tasks", {
      eventId, title: "setup", capacity: 1, version: 1,
      // @ts-expect-error A pending offer is not a committed task status.
      status: "pending",
    }))).rejects.toThrow();
    await expect(t.run(async (ctx) => ctx.db.insert("tasks", {
      eventId, title: "setup", capacity: 1, version: 1, status: "unassigned",
      // @ts-expect-error Assignees are derived from commitments, never task fields.
      assigneeId: "fixture-user",
    }))).rejects.toThrow();
    const tasks = await t.run(async (ctx) => ctx.db.query("tasks").collect());
    expect(tasks).toEqual([]);
  });
});
