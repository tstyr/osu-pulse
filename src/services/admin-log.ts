import { listGuildAutomationChannels, recordAdminAudit } from "@/db/feature-repository";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";

function compact(value: Record<string, unknown> | undefined) {
  if (!value || !Object.keys(value).length) return undefined;
  const text = JSON.stringify(value, (key, item) => {
    if (/(token|secret|password|authorization|database_url)/i.test(key)) return "[REDACTED]";
    return item;
  }, 2);
  return `\n\`\`\`json\n${text.slice(0, 2_800)}\n\`\`\``;
}

export async function auditAdminAction(input: {
  guildId?: string | null;
  actorDiscordUserId?: string | null;
  source: string;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}) {
  const row = await recordAdminAudit(input);
  const channels = await listGuildAutomationChannels();
  const targets = channels.filter((item) => item.auditLogChannelId && (!input.guildId || item.guildId === input.guildId));
  const actor = input.actorDiscordUserId ? `<@${input.actorDiscordUserId}>` : "Web UI / System";
  await Promise.allSettled(targets.map((target) => sendDiscordChannelMessage(target.auditLogChannelId!, {
    embeds: [{
      title: `管理ログ · ${input.action}`,
      description: `${input.summary}${compact(input.details) ?? ""}`.slice(0, 4_000),
      color: 0x475569,
      fields: [
        { name: "実行者", value: actor, inline: true },
        { name: "Source", value: input.source, inline: true },
        { name: "Audit ID", value: row.id, inline: false },
      ],
      timestamp: row.createdAt.toISOString(),
    }],
    allowed_mentions: { parse: [] },
  })));
  return row;
}
