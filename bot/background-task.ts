/** Start an independent worker without letting its startup delay other workers. */
export function startBackgroundTask(
  task: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  void Promise.resolve().then(task).catch(onError);
}
