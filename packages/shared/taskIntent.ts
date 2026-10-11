import { z } from "zod";

export const TaskStaffingIntentSchema = z.enum(["add", "replace", "ambiguous", "unspecified"]);
export type TaskStaffingIntent = z.infer<typeof TaskStaffingIntentSchema>;

/** Conservative cues in verified participant text, used only to reject an
 * incompatible model action. This never authorizes a proposal or acceptance;
 * callers still resolve the task/person, capacity, membership and versions. */
export function classifyTaskStaffingIntent(text: string): TaskStaffingIntent {
  const normalized = text.toLowerCase().replace(/[’‘]/gu, "'");
  // A request to add somebody "without replacing" the current person is still
  // additive. Remove only these explicit negated replacement phrases.
  const positive = normalized.replace(/\b(?:do not|don't|dont|not|never|without)\s+(?:replace|replacing|a replacement|taking over|take over)\b/gu, "");
  const additive = /\b(?:add|adding|join|joining|help|helping|also|too|together|alongside|additional|extra|team up)\b/iu.test(positive);
  const replacement = /\b(?:replace|replacing|replacement|instead|take over|taking over|cover for|swap|switch with|in place of)\b/iu.test(positive);
  if (!additive && !replacement) return "unspecified";
  if (/\b(?:do not|don't|dont|not|never|can't|cannot|won't|wouldn't|shouldn't|without)\b/iu.test(positive) || additive && replacement) return "ambiguous";
  return additive ? "add" : "replace";
}
