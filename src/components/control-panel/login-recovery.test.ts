import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_RECOVERY_DELAY_MS, loginRecoveryVisible, scheduleLoginRecovery } from "./login-recovery";

afterEach(() => vi.useRealTimers());

describe("login pending recovery guidance", () => {
  it("only displays after the delay while authentication remains pending", () => {
    expect(loginRecoveryVisible(true, true)).toBe(true);
    expect(loginRecoveryVisible(true, false)).toBe(false);
    expect(loginRecoveryVisible(false, true)).toBe(false);
    expect(loginRecoveryVisible(false, false)).toBe(false);
  });
  it("waits 15 seconds and cancels the callback when pending ends or the form unmounts", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const cleanup = scheduleLoginRecovery(true, show);
    vi.advanceTimersByTime(LOGIN_RECOVERY_DELAY_MS - 1);
    expect(show).not.toHaveBeenCalled();
    cleanup();
    vi.advanceTimersByTime(1);
    expect(show).not.toHaveBeenCalled();
    scheduleLoginRecovery(true, show);
    vi.advanceTimersByTime(LOGIN_RECOVERY_DELAY_MS);
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenLastCalledWith(true);
  });
  it("resets delayed guidance after pending resolves", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const cleanup = scheduleLoginRecovery(false, show);
    vi.runOnlyPendingTimers();
    expect(show).toHaveBeenCalledExactlyOnceWith(false);
    cleanup();
  });
});
