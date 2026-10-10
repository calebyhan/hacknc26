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
  const t = convexTest(schema, modules); spectrumTest.register(t, "spectrum");
  return { t, app: t.withIdentity({ subject: "simulation|app-user" }) };
}
async function inbound(t: ReturnType<typeof setup>["t"], text: string, phone = "+15550000001") {
  const providerMessageId = crypto.randomUUID();
  const bodyRedactedOrEncrypted = await sealEnvelope({ text, spaceId: `iMessage;-;${phone}` }, `spectrum:${providerMessageId}:${phone}`);
  return (await t.mutation(internal.inbound.ingest, { provider: "spectrum", providerMessageId, senderPhone: phone, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted })).messageId;
}
describe("app identity and actual phone proof (simulation)", () => {
  it("requires identity and registers once without granting any event or phone access", async () => {
    const { t, app } = setup();
    await expect(t.mutation(api.accounts.register, { displayName: "Alex" })).rejects.toThrow("UNAUTHORIZED");
    const userId = await app.mutation(api.accounts.register, { displayName: "Alex" });
    expect(await app.mutation(api.accounts.register, { displayName: "Alex" })).toBe(userId);
    expect((await t.run(ctx => ctx.db.get(userId)))?.verifiedPhoneE164).toBeUndefined();
    expect(await app.query(api.events.myEvents, {})).toEqual([]);
  });
  it("a phone string or another sender's JOIN never links an identity", async () => {
    const { t, app } = setup(); await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "phone-link" });
    expect(await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "phone-link" })).toEqual(challenge);
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toThrow("PHONE_PROOF_REQUIRED");
    await inbound(t, `JOIN ${challenge.code}`, "+15550000002");
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toThrow("PHONE_PROOF_REQUIRED");
    expect(await t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  it("links an existing HELP identity only after that phone sends the exact private challenge", async () => {
    const { t, app } = setup();
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "HELP") });
    const canonical = (await t.run(ctx => ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", "+15550000001")).unique()))!;
    const provisional = await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "proof" });
    await inbound(t, `JOIN ${challenge.code}`);
    expect(await app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).toBe(canonical._id);
    expect(await app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).toBe(canonical._id);
    expect(await t.run(ctx => ctx.db.get(provisional))).toBeNull();
    expect(await t.run(ctx => ctx.db.get(canonical._id))).toMatchObject({ authSubject: "simulation|app-user", displayName: "Alex" });
  });
  it("does not take over a phone already attached to a different app identity", async () => {
    const { t, app } = setup();
    await t.run(ctx => ctx.db.insert("users", { authSubject: "simulation|other-person", displayName: "Other", verifiedPhoneE164: "+15550000001", createdAt: Date.now(), messagingState: "active", settings: {} }));
    await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "conflict" });
    await inbound(t, `JOIN ${challenge.code}`);
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toThrow("PHONE_IDENTITY_CONFLICT");
  });
  it("expires challenges and checks the invitation belongs to the authenticated app user", async () => {
    const { t, app } = setup(); await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "expires" });
    const other = t.withIdentity({ subject: "simulation|other" }); await other.mutation(api.accounts.register, { displayName: "Other" });
    await expect(other.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toThrow("UNAUTHORIZED");
    await inbound(t, `JOIN ${challenge.code}`); vi.advanceTimersByTime(600001);
    await expect(app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).rejects.toThrow("PHONE_CHALLENGE_EXPIRED");
  });
  it("an organizer's app role is distinct from messaging consent, and its own JOIN safely adds consent", async () => {
    const { t, app } = setup();
    await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: "+15550000001", idempotencyKey: "organizer" });
    const phoneProof = await inbound(t, `JOIN ${challenge.code}`);
    await t.mutation(internal.invitations.redeem, { messageId: phoneProof, code: challenge.code });
    const userId = await app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId });
    const eventId = await app.mutation(api.events.create, { title: "Picnic", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", idempotencyKey: "picnic" });
    const membership = () => t.run(ctx => ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", userId)).unique());
    expect(await membership()).toMatchObject({ state: "enrolled", role: "organizer", notificationsEnabled: false });
    const invitation = await app.mutation(api.events.organizerInvitation, { eventId, idempotencyKey: "event-opt-in" });
    expect(await app.mutation(api.events.organizerInvitation, { eventId, idempotencyKey: "event-opt-in" })).toEqual(invitation);
    const messageId = await inbound(t, `JOIN ${invitation.code}`);
    expect(await t.mutation(internal.invitations.redeem, { messageId, code: invitation.code })).toMatchObject({ redeemed: true, userId, eventId });
    expect(await membership()).toMatchObject({ notificationsEnabled: true, consentSourceMessageId: messageId });
    expect(await t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
});
