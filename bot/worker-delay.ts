import { setTimeout } from "node:timers/promises";

/** Stop periodic workers promptly without treating normal cancellation as failure. */
export async function workerDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return;
  try {
    await setTimeout(milliseconds, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
