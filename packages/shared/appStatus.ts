import { z } from "zod";
import { MembershipStateSchema, MessagingStateSchema, OutboundStateSchema } from "./enums";
import { IdentifierSchema, PhoneE164Schema, TimestampSchema } from "./primitives";

export const AppProgressSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  needsCoverage: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
}).refine(value => value.total === value.confirmed + value.needsCoverage + value.completed + value.canceled);

export const AppMessagingStatusSchema = z.strictObject({
  membershipState: MembershipStateSchema,
  consentRecorded: z.boolean(),
  notificationsEnabled: z.boolean(),
  messagingState: MessagingStateSchema,
  // This records notification permission, not a transport/delivery guarantee.
  canReceiveMessages: z.boolean(),
});

export const AppRouteSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), destination: PhoneE164Schema, expiresAt: TimestampSchema }),
  z.strictObject({ status: z.literal("unavailable") }),
]);

// All activity copy is static. Neither audit payloads nor message content belong
// in the status API. Delivery timestamps describe creation, not receipt time.
export const appDomainActivityTitles = [
  "Event created", "Event confirmed", "Task created", "Request created",
  "Organizer approval recorded", "Request expired", "Request replaced", "Request canceled",
  "Request declined", "Task change approved", "Task change committed", "Assignment committed",
  "Commitment canceled", "Commitment recorded", "Invitee draft added",
] as const;
export const AppActivityItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ id: IdentifierSchema, kind: z.literal("domain"), at: TimestampSchema, title: z.enum(appDomainActivityTitles) }),
  z.strictObject({ id: IdentifierSchema, kind: z.literal("delivery"), at: TimestampSchema, title: z.literal("Message created for you"), deliveryState: OutboundStateSchema }),
]);
export const AppEventStatusSchema = z.strictObject({
  eventId: IdentifierSchema,
  progress: AppProgressSchema,
  messaging: AppMessagingStatusSchema,
  route: AppRouteSchema,
  activity: z.array(AppActivityItemSchema).max(30),
});
export const AppProgressSummarySchema = z.strictObject({ eventId: IdentifierSchema, progress: AppProgressSchema });
export const AppOverviewSchema = z.array(AppProgressSummarySchema);

export type AppProgress = z.infer<typeof AppProgressSchema>;
export type AppRoute = z.infer<typeof AppRouteSchema>;
export type AppActivityItem = z.infer<typeof AppActivityItemSchema>;

export const ProvisionedRouteInputSchema = z.strictObject({
  participantPhoneE164: PhoneE164Schema,
  destination: PhoneE164Schema,
  verifiedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  providerReference: z.string().trim().min(1).max(256),
}).refine(value => value.destination !== value.participantPhoneE164);
