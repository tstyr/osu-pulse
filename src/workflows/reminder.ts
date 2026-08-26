import { sleep } from "workflow";

import { getReminder, markReminderDelivered, markReminderFailed } from "@/db/repository";
import { sendDiscordChannelMessage, sendDiscordDm } from "@/lib/discord/rest";

export async function reminderWorkflow(reminderId: string, dueAt: string) {
  "use workflow";

  await sleep(new Date(dueAt));
  return deliverReminder(reminderId);
}

async function deliverReminder(reminderId: string) {
  "use step";

  const reminder = await getReminder(reminderId);
  if (!reminder || reminder.status !== "scheduled") return { status: "cancelled" } as const;

  const payload = {
    content: `⏰ <@${reminder.discordUserId}> ${reminder.message}`,
    allowed_mentions: { parse: [], users: [reminder.discordUserId] },
  };

  try {
    if (reminder.channelId) await sendDiscordChannelMessage(reminder.channelId, payload);
    else await sendDiscordDm(reminder.discordUserId, { ...payload, content: `⏰ ${reminder.message}` });
    await markReminderDelivered(reminder.id);
    return { status: "delivered" } as const;
  } catch (error) {
    await markReminderFailed(reminder.id);
    throw error;
  }
}
