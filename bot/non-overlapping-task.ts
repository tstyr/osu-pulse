/** A slow scheduled run must finish before another tick can start the same work. */
export function nonOverlappingTask(task: () => Promise<unknown>, onError: (error: unknown) => void) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
}
