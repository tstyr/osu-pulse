import { workerDelay } from "./worker-delay";

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
const STABLE_RUN_MS = 5 * 60_000;

/** Restart failed or unexpectedly completed workers, never overlapping runs. */
export async function runSupervisedWorker(
  name: string,
  task: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
) {
  let retryMs = INITIAL_RETRY_MS;
  while (!signal.aborted) {
    const startedAt = Date.now();
    let failure: unknown;
    try {
      await task(signal);
      failure = new Error(`${name} worker returned before shutdown`);
    } catch (error) {
      failure = error;
    }
    if (signal.aborted) break;
    // An occasional failure after a healthy run should recover promptly;
    // repeated startup failures back off instead of creating a retry loop.
    if (Date.now() - startedAt >= STABLE_RUN_MS) retryMs = INITIAL_RETRY_MS;
    console.error(`[worker] ${name} stopped; restarting in ${retryMs}ms:`, failure);
    await workerDelay(retryMs, signal);
    retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
  }
}
