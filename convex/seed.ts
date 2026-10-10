import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation } from "./_generated/server";

const result = v.object({
  eventIds: v.array(v.id("events")),
  taskIds: v.array(v.id("tasks")),
  invitationIds: v.array(v.id("invitations")),
});

/**
 * Labeled simulated fixture setup only. Lane B must require server-authenticated
 * organizer identity and reuse authorized domain helpers (ADR-013). Invocation
 * from a CLI/admin context alone is never an identity or membership bypass.
 * Fixture enrollment represents simulation; real invitees must JOIN themselves.
 */
export const bootstrap = internalMutation({
  args: {},
  returns: result,
  handler: async (_ctx): Promise<Infer<typeof result>> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});
