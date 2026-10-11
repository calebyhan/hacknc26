import { z } from "zod";
import { IdentifierSchema, PhoneE164Schema, TextReferenceSchema, VersionSchema } from "./primitives";

// Explicit offsets avoid interpreting an organizer's wall-clock time in the
// worker's timezone. The named zone is retained for display and event context.
const InstantSchema = z.iso.datetime({ offset: true }).transform(value => Date.parse(value));
const TimezoneSchema = TextReferenceSchema.refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Invalid timezone");
export const PhoneSetupCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("CREATE_EVENT"), title: TextReferenceSchema, startsAt: InstantSchema, timezone: TimezoneSchema, location: TextReferenceSchema.optional() }),
  z.strictObject({ type: z.literal("CONFIRM_EVENT"), eventId: IdentifierSchema, expectedVersion: VersionSchema }),
  z.strictObject({ type: z.literal("CREATE_TASK"), eventRef: TextReferenceSchema, title: TextReferenceSchema, windowStart: InstantSchema, windowEnd: InstantSchema }).refine(input => input.windowEnd > input.windowStart, "Invalid window"),
  z.strictObject({ type: z.literal("INVITE_CONTACT"), eventRef: TextReferenceSchema, displayName: TextReferenceSchema, phoneE164: PhoneE164Schema }),
  z.strictObject({ type: z.literal("APPROVE_PROPOSAL"), proposalId: IdentifierSchema }),
  z.strictObject({ type: z.literal("INVALID") }),
]);
export type PhoneSetupCommand = z.infer<typeof PhoneSetupCommandSchema>;
export const PhoneSetupReceiptSchema = z.strictObject({ contentHash: z.string().regex(/^[a-f0-9]{64}$/u) });

/** Additive setup grammar; the frozen everyday CommandSchema stays unchanged. */
export function parsePhoneSetupCommand(text: string): PhoneSetupCommand | null {
  const value = text.trim();
  const prefix = /^(CREATE EVENT|CONFIRM|TASK|INVITE|APPROVE)(?:\s|$)/iu.exec(value);
  if (!prefix) return null;
  if (/[\r\n]/u.test(value)) return { type: "INVALID" };
  const command = prefix[1]!.toUpperCase(), rest = value.slice(prefix[1]!.length).trim();
  const fields = rest.split("|").map(field => field.trim());
  let raw: unknown;
  if (command === "CREATE EVENT" && (fields.length === 3 || fields.length === 4)) raw = { type: "CREATE_EVENT", title: fields[0], startsAt: fields[1], timezone: fields[2], ...(fields.length === 4 ? { location: fields[3] } : {}) };
  if (command === "TASK" && fields.length === 4) raw = { type: "CREATE_TASK", eventRef: fields[0], title: fields[1], windowStart: fields[2], windowEnd: fields[3] };
  if (command === "INVITE" && fields.length === 3) raw = { type: "INVITE_CONTACT", eventRef: fields[0], displayName: fields[1], phoneE164: fields[2] };
  const confirm = command === "CONFIRM" ? /^(\S+) ([1-9]\d*)$/u.exec(rest) : null;
  if (confirm) raw = { type: "CONFIRM_EVENT", eventId: confirm[1], expectedVersion: Number(confirm[2]) };
  if (command === "APPROVE" && /^\S+$/u.test(rest)) raw = { type: "APPROVE_PROPOSAL", proposalId: rest };
  const parsed = PhoneSetupCommandSchema.safeParse(raw);
  return parsed.success ? parsed.data : { type: "INVALID" };
}

export const phoneSetupUsageCopy = "Create a draft: CREATE EVENT <title> | <ISO date/time with offset> | <timezone> | <location>. Example: CREATE EVENT Picnic | 2026-10-12T14:00:00-04:00 | America/New_York | Park. Then follow the JOIN and CONFIRM instructions. Organizers can use TASK <event> | <title> | <start ISO> | <end ISO>, INVITE <event> | <name> | <phone in +country format>, or APPROVE <proposal ID>.";
export const phoneSetupErrorCopy = "I couldn't complete that setup command. Check the format, event name, and version. Only an enrolled, opted-in organizer can confirm events, add tasks, invite people, or approve proposals. No assignment was changed.";
