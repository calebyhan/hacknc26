import { z } from "zod";
import { TextReferenceSchema } from "./primitives";

export const CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("JOIN"), code: z.string().min(1).max(128) }),
  z.strictObject({ type: z.literal("YES") }),
  z.strictObject({ type: z.literal("NO") }),
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
    if (["YES", "NO", "STATUS", "HELP", "STOP", "PAUSE", "RESUME"].includes(simple)) {
      return CommandSchema.parse({ type: simple });
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
