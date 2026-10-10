export interface WorkerConfig {
  readonly convexUrl: string;
  readonly workerToken: string;
  readonly model: string;
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

  return { convexUrl, workerToken, model };
}

function invalidConvexUrl(): WorkerConfigError {
  return new WorkerConfigError(
    "CONVEX_URL must be an HTTP(S) URL without credentials, query parameters, or a fragment",
  );
}
