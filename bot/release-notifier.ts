import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EmbedBuilder, type Client } from "discord.js";

import { listPendingVersionAnnouncements, markVersionAnnounced } from "@/db/feature-repository";

function packageVersion() {
  try {
    const payload = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return payload.version ?? "unknown";
  } catch {
    return process.env.BOT_VERSION ?? "unknown";
  }
}

export async function announceBotUpdate(client: Client) {
  const version = packageVersion();
  const rows = await listPendingVersionAnnouncements(version);
  if (!rows.length) return;
  const notes = process.env.BOT_RELEASE_NOTES?.trim() || "Botが新しいバージョンで起動しました。`/help` から利用可能な機能を確認できます。";
  for (const row of rows) {
    if (!row.channelId) continue;
    try {
      const channel = await client.channels.fetch(row.channelId);
      if (!channel?.isSendable()) continue;
      await channel.send({ embeds: [new EmbedBuilder()
        .setColor(0xff66aa)
        .setTitle(`🚀 osu! Pulse v${version}`)
        .setDescription(notes.slice(0, 4_000))
        .setFooter({ text: "自動アップデート通知" })
        .setTimestamp()] });
      await markVersionAnnounced(row.guildId, version);
    } catch (error) {
      console.error(`[updates] guild=${row.guildId} failed:`, error);
    }
  }
}
