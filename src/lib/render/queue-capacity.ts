// Queue capacity is separate from the renderer's one/two execution slots and
// the automatic scheduler's four-job backlog. Automatic idle/time waits must
// not prevent a manual render or a supported 20-score batch from being queued.
export const MAX_CLOUD_RENDER_QUEUE_JOBS = 100;

export function renderQueueHasCapacity(activeCount: number, requestedCount = 1) {
  return Number.isSafeInteger(activeCount) && activeCount >= 0
    && Number.isSafeInteger(requestedCount) && requestedCount >= 0
    && activeCount + requestedCount <= MAX_CLOUD_RENDER_QUEUE_JOBS;
}
