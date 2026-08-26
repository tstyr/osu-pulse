import type { NewScoreCallback } from "@/services/osu-sync";
import { refreshAllAccounts } from "@/services/osu-sync";
import { scoreEmbed } from "@/lib/discord/embeds";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";

const announceScore: NewScoreCallback = async ({ account, score, targets }) => {
  for (const target of targets) {
    if (!target.resultChannelId) continue;
    if ((score.pp ?? 0) < target.minimumPp) continue;
    await sendDiscordChannelMessage(target.resultChannelId, {
      embeds: [scoreEmbed(account, score)],
      allowed_mentions: { parse: [] },
    });
  }
};

function randomInterval() {
  const minimum = Number(process.env.OSU_POLL_MIN_MS ?? 45_000);
  const maximum = Number(process.env.OSU_POLL_MAX_MS ?? 75_000);
  return Math.max(15_000, minimum + Math.random() * Math.max(maximum - minimum, 0));
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runOsuPoller(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const result = await refreshAllAccounts(announceScore);
      if (result.length) console.log(`[osu] polled ${result.length} linked account(s)`);
    } catch (error) {
      console.error("[osu] poll failed:", error);
    }
    await wait(randomInterval());
  }
}
