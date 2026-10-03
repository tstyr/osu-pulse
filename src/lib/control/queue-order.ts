/** Place a queued job before the drop target without moving active jobs. */
export function moveQueuedJobBefore<T extends { jobId: string; status: string }>(
  jobs: readonly T[], movingId: string, targetId: string,
): T[] | null {
  const queued = jobs.filter((job) => job.status === "queued");
  const from = queued.findIndex((job) => job.jobId === movingId);
  const to = queued.findIndex((job) => job.jobId === targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const [moving] = queued.splice(from, 1);
  queued.splice(from < to ? to - 1 : to, 0, moving);
  let index = 0;
  return jobs.map((job) => job.status === "queued" ? queued[index++] : job);
}
