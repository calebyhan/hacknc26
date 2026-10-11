import { z } from "zod";
import { PhoneE164Schema } from "./primitives";

export const SETUP_TTL_MS = 15 * 60_000;
const boundedText = z.string().trim().min(1).max(120);
export const WizardStateSchema = z.strictObject({
  flow: z.enum(["event", "invite", "task"]),
  step: z.enum(["event", "title", "when", "timezone", "location", "name", "phone", "start", "end", "capacity", "review", "next_task"]),
  eventId: z.string().optional(), expectedVersion: z.number().int().positive().optional(),
  eventChoices: z.array(z.string()).max(20).optional(),
  title: boundedText.optional(), timezone: z.string().max(120).optional(),
  localTime: z.string().max(120).optional(), startsAt: z.number().int().nonnegative().optional(),
  location: boundedText.optional(), displayName: boundedText.optional(),
  phoneE164: PhoneE164Schema.optional(),
  windowStart: z.number().int().nonnegative().optional(), windowEnd: z.number().int().nonnegative().optional(),
  capacity: z.number().int().min(1).max(20).optional(),
});
export type WizardState = z.infer<typeof WizardStateSchema>;

export const normalizeSetupConfirmation = (text: string): string => text.trim().toLowerCase().replace(/[.!?]+$/u, "").trim().replace(/\s+/gu, " ");
/** The explicit reviewed opt-in phrase, shared by writes and status evidence. */
export const reviewedCreateConfirmation = (text: string): boolean => normalizeSetupConfirmation(text) === "yes, create it";

export function parseWizardStart(text: string): WizardState["flow"] | null {
  const value = text.trim().replace(/[.!?]+$/u, "").toLowerCase();
  if (/^(create (?:an? )?event|new event|plan an event)$/u.test(value)) return "event";
  if (/^(invite someone|invite a (?:person|friend)|add a person)$/u.test(value)) return "invite";
  if (/^(add a task|new task|create a task)$/u.test(value)) return "task";
  return null;
}

/** An optional next-task prompt must not turn normal coordination into a title.
 * Keep this conservative; the explicit add-a-task flow accepts unusual titles. */
export function taskContinuationInput(text: string): "title" | "conversation" | "invalid" {
  const value = text.trim().replace(/[’‘]/gu, "'");
  if (/^(?:I|I'll|I'm|I've|we|we'll|we're|you|yes|no|thanks|okay|ok|sure|can|could|would|will|please|who|what|what's|where|when|why|how|is|are|do|does|did|should|let's|let us|ask|assign|reassign|move|change|switch|cancel|reschedule|remove|drop|accept|decline|approve|join|leave|confirm|status|help|stop|pause|resume|invite|create|add|plan|show|list|give|send|tell|remind|replace)\b/iu.test(value)
    || /\b(?:can|could|would|should|instead|please|someone|somebody)\b/iu.test(value) || /\?/u.test(value)) return "conversation";
  return value.length >= 1 && value.length <= 120 && !/[\r\n|]/u.test(value) && /^\p{L}/u.test(value) ? "title" : "invalid";
}

export function normalizeSelectedPhone(input: string): { phone?: string; error?: string } {
  const value = input.trim();
  if (!value.startsWith("+")) return { error: "Include the country code, for example +1 (555) 000-0002. I won't guess a country." };
  if (!/^\+[\d\s().-]+$/u.test(value)) return { error: "Use digits with a leading + country code. Spaces, parentheses and dashes are okay; extensions aren't supported." };
  const phone = value.replace(/[\s().-]/gu, "");
  if (!PhoneE164Schema.safeParse(phone).success) return { error: "That phone needs 8–15 digits after +, beginning with its country code." };
  return { phone };
}

const zones: Readonly<Record<string, string>> = {
  eastern: "America/New_York", "eastern time": "America/New_York", et: "America/New_York",
  central: "America/Chicago", "central time": "America/Chicago", ct: "America/Chicago",
  mountain: "America/Denver", "mountain time": "America/Denver", mt: "America/Denver",
  pacific: "America/Los_Angeles", "pacific time": "America/Los_Angeles", pt: "America/Los_Angeles",
  utc: "UTC", london: "Europe/London",
};
export function parseTimezone(text: string): string | null {
  const value = text.trim(), candidate = zones[value.toLowerCase()] ?? value;
  // Ambiguous abbreviations such as CST/IST are not accepted as a location.
  if (candidate !== "UTC" && !candidate.includes("/")) return null;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone; } catch { return null; }
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNames = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const friendlyPattern = new RegExp(`^(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4})(?:\\s+at)?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)$`, "iu");
export const friendlyDateHelp = "Use a clear date and time, like Oct 18, 2026 at 2 PM. Include the year and AM or PM; I won't guess numeric dates or 'tomorrow'.";
function dateParts(timestamp: number, timezone: string) {
  const entries = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const part = (key: string) => Number(entries.find(item => item.type === key)!.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

/** Explicit small grammar and exact timezone conversion. Ambiguous DST times
 * are rejected, never silently assigned a daylight-saving offset. */
export function parseFriendlyInstant(input: string, timezone: string, anchor?: number): { timestamp?: number; error?: string } {
  const zone = parseTimezone(timezone);
  if (!zone) return { error: "Choose a valid timezone first, such as Eastern or America/New_York." };
  const value = input.trim();
  let year: number, month: number, day: number, hour: number, minute: number, meridiem: string;
  const friendly = friendlyPattern.exec(value);
  const numeric = /^(\d{4})-(\d{2})-(\d{2})(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/iu.exec(value);
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/iu.exec(value);
  if (friendly) {
    year = Number(friendly[3]); month = months.indexOf(friendly[1]!.slice(0, 3).toLowerCase()) + 1; day = Number(friendly[2]); hour = Number(friendly[4]); minute = Number(friendly[5] ?? 0); meridiem = friendly[6]!;
  } else if (numeric) {
    year = Number(numeric[1]); month = Number(numeric[2]); day = Number(numeric[3]); hour = Number(numeric[4]); minute = Number(numeric[5] ?? 0); meridiem = numeric[6]!;
  } else if (clock && anchor !== undefined) {
    ({ year, month, day } = dateParts(anchor, zone)); hour = Number(clock[1]); minute = Number(clock[2] ?? 0); meridiem = clock[3]!;
  } else return { error: friendlyDateHelp };
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return { error: "That date or time isn't valid. " + friendlyDateHelp };
  hour = hour % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(local).getUTCDate() !== day) return { error: "That day doesn't exist in that month. " + friendlyDateHelp };
  const expected = { year, month, day, hour, minute }, matches: number[] = [];
  for (let offsetMinutes = -12 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const timestamp = local - offsetMinutes * 60_000;
    if (JSON.stringify(dateParts(timestamp, zone)) === JSON.stringify(expected)) matches.push(timestamp);
  }
  if (matches.length !== 1) return { error: "That local time is skipped or repeated when clocks change. Choose another time so I don't guess the offset." };
  return { timestamp: matches[0]! };
}

export function formatLocalDate(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(timestamp);
}
