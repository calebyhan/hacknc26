import { ConvexError } from "convex/values";
import { ZodError } from "zod";
import type { QueryCtx } from "../_generated/server";
import { PublicErrorSchema, type PublicErrorCode, type PublicErrorData } from "../../packages/shared/publicErrors";

// Exact internal sentinels only. Substrings, serialized errors and arbitrary
// thrown objects are deliberately not a public error protocol.
const INTERNAL_CODES: ReadonlyMap<string, PublicErrorCode> = new Map([
  ["AUTHENTICATION_REQUIRED", "AUTHENTICATION_REQUIRED"],
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
]);

function publicData(error: unknown): PublicErrorData {
  if (error instanceof ConvexError) {
    const nested = PublicErrorSchema.safeParse(error.data);
    return nested.success ? nested.data : { version: 1, code: "INTERNAL_ERROR" };
  }
  const code = error instanceof ZodError ? "INVALID_INPUT"
    : error instanceof Error ? INTERNAL_CODES.get(error.message) ?? "INTERNAL_ERROR"
      : "INTERNAL_ERROR";
  return { version: 1, code };
}

/**
 * App-facing boundary only; internal domain/auth exceptions remain unchanged.
 * Identity is verified before any handler work; the handler still enforces its
 * caller's account and membership/role. Framework argument validation runs
 * before this wrapper, so clients must also handle ordinary safe SDK failures.
 */
export async function withPublicErrors<T>(
  ctx: Pick<QueryCtx, "auth">,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    if (!await ctx.auth.getUserIdentity()) throw new Error("AUTHENTICATION_REQUIRED");
    return await operation();
  } catch (error) {
    throw new ConvexError(publicData(error));
  }
}
