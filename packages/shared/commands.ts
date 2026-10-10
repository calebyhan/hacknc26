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

export function parseCommand(_text: string): Command {
  throw new Error("NOT_IMPLEMENTED(lane-a)");
}
