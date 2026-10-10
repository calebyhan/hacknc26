import { readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

// Manual setup, before a demo. No administrator identity overrides or fake
// consent: every operation calls the same authenticated app API as the app.
const operations = {
  register: ["mutation", api.accounts.register],
  "begin-phone-link": ["mutation", api.accounts.beginPhoneLink],
  "complete-phone-link": ["mutation", api.accounts.completePhoneLink],
  "create-event": ["mutation", api.events.create],
  "confirm-event": ["mutation", api.events.confirmDraft],
  "create-task": ["mutation", api.tasks.create],
  "organizer-invitation": ["mutation", api.events.organizerInvitation],
  "invite-contacts": ["mutation", api.invitations.createForContacts],
  "approve-proposal": ["mutation", api.proposals.approve],
  status: ["query", api.events.myEvents],
  detail: ["query", api.events.detail],
};
const [operation, argsFile] = process.argv.slice(2);
if (!operation || operation === "--help" || operation === "help") {
  console.log("Manual Rally setup using an authenticated organizer session.");
  console.log("npm run domain:setup -- <operation> [private-args.local.json]");
  console.log(`Operations: ${Object.keys(operations).join(", ")}`);
  console.log("Set CONVEX_URL and RALLY_AUTH0_ID_TOKEN in your private environment. Never paste the token into chat.");
} else {
  try {
    const selected = operations[operation];
    if (!selected) throw new Error("UNKNOWN_OPERATION");
    const url = process.env.CONVEX_URL, token = process.env.RALLY_AUTH0_ID_TOKEN;
    if (!url || !token) throw new Error("AUTH_CONFIGURATION_REQUIRED");
    const args = argsFile ? JSON.parse(await readFile(argsFile, "utf8")) : {};
    const client = new ConvexHttpClient(url, { logger: false, auth: token });
    const result = await client[selected[0]](selected[1], args);
    // Returns only allowlisted app read models, record IDs and the invitation
    // codes the organizer explicitly requested; never prints credentials.
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const reason = error instanceof Error ? error.message.match(/\b(?:UNAUTHORIZED|UNKNOWN_OPERATION|AUTH_CONFIGURATION_REQUIRED|PHONE_[A-Z_]+|LINK_PHONE_BEFORE_CREATING_EVENTS|IDEMPOTENCY_CONFLICT|STALE_[A-Z_]+|EVENT_CLOSED|INVALID_[A-Z_]+|ALREADY_ENROLLED)\b/u)?.[0] : undefined;
    console.error(`Setup failed${reason ? `: ${reason}` : ". Check the session, arguments and server logs"}.`);
    process.exitCode = 1;
  }
}
