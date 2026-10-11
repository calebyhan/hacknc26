import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

type CommandResult = { status: number | null; stdout: string };
export type ConvexCommand = (args: readonly string[]) => CommandResult | Promise<CommandResult>;
const tokenPattern = /^[A-Za-z0-9_.:/+=-]{32,512}$/;

export function developmentTarget(config: Record<string, string | undefined>): string {
  const deployment = /^dev:([a-z0-9-]+)$/.exec(config.CONVEX_DEPLOYMENT ?? "")?.[1];
  if (!deployment || config.CONVEX_URL !== `https://${deployment}.convex.cloud`) throw new Error("DEVELOPMENT_TARGET_REQUIRED");
  return deployment;
}

export function convexCommand(root: string): ConvexCommand {
  const cli = join(root, "node_modules/convex/bin/main.js");
  return args => {
    const env = { ...process.env };
    delete env.CONVEX_DEPLOY_KEY; delete env.CONVEX_SELF_HOSTED_URL; delete env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576 });
    return { status: result.status, stdout: result.stdout ?? "" };
  };
}

/** Operator setup only. This module is never imported by the inference runtime. */
export async function configureWorker(root: string, runConvex: ConvexCommand): Promise<{ deployment: string; created: boolean }> {
  const envFile = join(root, ".env.local");
  if (!(await lstat(envFile)).isFile()) throw new Error("LOCAL_CONFIG_REQUIRED");
  const original = await readFile(envFile, "utf8"), config = parseEnv(original);
  const deployment = developmentTarget(config);
  await chmod(envFile, 0o600);
  const target = ["--deployment", deployment];
  async function readServer() {
    const result = await runConvex(["env", "get", "RALLY_WORKER_TOKEN", ...target]);
    if (result.status !== 0) throw new Error("SERVER_READ_FAILED");
    return result.stdout.trim();
  }
  let token = await readServer(); const created = token === "";
  if (token && !tokenPattern.test(token)) throw new Error("SERVER_CREDENTIAL_INVALID");
  const privateDir = await mkdtemp(join(root, ".worker-setup-"));
  try {
    if (created) {
      token = config.RALLY_WORKER_TOKEN || randomBytes(32).toString("hex");
      if (!tokenPattern.test(token)) throw new Error("LOCAL_CREDENTIAL_INVALID");
      const credentialFile = join(privateDir, "credential.env");
      await writeFile(credentialFile, `RALLY_WORKER_TOKEN=${token}\n`, { mode: 0o600, flag: "wx" });
      // Multi-variable mode refuses existing differing values without --force.
      // Secret values and raw CLI output never enter argv or operator logs.
      const result = await runConvex(["env", "set", "--from-file", credentialFile, ...target]);
      if (result.status !== 0) throw new Error("SERVER_WRITE_FAILED");
      if (await readServer() !== token) throw new Error("SERVER_VERIFICATION_FAILED");
    }
    const lines = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?RALLY_WORKER_TOKEN\s*=/.test(line));
    const next = `${lines.join("\n").trimEnd()}\nRALLY_WORKER_TOKEN=${token}\n`;
    const replacement = join(privateDir, "local.env");
    await writeFile(replacement, next, { mode: 0o600, flag: "wx" });
    await rename(replacement, envFile);
    return { deployment, created };
  } finally { await rm(privateDir, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const result = await configureWorker(root, convexCommand(root));
    console.info(`Worker credential ${result.created ? "created and verified" : "preserved"} for development deployment ${result.deployment}. Local configuration is private (0600).`);
  } catch (error) {
    const known = new Set(["LOCAL_CONFIG_REQUIRED", "DEVELOPMENT_TARGET_REQUIRED", "SERVER_READ_FAILED", "SERVER_CREDENTIAL_INVALID", "LOCAL_CREDENTIAL_INVALID", "SERVER_WRITE_FAILED", "SERVER_VERIFICATION_FAILED"]);
    const category = error instanceof Error && known.has(error.message) ? error.message : "SETUP_FAILED";
    console.error(`Worker setup failed: ${category}. Verify local development selection and Convex login. No credential values were logged.`);
    process.exitCode = 1;
  }
}
