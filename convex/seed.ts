import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation } from "./_generated/server";
import { api } from "./_generated/api";
import { requireUser } from "./lib/auth";
import { audit, priorRequest } from "./lib/domain";
import { seedFixture, SeedFixtureSchema } from "../packages/shared/fixtures";

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
  handler: async (ctx): Promise<Infer<typeof result>> => {
    const organizer = await requireUser(ctx), fixture = SeedFixtureSchema.parse(seedFixture);
    const source = `simulation-bootstrap:${organizer._id}:v1`;
    const prior = await priorRequest<Infer<typeof result>>(ctx, source, { fixtureVersion: 1 }); if (prior) return prior;
    const eventIds: Infer<typeof result>["eventIds"] = [], taskIds: Infer<typeof result>["taskIds"] = [], invitationIds: Infer<typeof result>["invitationIds"] = [];
    for (const template of fixture.events) {
      const eventId = await ctx.runMutation(api.events.create, { title: `[Simulation] ${template.title}`, kind: template.kind, startsAt: template.startsAt, timezone: template.timezone, ...(template.location ? { location: template.location } : {}), idempotencyKey: `simulation:${template.id}` });
      eventIds.push(eventId);
      for (const task of fixture.tasks.filter(task => task.eventId === template.id)) {
        taskIds.push(await ctx.runMutation(api.tasks.create, { eventId, title: task.title, ...(task.windowStart !== undefined ? { windowStart: task.windowStart } : {}), ...(task.windowEnd !== undefined ? { windowEnd: task.windowEnd } : {}), capacity: task.capacity, expectedEventVersion: 1, idempotencyKey: `simulation:${task.id}` }));
      }
      const contacts = fixture.memberships.filter(m => m.eventId === template.id && m.role !== "organizer").map(m => {
        const person = fixture.users.find(u => u.id === m.userId)!;
        const phoneE164 = person.verifiedPhoneE164 ?? fixture.contactSelections.find(c => c.eventId === template.id && c.displayName === person.displayName)!.phoneE164;
        return { displayName: `[Simulation] ${person.displayName}`, phoneE164 };
      });
      const invitations = await ctx.runMutation(api.invitations.createForContacts, { eventId, contacts, idempotencyKey: `simulation:${template.id}:contacts` });
      invitationIds.push(...invitations.map(invitation => invitation.invitationId));
    }
    const output = { eventIds, taskIds, invitationIds };
    await audit(ctx, eventIds[0]!, organizer._id, "simulation_bootstrap", source, { input: { fixtureVersion: 1 }, result: output });
    // Unlike the pure fixture, no fake phone is enrolled, no acceptance/consent
    // is fabricated, and no scheduled send or active commitment is created.
    return output;
  },
});
