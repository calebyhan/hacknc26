import { z } from "zod";

/** Stable app-facing failures. Details, input values and stack traces are never data. */
export const PUBLIC_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "ACCESS_DENIED",
  "INVALID_INPUT",
  "PHONE_LINK_REQUIRED",
  "PHONE_PROOF_REQUIRED",
  "PHONE_CHALLENGE_EXPIRED",
  "PHONE_IDENTITY_CONFLICT",
  "PHONE_CHANGE_NOT_SUPPORTED",
  "LINK_PHONE_BEFORE_CREATING_EVENTS",
  "IDEMPOTENCY_CONFLICT",
  "STALE_EVENT",
  "STALE_TASK",
  "EVENT_CLOSED",
  "INVALID_EVENT_TRANSITION",
  "ALREADY_ENROLLED",
  "INVITATIONS_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const PublicErrorCodeSchema = z.enum(PUBLIC_ERROR_CODES);
export const PublicErrorSchema = z.strictObject({
  version: z.literal(1),
  code: PublicErrorCodeSchema,
});
export type PublicErrorCode = z.infer<typeof PublicErrorCodeSchema>;
export type PublicErrorData = z.infer<typeof PublicErrorSchema>;
