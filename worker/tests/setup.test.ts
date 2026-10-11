import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { configureWorker, type ConvexCommand } from "../src/setup.ts";

const dirs: string[] = [];
const serverToken = "fixture-server-worker-token-".repeat(3);
const localToken = "fixture-local-worker-token-".repeat(3);
async function fixture(extra = "", deployment = "dev:fixture-dev") {
  const root = await mkdtemp(join(tmpdir(), "rally-setup-test-")); dirs.push(root);
  const text = `# preserve operator comments\nCONVEX_DEPLOYMENT=${deployment} # team: fixture\nCONVEX_URL=https://fixture-dev.convex.cloud\nRALLY_PROVIDER=codex\n${extra}`;
  await writeFile(join(root, ".env.local"), text, { mode: 0o644 });
  return { root, text, env: join(root, ".env.local") };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe("operator-only private worker configuration", () => {
  it("preserves the server credential and other local settings with private file permissions", async () => {
    const f = await fixture(`RALLY_WORKER_TOKEN=${localToken}\n`);
    const calls: readonly string[][] = [];
    const run: ConvexCommand = args => { (calls as string[][]).push([...args]); return { status: 0, stdout: `${serverToken}\n` }; };
    expect(await configureWorker(f.root, run)).toEqual({ deployment: "fixture-dev", created: false });
    expect(calls).toEqual([["env", "get", "RALLY_WORKER_TOKEN", "--deployment", "fixture-dev"]]);
    const text = await readFile(f.env, "utf8");
    expect(text).toContain("# preserve operator comments"); expect(text).toContain("RALLY_PROVIDER=codex");
    expect(parseEnv(text).RALLY_WORKER_TOKEN).toBe(serverToken);
    expect((await stat(f.env)).mode & 0o777).toBe(0o600);
  });
  it("creates an absent server credential using a private file, not argv, then verifies it", async () => {
    const f = await fixture(); let current = ""; let secretFile = "";
    const run: ConvexCommand = async args => {
      if (args[1] === "get") return { status: 0, stdout: current };
      expect(args).not.toContain("--force"); expect(args).toContain("--deployment");
      secretFile = args[args.indexOf("--from-file") + 1]!;
      expect((await stat(secretFile)).mode & 0o777).toBe(0o600);
      current = parseEnv(await readFile(secretFile, "utf8")).RALLY_WORKER_TOKEN!;
      expect(current).toMatch(/^[a-f0-9]{64}$/); expect(args.join(" ")).not.toContain(current);
      return { status: 0, stdout: "" };
    };
    expect(await configureWorker(f.root, run)).toEqual({ deployment: "fixture-dev", created: true });
    expect(parseEnv(await readFile(f.env, "utf8")).RALLY_WORKER_TOKEN).toBe(current);
    await expect(stat(secretFile)).rejects.toThrow();
  });
  it("reuses a valid local credential only when no server credential exists", async () => {
    const f = await fixture(`RALLY_WORKER_TOKEN=${localToken}\n`); let current = "";
    const run: ConvexCommand = async args => {
      if (args[1] === "get") return { status: 0, stdout: current };
      current = parseEnv(await readFile(args[args.indexOf("--from-file") + 1]!, "utf8")).RALLY_WORKER_TOKEN!;
      return { status: 0, stdout: "" };
    };
    await configureWorker(f.root, run); expect(current).toBe(localToken);
  });
  it.each(["prod:fixture-dev", "dev:other-dev"])("rejects a production or mismatched deployment before accessing server secrets: %s", async deployment => {
    const f = await fixture("", deployment); let called = false;
    await expect(configureWorker(f.root, () => { called = true; return { status: 0, stdout: serverToken }; })).rejects.toThrow("DEVELOPMENT_TARGET_REQUIRED");
    expect(called).toBe(false);
  });
  it("does not replace the local credential when the CLI refuses a conflicting server write", async () => {
    const f = await fixture(`RALLY_WORKER_TOKEN=${localToken}\n`);
    await expect(configureWorker(f.root, args => args[1] === "get" ? { status: 0, stdout: "" } : { status: 1, stdout: serverToken })).rejects.toThrow("SERVER_WRITE_FAILED");
    expect(await readFile(f.env, "utf8")).toBe(f.text);
  });
  it("refuses to save a value that fails server read-back verification", async () => {
    const f = await fixture(); let reads = 0;
    await expect(configureWorker(f.root, args => ({ status: 0, stdout: args[1] === "get" && ++reads > 1 ? serverToken : "" }))).rejects.toThrow("SERVER_VERIFICATION_FAILED");
    expect(await readFile(f.env, "utf8")).toBe(f.text);
  });
  it("never substitutes a new key when reading the existing server credential fails", async () => {
    const f = await fixture();
    await expect(configureWorker(f.root, () => ({ status: 1, stdout: serverToken }))).rejects.toThrow("SERVER_READ_FAILED");
    expect(await readFile(f.env, "utf8")).toBe(f.text);
  });
  it("rejects an invalid existing server credential without rotation or disclosure", async () => {
    const f = await fixture();
    await expect(configureWorker(f.root, () => ({ status: 0, stdout: "short" }))).rejects.toThrow("SERVER_CREDENTIAL_INVALID");
    expect(await readFile(f.env, "utf8")).toBe(f.text);
  });
});
