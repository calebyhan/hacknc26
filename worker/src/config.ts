export interface WorkerConfig {
  readonly convexUrl: string;
  readonly workerToken: string;
  readonly model: string;
  readonly provider: "claude" | "codex";
}

export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

const requiredVariables = ["CONVEX_URL", "RALLY_WORKER_TOKEN", "RALLY_MODEL"] as const;

/** Validate configuration without logging values or making provider calls. */
export function loadWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  const missing = requiredVariables.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new WorkerConfigError(`Missing worker configuration: ${missing.join(", ")}`);
  }

  for (const name of requiredVariables) {
    if (environment[name] !== environment[name]?.trim()) {
      throw new WorkerConfigError(`${name} must not contain leading or trailing whitespace`);
    }
  }

  // The required-value check above rejects empty fallbacks before reaching here.
  const convexUrl = environment.CONVEX_URL ?? "";
  const workerToken = environment.RALLY_WORKER_TOKEN ?? "";
  const model = environment.RALLY_MODEL ?? "";
  const provider = environment.RALLY_PROVIDER ?? "claude";
  if (provider !== "claude" && provider !== "codex") throw new WorkerConfigError("RALLY_PROVIDER must be claude or codex");
  if (environment.ANTHROPIC_API_KEY) throw new WorkerConfigError("ANTHROPIC_API_KEY is not authorized for the subscription worker");
  if (environment.OPENAI_API_KEY || environment.CODEX_API_KEY) throw new WorkerConfigError("OpenAI API keys are not authorized for the subscription worker");
  if (workerToken.length < 32 || workerToken.length > 512) throw new WorkerConfigError("RALLY_WORKER_TOKEN must contain 32–512 characters");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(model)) throw new WorkerConfigError("RALLY_MODEL must be a model name or alias");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(convexUrl);
  } catch {
    throw invalidConvexUrl();
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw invalidConvexUrl();
  }

  return { convexUrl, workerToken, model, provider };
}

function invalidConvexUrl(): WorkerConfigError {
  return new WorkerConfigError(
    "CONVEX_URL must be an HTTP(S) URL without credentials, query parameters, or a fragment",
  );
}
