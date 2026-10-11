import { mkdtemp, chmod, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeInferenceProvider } from "../src/claude.ts";
import { exampleAgentDecision, exampleContextPacket } from "../../packages/shared/fixtures";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fakeExecutable(script: string) {
  const directory = await mkdtemp(join(tmpdir(), "rally-fake-cli-"));
  directories.push(directory);
  const executable = join(directory, "claude");
  await writeFile(executable, `#!${process.execPath}\n${script}`, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { directory, environment: { PATH: `${directory}:${process.env.PATH ?? ""}`, HOME: directory } };
}

describe("actual child-process runner with a fake Claude executable", () => {
  it("pipes JSON without a shell and removes its isolated working directory", async () => {
    const metadata = join(tmpdir(), `rally-fake-cli-observation-${crypto.randomUUID()}.json`);
    const fake = await fakeExecutable(`const fs = require('node:fs'); let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(metadata)}, JSON.stringify({input, cwd:process.cwd()})); process.stdout.write(${JSON.stringify(JSON.stringify({ result: JSON.stringify(exampleAgentDecision) }))}); });`);
    try {
      const provider = new ClaudeInferenceProvider({ model: "fixture-model", environment: fake.environment });
      expect(await provider.decide(exampleContextPacket)).toEqual(exampleAgentDecision);
      const observation = JSON.parse(await readFile(metadata, "utf8")) as { input: string; cwd: string };
      expect(observation.input).toBe(JSON.stringify(exampleContextPacket));
      expect(observation.cwd).not.toBe(process.cwd());
      await expect(stat(observation.cwd)).rejects.toThrow("ENOENT");
    } finally { await rm(metadata, { force: true }); }
  });
  it("terminates an unresponsive child instead of leaving inference running", async () => {
    const pidFile = join(tmpdir(), `rally-fake-cli-pid-${crypto.randomUUID()}`);
    const fake = await fakeExecutable(`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000);`);
    try {
      const provider = new ClaudeInferenceProvider({ model: "fixture-model", timeoutMs: 500, environment: fake.environment });
      await expect(provider.decide(exampleContextPacket)).rejects.toThrow("INFERENCE_TIMEOUT");
      const pid = Number(await readFile(pidFile, "utf8"));
      // Allow the operating system to reap the child before observing it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(pidFile, { force: true }); }
  });
  it("rejects excessive process output", async () => {
    const fake = await fakeExecutable("process.stdout.write('x'.repeat(70000));");
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", environment: fake.environment });
    await expect(provider.decide(exampleContextPacket)).rejects.toThrow("INVALID_DECISION");
  });
});
