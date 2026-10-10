import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));
function convex(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", windowsHide: true });
}
const result = convex(["env", "list"]);
if (result.status !== 0) {
  console.error("Cannot access the configured Convex deployment. Accept your team invitation and sign in with npx convex dev, then rerun this command.");
  process.exit(1);
}
// Inspect server secrets in memory; never print values or CLI error bodies.
const configured = new Map(result.stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const missing = ["SPECTRUM_PROJECT_ID", "SPECTRUM_PROJECT_SECRET", "SPECTRUM_WEBHOOK_SECRET"].filter((name) => !configured.get(name));
if (missing.length) {
  console.error(`Set these server-side in the selected Convex development deployment: ${missing.join(", ")}`);
  process.exit(1);
}
if (!configured.get("RALLY_MESSAGING_KEY")) {
  const key = randomBytes(32).toString("hex");
  const saved = convex(["env", "set", "RALLY_MESSAGING_KEY", key]);
  if (saved.status !== 0) {
    console.error("Could not configure RALLY_MESSAGING_KEY. No secret values are printed.");
    process.exit(1);
  }
  console.log("Created the server-only messaging encryption and invitation key.");
} else if (!/^[a-f0-9]{64}$/i.test(configured.get("RALLY_MESSAGING_KEY"))) {
  console.error("RALLY_MESSAGING_KEY must be 64 hex characters. Preserve an existing valid key; rotating it makes stored inbox envelopes unreadable.");
  process.exit(1);
} else console.log("Existing messaging key preserved.");
console.log("Messaging configuration is present. Next: npx convex dev --once, then configure Photon's native webhook at <this-deployment>.convex.site/spectrum/webhook.");
