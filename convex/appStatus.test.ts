import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sealEnvelope } from "./lib/messaging";
import { AppEventStatusSchema, AppRouteSchema } from "../packages/shared/appStatus";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const DAY = 86_400_000;
const PHONE = "+15550000001", OTHER_PHONE = "+15550000002", LINE = "+15550000099";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const user = await ctx.db.insert("users", { displayName: "Alex", verifiedPhoneE164: PHONE, authSubject: "simulation|alex", messagingState: "active", createdAt: Date.now(), settings: {} });
    const other = await ctx.db.insert("users", { displayName: "Other", verifiedPhoneE164: OTHER_PHONE, authSubject: "simulation|other", messagingState: "active", createdAt: Date.now(), settings: {} });
    const event = await ctx.db.insert("events", { title: "Fixture event", kind: "event", ownerId: user, startsAt: Date.now() + DAY, timezone: "UTC", status: "scheduled", version: 1 });
    const hidden = await ctx.db.insert("events", { title: "Private other event", kind: "event", ownerId: other, startsAt: Date.now() + DAY, timezone: "UTC", status: "scheduled", version: 1 });
    const membership = await ctx.db.insert("memberships", { userId: user, eventId: event, role: "organizer", state: "enrolled", notificationsEnabled: true });
    await ctx.db.insert("memberships", { userId: other, eventId: hidden, role: "organizer", state: "enrolled", notificationsEnabled: true });
    return { user, other, event, hidden, membership };
  });
  const app = t.withIdentity({ subject: "simulation|alex" }), otherApp = t.withIdentity({ subject: "simulation|other" });
  async function inbound(linePhone?: string, options: { phone?: string; provider?: string; corrupt?: boolean; receivedAt?: number; text?: string } = {}) {
    const senderPhone = options.phone ?? PHONE, provider = options.provider ?? "spectrum", providerMessageId = crypto.randomUUID();
    const encrypted = await sealEnvelope({ text: options.text ?? "JOIN fixture", spaceId: `iMessage;-;${senderPhone}`, ...(linePhone === undefined ? {} : { linePhone }) }, `${provider}:${providerMessageId}:${senderPhone}`);
    return t.run(ctx => ctx.db.insert("inboundMessages", { provider, providerMessageId, senderPhone, receivedAt: options.receivedAt ?? Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted: options.corrupt ? "invalid-envelope" : encrypted, processingState: "processed" }));
  }
  function provision(overrides: Partial<{ participantPhoneE164: string; destination: string; verifiedAt: number; expiresAt: number; providerReference: string }> = {}) {
    return t.mutation(internal.appStatus.recordProvisionedRoute, { participantPhoneE164: PHONE, destination: LINE, verifiedAt: Date.now(), expiresAt: Date.now() + DAY, providerReference: "fixture-authoritative-allocation", ...overrides });
  }
  return { t, app, otherApp, ids, inbound, provision };
}

describe("app status read boundary (offline fixtures only)", () => {
  it("requires identity and enrolled membership, and overview only includes own enrolled events", async () => {
    const { t, app, otherApp, ids } = await fixture();
    for (const name of [api.appStatus.overview, api.appStatus.route]) await expect(t.query(name, {})).rejects.toMatchObject({ data: { version: 1, code: "AUTHENTICATION_REQUIRED" } });
    await expect(t.query(api.appStatus.event, { eventId: ids.event })).rejects.toMatchObject({ data: { version: 1, code: "AUTHENTICATION_REQUIRED" } });
    await expect(otherApp.query(api.appStatus.event, { eventId: ids.event })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    expect((await app.query(api.appStatus.overview, {})).map(row => row.eventId)).toEqual([ids.event]);
    for (const state of ["invited", "left"] as const) {
      await t.run(ctx => ctx.db.patch(ids.membership, { state }));
      await expect(app.query(api.appStatus.event, { eventId: ids.event })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
      expect(await app.query(api.appStatus.overview, {})).toEqual([]);
    }
  });

  it("separates enrollment, verified JOIN consent, notifications and messaging controls", async () => {
    const { t, app, ids, inbound } = await fixture();
    const read = async () => (await app.query(api.appStatus.event, { eventId: ids.event })).messaging;
    expect(await read()).toEqual({ membershipState: "enrolled", consentRecorded: false, notificationsEnabled: true, messagingState: "active", canReceiveMessages: false });
    const spoof = await inbound(LINE, { phone: OTHER_PHONE });
    await t.run(ctx => ctx.db.patch(ids.membership, { consentAt: Date.now(), consentSourceMessageId: spoof }));
    expect((await read()).consentRecorded).toBe(false);
    const unrelated = await inbound(LINE, { text: "hello" });
    await t.run(ctx => ctx.db.patch(ids.membership, { consentSourceMessageId: unrelated }));
    expect((await read()).consentRecorded).toBe(false);
    const consent = await inbound(LINE);
    await t.run(ctx => ctx.db.patch(ids.membership, { consentSourceMessageId: consent }));
    expect(await read()).toMatchObject({ consentRecorded: true, canReceiveMessages: true });
    for (const messagingState of ["paused", "stopped"] as const) {
      await t.run(ctx => ctx.db.patch(ids.user, { messagingState }));
      expect(await read()).toMatchObject({ consentRecorded: true, messagingState, canReceiveMessages: false });
    }
    await t.run(async ctx => { await ctx.db.patch(ids.user, { messagingState: "active" }); await ctx.db.patch(ids.membership, { notificationsEnabled: false }); });
    expect(await read()).toMatchObject({ consentRecorded: true, canReceiveMessages: false });
  });

  it("counts canonical task states, independent of pending proposals and another event", async () => {
    const { t, app, ids } = await fixture();
    await t.run(async ctx => {
      for (const status of ["confirmed", "unassigned", "needs_coverage", "completed", "canceled"] as const) await ctx.db.insert("tasks", { eventId: ids.event, title: "Task", capacity: 1, status, version: 1 });
      await ctx.db.insert("tasks", { eventId: ids.hidden, title: "Private task", capacity: 1, status: "confirmed", version: 1 });
      await ctx.db.insert("proposals", { eventId: ids.event, originatorId: ids.user, type: "assignment", state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 1, expiresAt: Date.now() + DAY, idempotencyKey: "fixture-proposal" });
    });
    const result = await app.query(api.appStatus.event, { eventId: ids.event });
    expect(result.progress).toEqual({ total: 5, confirmed: 1, needsCoverage: 2, completed: 1, canceled: 1 });
    expect(await app.query(api.appStatus.overview, {})).toEqual([{ eventId: ids.event, progress: result.progress }]);
    expect(AppEventStatusSchema.safeParse(result).success).toBe(true);
  });

  it("returns bounded chronological static activity and only the caller's delivery states", async () => {
    const { t, app, ids } = await fixture();
    await t.run(async ctx => {
      for (let i = 39; i >= 0; i--) await ctx.db.insert("auditEvents", { eventId: ids.event, actorType: "system", action: "task_created", at: Date.now() - i - 100, sourceId: "private-source", oldStateRef: "private-budget", newStateRef: "private-contact" });
      await ctx.db.insert("auditEvents", { eventId: ids.event, actorType: "system", action: "private-arbitrary-action", at: Date.now(), sourceId: "private-source" });
      await ctx.db.insert("auditEvents", { eventId: ids.hidden, actorType: "system", action: "event_created", at: Date.now(), sourceId: "private-source" });
      for (const state of ["queued", "sending", "sent", "delivered", "failed", "unknown"] as const) await ctx.db.insert("outboundMessages", { eventId: ids.event, recipientUserId: ids.user, content: "private-content", idempotencyKey: `fixture-${state}`, state, attemptCount: 1, providerMessageId: "private-provider-id" });
      await ctx.db.insert("outboundMessages", { eventId: ids.event, recipientUserId: ids.other, content: "private-other", idempotencyKey: "fixture-other", state: "delivered", attemptCount: 1 });
      await ctx.db.insert("outboundMessages", { eventId: ids.hidden, recipientUserId: ids.user, content: "private-hidden", idempotencyKey: "fixture-hidden", state: "sent", attemptCount: 1 });
    });
    const { activity } = await app.query(api.appStatus.event, { eventId: ids.event });
    expect(activity).toHaveLength(30);
    expect(activity.map(row => row.at)).toEqual(activity.map(row => row.at).sort((a, b) => b - a));
    expect(activity.filter(row => row.kind === "delivery").map(row => row.deliveryState).sort()).toEqual(["delivered", "failed", "queued", "sending", "sent", "unknown"]);
    expect(activity.filter(row => row.kind === "domain")[0]?.at).toBe(Date.now() - 100);
    expect(JSON.stringify(activity)).not.toContain("private");
    expect(new Set(activity.map(row => row.title))).toEqual(new Set(["Task created", "Message created for you"]));
  });
});

describe("authoritative current-user contact routing (offline encrypted/provisioned fixtures)", () => {
  it("uses only the latest signed dedicated line, includes expiry, and cannot leak another user's route", async () => {
    const { app, otherApp, inbound } = await fixture();
    await inbound(LINE);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "available", destination: LINE, expiresAt: Date.now() + DAY });
    expect(await otherApp.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    vi.advanceTimersByTime(1);
    await inbound("+15550000098");
    expect(await app.query(api.appStatus.route, {})).toMatchObject({ destination: "+15550000098" });
    vi.advanceTimersByTime(DAY);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
  });

  it.each(["shared", "invalid", PHONE, undefined])("newest %s observation suppresses older valid dedicated hints", async line => {
    const { app, inbound } = await fixture();
    await inbound(LINE);
    vi.advanceTimersByTime(1);
    await inbound(line);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
  });

  it.each([{ corrupt: true }, { provider: "spoofed" }, { receivedAt: 1_900_000_000_001 }])("rejects untrusted, corrupt or future evidence: %j", async options => {
    const { app, inbound } = await fixture();
    await inbound(LINE, options);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
  });

  it("requires a server-verified caller phone and never derives destination from sender/space ID", async () => {
    const { t, app, ids, inbound, provision } = await fixture();
    await inbound("shared");
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    await provision();
    await t.run(ctx => ctx.db.patch(ids.user, { verifiedPhoneE164: undefined }));
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    expect(AppRouteSchema.safeParse({ status: "available", destination: "shared", expiresAt: Date.now() + DAY }).success).toBe(false);
  });

  it("supports trusted shared-line provisioning, exact retry, rotation, and current-user scoping", async () => {
    const { app, otherApp, inbound, provision } = await fixture();
    await inbound("shared");
    await provision(); await provision();
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "available", destination: LINE, expiresAt: Date.now() + DAY });
    expect(await otherApp.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    vi.advanceTimersByTime(1); await inbound("+15550000098");
    expect(await app.query(api.appStatus.route, {})).toMatchObject({ destination: "+15550000098" });
    vi.advanceTimersByTime(1); await inbound("shared");
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    vi.advanceTimersByTime(1); await provision({ destination: "+15550000097" });
    expect(await app.query(api.appStatus.route, {})).toMatchObject({ destination: "+15550000097" });
  });
  it("keeps an authoritative allocation after shared-only JOIN traffic, but never revives a rotated line", async () => {
    const { app, inbound, provision } = await fixture();
    await provision();
    vi.advanceTimersByTime(1); await inbound("shared");
    expect(await app.query(api.appStatus.route, {})).toMatchObject({ destination: LINE });
    vi.advanceTimersByTime(1); await inbound("+15550000098");
    vi.advanceTimersByTime(1); await inbound("shared");
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
  });

  it("rejects invalid phones, self destinations, bad TTL, future/stale verification and conflicting replay", async () => {
    const { provision } = await fixture();
    for (const overrides of [
      { participantPhoneE164: "5550000001" }, { destination: "shared" }, { destination: PHONE }, { providerReference: " " },
      { expiresAt: Date.now() }, { expiresAt: Date.now() + DAY + 1 }, { verifiedAt: Date.now() + 1 }, { verifiedAt: Date.now() - DAY - 1 },
      { verifiedAt: Date.now() + 0.5 },
    ]) await expect(provision(overrides)).rejects.toThrow("INVALID_ROUTE_PROVISIONING");
    await provision();
    await expect(provision({ destination: "+15550000098" })).rejects.toThrow("STALE_ROUTE_PROVISIONING");
    vi.advanceTimersByTime(1);
    await expect(provision({ verifiedAt: Date.now() - 2, expiresAt: Date.now() + 1000 })).rejects.toThrow("STALE_ROUTE_PROVISIONING");
  });

  it("expired or revoked records suppress inbound fallback; only newer trusted provisioning can restore", async () => {
    const { t, app, inbound, provision } = await fixture();
    await inbound(LINE);
    await provision({ expiresAt: Date.now() + 100 });
    vi.advanceTimersByTime(101); await inbound("+15550000098");
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    await provision();
    await t.mutation(internal.appStatus.revokeProvisionedRoute, { participantPhoneE164: PHONE });
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    await expect(provision()).rejects.toThrow("STALE_ROUTE_PROVISIONING");
    vi.advanceTimersByTime(1); await inbound(LINE);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    await provision();
    expect(await app.query(api.appStatus.route, {})).toMatchObject({ destination: LINE });
  });

  it("revocation creates a tombstone even without provisioning, so no old route can revive", async () => {
    const { t, app, inbound } = await fixture();
    await inbound(LINE);
    await t.mutation(internal.appStatus.revokeProvisionedRoute, { participantPhoneE164: PHONE });
    vi.advanceTimersByTime(1); await inbound(LINE);
    expect(await app.query(api.appStatus.route, {})).toEqual({ status: "unavailable" });
    expect(await t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
});
