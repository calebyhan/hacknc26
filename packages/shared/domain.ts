import { z } from "zod";
import { CommitmentStateSchema, EventStatusSchema, InvitationStateSchema, MembershipStateSchema, MessagingStateSchema, TaskStatusSchema } from "./enums";
import { IdentifierSchema, MemberRoleSchema, PhoneE164Schema, TextReferenceSchema, TimestampSchema, VersionSchema } from "./primitives";

export const SettingsSchema = z.strictObject({
  timezone: TextReferenceSchema.optional(),
  skills: z.array(TextReferenceSchema).optional(),
});
export const WeatherPolicySchema = z.strictObject({
  enabled: z.boolean(),
  condition: z.literal("precipitation_probability_gte"),
  thresholdPercent: z.number().min(0).max(100),
  leadTimeHours: z.number().positive(),
  alternative: z.strictObject({ type: z.literal("indoor_backup"), location: TextReferenceSchema }).optional(),
  version: VersionSchema,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// Plain records use `id`; only persistence adapters translate to/from Convex `_id`.
export const UserSchema = z.strictObject({
  id: IdentifierSchema,
  displayName: TextReferenceSchema,
  verifiedPhoneE164: PhoneE164Schema.optional(),
  createdAt: TimestampSchema,
  authSubject: IdentifierSchema.optional(),
  messagingState: MessagingStateSchema,
  messagingStateAt: TimestampSchema.optional(),
  settings: SettingsSchema,
});
export const EventSchema = z.strictObject({
  id: IdentifierSchema,
  title: TextReferenceSchema,
  kind: z.enum(["event", "project"]),
  startsAt: TimestampSchema,
  timezone: TextReferenceSchema,
  location: TextReferenceSchema.optional(),
  ownerId: IdentifierSchema,
  status: EventStatusSchema,
  version: VersionSchema,
  weatherPolicy: WeatherPolicySchema.optional(),
});
export const MembershipSchema = z.strictObject({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  eventId: IdentifierSchema,
  role: MemberRoleSchema,
  state: MembershipStateSchema,
  notificationsEnabled: z.boolean(),
  joinedAt: TimestampSchema.optional(),
  consentAt: TimestampSchema.optional(),
  consentSourceMessageId: IdentifierSchema.optional(),
});
export const TaskSchema = z.strictObject({
  id: IdentifierSchema,
  eventId: IdentifierSchema,
  title: TextReferenceSchema,
  windowStart: TimestampSchema.optional(),
  windowEnd: TimestampSchema.optional(),
  location: TextReferenceSchema.optional(),
  requiredSkills: z.array(TextReferenceSchema).optional(),
  capacity: z.number().int().positive(),
  dependsOnTaskIds: z.array(IdentifierSchema).optional(),
  status: TaskStatusSchema,
  version: VersionSchema,
}).refine((task) => task.windowStart === undefined || task.windowEnd === undefined || task.windowEnd > task.windowStart, {
  path: ["windowEnd"], message: "windowEnd must follow windowStart",
});
export const CommitmentSchema = z.strictObject({
  id: IdentifierSchema,
  eventId: IdentifierSchema,
  taskId: IdentifierSchema,
  participantId: IdentifierSchema,
  state: CommitmentStateSchema,
  sourceProposalId: IdentifierSchema.optional(),
  sourceMessageId: IdentifierSchema.optional(),
  createdAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
  endedByActorId: IdentifierSchema.optional(),
});
export const AvailabilitySchema = z.strictObject({
  id: IdentifierSchema,
  eventId: IdentifierSchema,
  userId: IdentifierSchema,
  windowStart: TimestampSchema,
  windowEnd: TimestampSchema,
  kind: z.enum(["available", "unavailable"]),
  source: z.enum(["self_reported", "organizer_reported"]),
  reportedByUserId: IdentifierSchema,
  sourceMessageId: IdentifierSchema.optional(),
  recordedAt: TimestampSchema,
}).refine((availability) => availability.windowEnd > availability.windowStart, {
  path: ["windowEnd"], message: "windowEnd must follow windowStart",
});
export const ContactSelectionSchema = z.strictObject({
  id: IdentifierSchema,
  ownerUserId: IdentifierSchema,
  eventId: IdentifierSchema.optional(),
  displayName: TextReferenceSchema,
  phoneE164: PhoneE164Schema,
  selectedAt: TimestampSchema,
  invitationId: IdentifierSchema.optional(),
});
export const InvitationSchema = z.strictObject({
  id: IdentifierSchema,
  purpose: z.enum(["event_invite", "app_phone_link"]),
  eventId: IdentifierSchema.optional(),
  inviterUserId: IdentifierSchema,
  contactSelectionId: IdentifierSchema.optional(),
  targetUserId: IdentifierSchema.optional(),
  codeHash: z.string().min(1),
  state: InvitationStateSchema,
  expiresAt: TimestampSchema,
  failedAttempts: z.number().int().nonnegative(),
  redeemedByPhoneE164: PhoneE164Schema.optional(),
  redeemedAt: TimestampSchema.optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type WeatherPolicy = z.infer<typeof WeatherPolicySchema>;
export type User = z.infer<typeof UserSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type ContactSelection = z.infer<typeof ContactSelectionSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;

export const IdempotencyKeySchema = z.string().trim().min(1).max(128);
/** Internal evidence only: never include this snapshot in an event's public read. */
export const OverlapSnapshotSchema = z.strictObject({
  eventVersion: VersionSchema,
  taskVersion: VersionSchema,
  windowStart: TimestampSchema,
  windowEnd: TimestampSchema,
  conflicts: z.array(z.strictObject({
    commitmentId: IdentifierSchema, taskId: IdentifierSchema, taskVersion: VersionSchema,
    windowStart: TimestampSchema, windowEnd: TimestampSchema,
  })),
});
export const OverlapWarningSchema = z.strictObject({
  snapshot: OverlapSnapshotSchema,
  sourceMessageId: IdentifierSchema,
  warnedAt: TimestampSchema,
  confirmedByMessageId: IdentifierSchema.optional(),
});
export type OverlapSnapshot = z.infer<typeof OverlapSnapshotSchema>;
export type OverlapWarning = z.infer<typeof OverlapWarningSchema>;
export const EventCreateInputSchema = z.strictObject({
  title: TextReferenceSchema, kind: z.enum(["event", "project"]), startsAt: TimestampSchema,
  timezone: TextReferenceSchema.refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid timezone"),
  location: TextReferenceSchema.optional(), weatherPolicy: WeatherPolicySchema.optional(), idempotencyKey: IdempotencyKeySchema,
});
export const TaskCreateInputSchema = z.strictObject({
  eventId: IdentifierSchema, title: TextReferenceSchema, location: TextReferenceSchema.optional(),
  windowStart: TimestampSchema.optional(), windowEnd: TimestampSchema.optional(),
  requiredSkills: z.array(TextReferenceSchema).max(20).optional(), capacity: z.number().int().min(1).max(20).optional(),
  dependsOnTaskIds: z.array(IdentifierSchema).max(20).optional(), expectedEventVersion: VersionSchema, idempotencyKey: IdempotencyKeySchema,
}).refine(input => (input.windowStart === undefined && input.windowEnd === undefined) || (input.windowStart !== undefined && input.windowEnd !== undefined && input.windowEnd > input.windowStart), "Invalid task window");
export const DisplayLabelSchema = z.enum(["draft", "waiting_to_join", "pending_approval", "awaiting_participant", "confirmed", "needs_coverage", "at_risk", "completed", "failed", "canceled"]);
