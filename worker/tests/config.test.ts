import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkerConfig, WorkerConfigError } from "../src/config.ts";

const validEnvironment = {
  CONVEX_URL: "https://bootstrap-fixture.convex.cloud",
  RALLY_WORKER_TOKEN: "fake-worker-token-do-not-use",
  RALLY_MODEL: "test-model-no-provider",
};

describe("worker configuration", () => {
  it("loads the three explicit environment values without choosing a model", () => {
    expect(loadWorkerConfig(validEnvironment)).toEqual({
      convexUrl: validEnvironment.CONVEX_URL,
      workerToken: validEnvironment.RALLY_WORKER_TOKEN,
      model: validEnvironment.RALLY_MODEL,
    });
  });

  it("lists missing variables without disclosing configuration values", () => {
    expect(() => loadWorkerConfig({})).toThrow(
      "Missing worker configuration: CONVEX_URL, RALLY_WORKER_TOKEN, RALLY_MODEL",
    );
  });

  it.each(["CONVEX_URL", "RALLY_WORKER_TOKEN", "RALLY_MODEL"] as const)(
    "requires %s even when other configuration exists",
    (name) => {
      expect(() => loadWorkerConfig({ ...validEnvironment, [name]: undefined })).toThrow(
        new WorkerConfigError(`Missing worker configuration: ${name}`),
      );
      expect(() => loadWorkerConfig({ ...validEnvironment, [name]: " \t " })).toThrow(
        new WorkerConfigError(`Missing worker configuration: ${name}`),
      );
    },
  );

  it.each(["CONVEX_URL", "RALLY_WORKER_TOKEN", "RALLY_MODEL"] as const)(
    "rejects surrounding whitespace in %s rather than changing its value",
    (name) => {
      expect(() =>
        loadWorkerConfig({ ...validEnvironment, [name]: ` ${validEnvironment[name]} ` }),
      ).toThrow(`${name} must not contain leading or trailing whitespace`);
    },
  );

  it.each([
    "invalid-url-containing-a-secret",
    "file:///private/fixture",
    "ftp://example.invalid",
    "https://user:secret@example.invalid",
    "https://example.invalid?secret=do-not-log",
    "https://example.invalid#secret",
  ])("rejects invalid deployment URLs without echoing them", (convexUrl) => {
    let caught: unknown;
    try {
      loadWorkerConfig({ ...validEnvironment, CONVEX_URL: convexUrl });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkerConfigError);
    expect(String(caught)).toContain("CONVEX_URL must be an HTTP(S) URL");
    expect(String(caught)).not.toContain(convexUrl);
    expect(String(caught)).not.toContain(validEnvironment.RALLY_WORKER_TOKEN);
  });

  it("accepts a local Convex deployment URL", () => {
    expect(
      loadWorkerConfig({ ...validEnvironment, CONVEX_URL: "http://127.0.0.1:3210" }).convexUrl,
    ).toBe("http://127.0.0.1:3210");
  });
});

describe("worker entrypoint", () => {
  const entrypoint = fileURLToPath(new URL("../src/index.ts", import.meta.url));

  it("exits unsuccessfully with actionable missing configuration", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
      env: {},
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Missing worker configuration: CONVEX_URL, RALLY_WORKER_TOKEN, RALLY_MODEL",
    );
  });

  it("validates configuration and exits honestly without starting a worker", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
      env: validEnvironment,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("NOT_IMPLEMENTED(lane-c)");
    expect(result.stdout).toContain("no worker was started");
    for (const value of Object.values(validEnvironment)) {
      expect(result.stdout + result.stderr).not.toContain(value);
    }
  });

  it("does not leak secrets on invalid configuration", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
      env: { ...validEnvironment, CONVEX_URL: "not-a-url-secret" },
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CONVEX_URL must be an HTTP(S) URL");
    expect(result.stderr).not.toContain("not-a-url-secret");
    expect(result.stderr).not.toContain(validEnvironment.RALLY_WORKER_TOKEN);
  });
});
