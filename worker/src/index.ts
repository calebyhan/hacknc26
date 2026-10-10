import { loadWorkerConfig, WorkerConfigError } from "./config.ts";

try {
  loadWorkerConfig(process.env);
  console.info(
    "Rally worker configuration validated. NOT_IMPLEMENTED(lane-c): queue polling and inference are not implemented; no worker was started.",
  );
} catch (error) {
  console.error(
    error instanceof WorkerConfigError
      ? error.message
      : "Worker initialization failed. Configuration values were not logged.",
  );
  process.exitCode = 1;
}
