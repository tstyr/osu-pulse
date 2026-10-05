export const LOGIN_RECOVERY_DELAY_MS = 15_000;

export function loginRecoveryVisible(pending: boolean, delayed: boolean) {
  return pending && delayed;
}

/** This timer changes guidance only. It does not cancel or repeat authentication. */
export function scheduleLoginRecovery(pending: boolean, showRecovery: (delayed: boolean) => void) {
  const timer = setTimeout(() => showRecovery(pending), pending ? LOGIN_RECOVERY_DELAY_MS : 0);
  return () => clearTimeout(timer);
}
