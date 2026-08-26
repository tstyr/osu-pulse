import { sleep } from "workflow";

import { completeFocusRound, finishFocusSession, getFocusSession } from "@/db/repository";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";

export async function pomodoroWorkflow(sessionId: string) {
  "use workflow";

  const config = await loadFocusSession(sessionId);
  if (!config) return { status: "cancelled" } as const;

  await postFocusMessage(sessionId, `🍅 集中を開始します。${config.focusMinutes}分間、通知を閉じて取り組みましょう。`);

  for (let round = 1; round <= config.rounds; round += 1) {
    await sleep(`${config.focusMinutes}m`);
    if (!(await sessionIsActive(sessionId))) return { status: "cancelled" } as const;
    await updateRound(sessionId, round);
    await postFocusMessage(sessionId, `✅ ${round}/${config.rounds} セッション完了。${round === config.rounds ? "すべて完了です！" : `${config.breakMinutes}分休憩しましょう。`}`);

    if (round < config.rounds) {
      await sleep(`${config.breakMinutes}m`);
      if (!(await sessionIsActive(sessionId))) return { status: "cancelled" } as const;
      await postFocusMessage(sessionId, `🎯 休憩終了。セッション ${round + 1}/${config.rounds} を開始します。`);
    }
  }

  await finishSession(sessionId);
  return { status: "completed", rounds: config.rounds } as const;
}

async function loadFocusSession(sessionId: string) {
  "use step";
  const session = await getFocusSession(sessionId);
  if (!session || session.status !== "running") return null;
  return { focusMinutes: session.focusMinutes, breakMinutes: session.breakMinutes, rounds: session.rounds };
}

async function sessionIsActive(sessionId: string) {
  "use step";
  const session = await getFocusSession(sessionId);
  return session?.status === "running";
}

async function postFocusMessage(sessionId: string, content: string) {
  "use step";
  const session = await getFocusSession(sessionId);
  if (!session || session.status !== "running") return;
  await sendDiscordChannelMessage(session.channelId, { content: `<@${session.discordUserId}> ${content}`, allowed_mentions: { parse: [], users: [session.discordUserId] } });
}

async function updateRound(sessionId: string, round: number) {
  "use step";
  await completeFocusRound(sessionId, round);
}

async function finishSession(sessionId: string) {
  "use step";
  await finishFocusSession(sessionId);
}
