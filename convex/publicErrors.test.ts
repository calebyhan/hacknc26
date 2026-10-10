import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { QueryCtx } from "./_generated/server";
import { withPublicErrors } from "./lib/publicErrors";
import { PublicErrorSchema } from "../packages/shared/publicErrors";

// Local boundary tests only; these fixtures contain no credential or provider.
const authenticated: Pick<QueryCtx, "auth"> = {
  auth: { getUserIdentity: async () => ({ subject: "fixture-user", issuer: "fixture-issuer", tokenIdentifier: "fixture-identity" }) },
};
const anonymous: Pick<QueryCtx, "auth"> = { auth: { getUserIdentity: async () => null } };

describe("versioned public application errors", () => {
  it("returns successful values without rewriting them", async () => {
    expect(await withPublicErrors(authenticated, () => ({ saved: true }))).toEqual({ saved: true });
  });

  it("requires server identity before invoking a handler", async () => {
    let called = false;
    await expect(withPublicErrors(anonymous, () => { called = true; })).rejects.toMatchObject({
      data: { version: 1, code: "AUTHENTICATION_REQUIRED" },
    });
    expect(called).toBe(false);
  });

  it.each([
    ["UNAUTHORIZED", "ACCESS_DENIED"],
    ["PHONE_LINK_REQUIRED", "PHONE_LINK_REQUIRED"],
    ["PHONE_PROOF_REQUIRED", "PHONE_PROOF_REQUIRED"],
    ["PHONE_CHALLENGE_EXPIRED", "PHONE_CHALLENGE_EXPIRED"],
    ["PHONE_IDENTITY_CONFLICT", "PHONE_IDENTITY_CONFLICT"],
    ["PHONE_CHANGE_NOT_SUPPORTED", "PHONE_CHANGE_NOT_SUPPORTED"],
    ["LINK_PHONE_BEFORE_CREATING_EVENTS", "LINK_PHONE_BEFORE_CREATING_EVENTS"],
    ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"],
    ["STALE_EVENT", "STALE_EVENT"],
    ["STALE_TASK", "STALE_TASK"],
    ["EVENT_CLOSED", "EVENT_CLOSED"],
    ["INVALID_EVENT_TRANSITION", "INVALID_EVENT_TRANSITION"],
    ["ALREADY_ENROLLED", "ALREADY_ENROLLED"],
    ["INVITATIONS_UNAVAILABLE", "INVITATIONS_UNAVAILABLE"],
    ["INVALID_CONTACT", "INVALID_INPUT"],
    ["INVALID_INVITATION_REQUEST", "INVALID_INPUT"],
    ["INVALID_DEPENDENCY", "INVALID_INPUT"],
  ])("maps exact internal %s to %s without additional data", async (internalCode, code) => {
    try {
      await withPublicErrors(authenticated, () => { throw new Error(internalCode); });
      throw new Error("Expected boundary failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<{ version: number; code: string }>).data).toEqual({ version: 1, code });
    }
  });

  it("maps Zod validation issues without returning their private input or paths", async () => {
    await expect(withPublicErrors(authenticated, () => z.strictObject({ privateContact: z.literal("expected") }).parse({ privateContact: "private-value" })))
      .rejects.toMatchObject({ data: { version: 1, code: "INVALID_INPUT" } });
  });

  it.each([
    new Error("UNAUTHORIZED private-contact private-token"),
    new Error("PHONE_PROOF_REQUIRED\nprivate-message"),
    new Error("private-storage-failure"),
    "PHONE_PROOF_REQUIRED",
    { message: "UNAUTHORIZED", privateValue: "private-token" },
    new ConvexError("PHONE_PROOF_REQUIRED"),
    new ConvexError({ version: 2, code: "PHONE_PROOF_REQUIRED" }),
    new ConvexError({ version: 1, code: "PHONE_PROOF_REQUIRED", privateValue: "private-token" }),
    new ConvexError({ version: 1, code: "FUTURE_ERROR" }),
  ])("redacts unknown failures rather than parsing their text: %#", async (failure) => {
    try {
      await withPublicErrors(authenticated, () => { throw failure; });
      throw new Error("Expected boundary failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<{ version: number; code: string }>).data).toEqual({ version: 1, code: "INTERNAL_ERROR" });
      expect(String(error)).not.toContain("private-");
    }
  });

  it("preserves only validated nested public payloads", async () => {
    await expect(withPublicErrors(authenticated, () => { throw new ConvexError({ version: 1, code: "PHONE_PROOF_REQUIRED" }); }))
      .rejects.toMatchObject({ data: { version: 1, code: "PHONE_PROOF_REQUIRED" } });
  });

  it("runtime schema rejects unknown versions, codes and extra properties", () => {
    expect(PublicErrorSchema.parse({ version: 1, code: "ACCESS_DENIED" })).toEqual({ version: 1, code: "ACCESS_DENIED" });
    for (const payload of [{ code: "ACCESS_DENIED" }, { version: 2, code: "ACCESS_DENIED" }, { version: 1, code: "FUTURE" }, { version: 1, code: "ACCESS_DENIED", details: "private" }]) {
      expect(PublicErrorSchema.safeParse(payload).success).toBe(false);
    }
  });
});
