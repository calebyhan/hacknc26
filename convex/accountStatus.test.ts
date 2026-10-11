import { convexTest } from "convex-test";
import spectrumTest from "@spectrum-ts/convex/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sealEnvelope } from "./lib/messaging";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function setup() {
  const t = convexTest(schema, modules);
  spectrumTest.register(t, "spectrum");
  return { t, app: t.withIdentity({ subject: "simulation|account-read" }) };
}
async function inbound(t: ReturnType<typeof setup>["t"], text: string, phone = "+15550000001") {
  const providerMessageId = crypto.randomUUID();
  const bodyRedactedOrEncrypted = await sealEnvelope({ text, spaceId: `iMessage;-;${phone}` }, `spectrum:${providerMessageId}:${phone}`);
  return (await t.mutation(internal.inbound.ingest, { provider: "spectrum", providerMessageId, senderPhone: phone, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted })).messageId;
}

describe("authenticated account status (local simulation only)", () => {
  it("denies anonymous/unregistered reads and invalid registration without exposing input", async () => {
    const { t, app } = setup();
    await expect(t.query(api.accounts.current, {})).rejects.toMatchObject({ data: { version: 1, code: "AUTHENTICATION_REQUIRED" } });
    await expect(app.query(api.accounts.current, {})).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    await expect(app.mutation(api.accounts.register, { displayName: " " })).rejects.toMatchObject({ data: { version: 1, code: "INVALID_INPUT" } });
    expect(await t.run(ctx => ctx.db.query("users").collect())).toEqual([]);
  });

  it("reads only the caller's allowlisted fields, with phone linkage separate from event consent", async () => {
    const { t, app } = setup();
    const userId = await app.mutation(api.accounts.register, { displayName: "Alex" });
    const other = t.withIdentity({ subject: "simulation|another-account" });
    const otherUserId = await other.mutation(api.accounts.register, { displayName: "Other" });
    await t.run(async ctx => {
      await ctx.db.patch(otherUserId, { verifiedPhoneE164: "+15550000002", messagingState: "stopped", settings: { skills: ["private-other-skill"] } });
      await ctx.db.patch(userId, { settings: { skills: ["private-own-skill"] } });
    });
    expect(await app.query(api.accounts.current, {})).toEqual({ userId, displayName: "Alex", phoneLinked: false, messagingState: "active" });
    expect(await other.query(api.accounts.current, {})).toEqual({ userId: otherUserId, displayName: "Other", phoneLinked: true, messagingState: "stopped" });
    expect(await t.run(ctx => ctx.db.query("memberships").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });

  it("restores canonical linked status for the verified identity after phone-account reconciliation", async () => {
    const { t, app } = setup();
    const canonicalId = await t.run(ctx => ctx.db.insert("users", { displayName: "Rally participant", verifiedPhoneE164: "+15550000001", createdAt: Date.now(), messagingState: "paused", settings: {} }));
    const provisionalId = await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "fixture-link" });
    expect((await app.query(api.accounts.current, {})).phoneLinked).toBe(false);
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toMatchObject({ data: { version: 1, code: "PHONE_PROOF_REQUIRED" } });
    await inbound(t, `JOIN ${challenge.code}`);
    expect(await app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).toBe(canonicalId);
    expect(await app.query(api.accounts.current, {})).toEqual({ userId: canonicalId, displayName: "Alex", phoneLinked: true, messagingState: "paused" });
    expect(await t.run(ctx => ctx.db.get(provisionalId))).toBeNull();
    expect(await t.run(ctx => ctx.db.query("memberships").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });

  it("phone failures expose stable codes but never another account's challenge data", async () => {
    const { t, app } = setup();
    await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "fixture-expiry" });
    const other = t.withIdentity({ subject: "simulation|another-account" });
    await other.mutation(api.accounts.register, { displayName: "Other" });
    await expect(other.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    vi.advanceTimersByTime(600_001);
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toMatchObject({ data: { version: 1, code: "PHONE_CHALLENGE_EXPIRED" } });
  });
});
