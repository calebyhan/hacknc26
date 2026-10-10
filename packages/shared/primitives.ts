import { z } from "zod";

// IDs are opaque strings at this boundary. Only trusted backend lookups resolve them.
export const IdentifierSchema = z.string().min(1).max(256);
export const TextReferenceSchema = z.string().trim().min(1).max(256);
export const TimestampSchema = z.number().int().nonnegative();
export const VersionSchema = z.number().int().positive();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const PhoneE164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const MemberRoleSchema = z.enum(["organizer", "member"]);

export const IsoTimeWindowSchema = z.strictObject({
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
}).refine((window) => Date.parse(window.endsAt) > Date.parse(window.startsAt), {
  message: "endsAt must follow startsAt",
  path: ["endsAt"],
});

export type IsoTimeWindow = z.infer<typeof IsoTimeWindowSchema>;
