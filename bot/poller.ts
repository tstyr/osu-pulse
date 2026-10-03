import { refreshLiveAccounts } from "@/services/osu-sync";
import { enqueueEligibleAutoRenders } from "@/services/auto-render";
import { checkServiceUsageAlerts } from "@/services/usage-alerts";
import { workerDelay } from "./worker-delay";

function randomInterval() {
  const minValue = Number(process.env.OSU_POLL_MIN_MS ?? 120_000);
  const maxValue = Number(process.env.OSU_POLL_MAX_MS ?? 180_000);
  const minimum = Number.isFinite(minValue) ? minValue : 120_000;
  const maximum = Number.isFinite(maxValue) ? maxValue : 180_000;
  return Math.max(30_000, minimum + Math.random() * Math.max(maximum - minimum, 0));
}

export async function runOsuPoller(signal: AbortSignal) {
  let cycle = 0;
  while (!signal.aborted) {
    try {
      cycle += 1;
      const fullSync = cycle % 10 === 0;
      const result = await refreshLiveAccounts(fullSync);
      if (result.length) console.log(`[osu] polled ${result.length} linked account(s) scope=${fullSync ? "all-modes+profiles" : "all-modes-scores"}`);
      for (const account of result) {
        for (const mode of account.modes) {
          if ("error" in mode) {
            console.error(`[osu] poll account=${account.accountId} mode=${mode.mode} failed (${mode.status ?? "unknown"}): ${mode.error}`);
          }
        }
      }
      const autoRender = await enqueueEligibleAutoRenders();
      if (autoRender.queued > 0) {
        console.log(`[auto-render] queued=${autoRender.queued} matched=${autoRender.matched} remaining=${autoRender.remaining}`);
      }
      await checkServiceUsageAlerts();
    } catch (error) {
      console.error("[osu] poll failed:", error);
    }
    await workerDelay(randomInterval(), signal);
  }
}
