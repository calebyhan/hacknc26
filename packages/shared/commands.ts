import { z } from "zod";
import { TextReferenceSchema } from "./primitives";

export const CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("JOIN"), code: z.string().min(1).max(128) }),
  z.strictObject({ type: z.literal("YES"), proposalRef: TextReferenceSchema.optional() }),
  z.strictObject({ type: z.literal("NO"), proposalRef: TextReferenceSchema.optional() }),
  z.strictObject({ type: z.literal("CONFIRM_OVERLAP"), proposalRef: TextReferenceSchema }),
  z.strictObject({ type: z.literal("STATUS") }),
  z.strictObject({ type: z.literal("HELP") }),
  z.strictObject({ type: z.literal("STOP") }),
  z.strictObject({ type: z.literal("PAUSE") }),
  z.strictObject({ type: z.literal("RESUME") }),
  z.strictObject({ type: z.literal("LEAVE"), eventRef: TextReferenceSchema }),
  z.strictObject({ type: z.literal("UNKNOWN"), text: z.string() }),
]);
export type Command = z.infer<typeof CommandSchema>;

export function parseCommand(text: string): Command {
  const trimmed = text.trim().replace(/[.!?,;:]+$/u, "").trim();
  if (!/[\r\n]/u.test(trimmed)) {
    const simple = trimmed.toUpperCase();
    const casual = trimmed.toLowerCase().replace(/[’‘]/gu, "'").replace(/\s+/gu, " ");
    if (["whats my status", "what's my status", "show my status", "my status", "what am i assigned to"].includes(casual)) return { type: "STATUS" };
    if (["YES", "NO", "STATUS", "HELP", "STOP", "PAUSE", "RESUME"].includes(simple)) {
      return CommandSchema.parse({ type: simple });
    }
    const response = /^(YES|NO|CONFIRM\s+OVERLAP)\s+(.+)$/iu.exec(trimmed);
    if (response) {
      // Common conversational qualifiers aren't an explicit offer response.
      // A task with one of these names can still be answered by offer ID.
      if (/^(?:yes\s+(?:but|if|maybe|probably)\b|no\s+(?:problem|worries|thanks|thank you)\b)/iu.test(trimmed)) return { type: "UNKNOWN", text };
      const parsed = CommandSchema.safeParse({ type: response[1]!.toUpperCase().replace(/\s+/gu, "_"), proposalRef: response[2] });
      if (parsed.success) return parsed.data;
    }
    const match = /^(JOIN|LEAVE)\s+(.+)$/iu.exec(trimmed);
    if (match) {
      const parsed = CommandSchema.safeParse(match[1]!.toUpperCase() === "JOIN"
        ? { type: "JOIN", code: match[2] }
        : { type: "LEAVE", eventRef: match[2] });
      if (parsed.success) return parsed.data;
    }
  }
  return { type: "UNKNOWN", text };
}

/** Resolve only inside a caller-authorized candidate set, and require uniqueness. */
export function proposalReferenceMatches(reference: string, proposalId: string, taskTitle?: string, eventTitle?: string): boolean {
  const normalized = reference.trim().toLocaleLowerCase();
  return normalized === proposalId.toLocaleLowerCase()
    || normalized === proposalId.slice(-6).toLocaleLowerCase()
    || normalized === taskTitle?.toLocaleLowerCase()
    || !!taskTitle && !!eventTitle && normalized === `${taskTitle} for ${eventTitle}`.toLocaleLowerCase();
}

/** Only the native, signed inbound DM subset enters Rally's command pipeline. */
export const PhotonTextMessageSchema = z.looseObject({
  id: z.string().min(1).max(256),
  platform: z.enum(["iMessage", "imessage"]),
  direction: z.literal("inbound"),
  sender: z.looseObject({ id: z.string().regex(/^\+[1-9]\d{7,14}$/) }),
  space: z.looseObject({ id: z.string().min(1).max(256), type: z.literal("dm"), phone: z.string().optional() }),
  content: z.looseObject({ type: z.literal("text"), text: z.string().max(4_000) }),
});

/** This minimized record is encrypted before crossing the durable inbox API. */
export const InboundEnvelopeSchema = z.strictObject({
  text: z.string().max(4_000),
  spaceId: z.string().min(1).max(256),
  linePhone: z.string().optional(),
});
export type InboundEnvelope = z.infer<typeof InboundEnvelopeSchema>;
