import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "convex");
const registrations = [];

// Read actual exported registrations, including visibility, from the source.
// Keep direct registration calls in the contract modules so this stays reviewable.
for (const entry of (await readdir(directory)).sort()) {
  if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
  const source = await readFile(path.join(directory, entry), "utf8");
  const exports = source.matchAll(
    /export\s+const\s+(\w+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*\(/g,
  );
  for (const [, name, registration] of exports) {
    const visibility = registration.startsWith("internal") ? "internal" : "public";
    const kind = registration.replace(/^internal/, "").toLowerCase();
    registrations.push(`${entry.slice(0, -3)}.${name}\t${visibility} ${kind}`);
  }
}

if (registrations.length === 0) throw new Error("No Convex contract functions found");
console.log(registrations.join("\n"));
const auth = await readFile(path.join(directory, "lib/auth.ts"), "utf8");
for (const [, name] of auth.matchAll(/export\s+(?:async\s+)?function\s+(require\w+)\s*\(/g)) {
  console.log(`lib/auth.${name}\thelper`);
}
console.log(`\n${registrations.length} registered Convex functions (from source).`);
