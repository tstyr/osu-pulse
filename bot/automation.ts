import {
  completeFocusRound,
  finishFocusSession,
  getDueReminders,
  getFocusSession,
  markReminderDelivered,
  markReminderFailed,
} from "@/db/repository";
import { sendDiscordChannelMessage, sendDiscordDm } from "@/lib/discord/rest";

type AutomationPayload =
  | { type: "reminder"; reminderId: string; dueAt: string }
  | { type: "pomodoro"; sessionId: string };

export async function triggerRemoteAutomation(payload: AutomationPayload) {
  const appUrl = process.env.WEB_APP_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!appUrl || !secret) return false;

  try {
    const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/automations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Automation API returned ${response.status}`);
    return true;
  } catch (error) {
    console.warn("[automation] remote start failed, using worker fallback:", error);
    return false;
  }
}

export async function dispatchDueReminders() {
  const due = await getDueReminders();
  for (const reminder of due) {
    try {
      if (reminder.channelId) {
        await sendDiscordChannelMessage(reminder.channelId, { content: `⏰ <@${reminder.discordUserId}> ${reminder.message}`, allowed_mentions: { parse: [], users: [reminder.discordUserId] } });
      } else {
        await sendDiscordDm(reminder.discordUserId, { content: `⏰ ${reminder.message}` });
      }
      await markReminderDelivered(reminder.id);
    } catch (error) {
      console.error(`[reminder] delivery failed: ${reminder.id}`, error);
      await markReminderFailed(reminder.id);
    }
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runLocalPomodoro(sessionId: string) {
  const session = await getFocusSession(sessionId);
  if (!session || session.status !== "running") return;

  await sendDiscordChannelMessage(session.channelId, { content: `<@${session.discordUserId}> 🍅 ${session.focusMinutes}分の集中を開始します。`, allowed_mentions: { parse: [], users: [session.discordUserId] } });
  for (let round = 1; round <= session.rounds; round += 1) {
    await wait(session.focusMinutes * 60_000);
    const current = await getFocusSession(sessionId);
    if (current?.status !== "running") return;
    await completeFocusRound(sessionId, round);
    await sendDiscordChannelMessage(session.channelId, { content: `<@${session.discordUserId}> ✅ ${round}/${session.rounds} 完了。${round === session.rounds ? "すべてのセッションが完了しました！" : `${session.breakMinutes}分休憩です。`}`, allowed_mentions: { parse: [], users: [session.discordUserId] } });
    if (round < session.rounds) {
      await wait(session.breakMinutes * 60_000);
      const resumed = await getFocusSession(sessionId);
      if (resumed?.status !== "running") return;
      await sendDiscordChannelMessage(session.channelId, { content: `<@${session.discordUserId}> 🎯 休憩終了。次の集中を始めます。`, allowed_mentions: { parse: [], users: [session.discordUserId] } });
    }
  }
  await finishFocusSession(sessionId);
}
