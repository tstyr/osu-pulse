import type { Client } from "discord.js";

import {
  attachAccountToGuild,
  listDiscordAccountAssignments,
} from "@/db/repository";

/**
 * Rebuild account_guilds after a database import. Older databases contain the
 * Discord-to-osu! link but not the guild association used by score delivery.
 */
export async function reconcileAccountGuilds(client: Client) {
  const assignments = await listDiscordAccountAssignments();
  const guilds = [...client.guilds.cache.values()];
  let attached = 0;
  let checked = 0;

  for (const guild of guilds) {
    let next = 0;
    let failureCount = 0;
    await Promise.all(Array.from({ length: Math.min(4, assignments.length) }, async () => {
      while (next < assignments.length) {
        const assignment = assignments[next++];
        checked += 1;
        try {
          const member = await guild.members.fetch(assignment.discordUserId).catch(() => null);
          if (!member) continue;
          await attachAccountToGuild(assignment.accountId, guild.id);
          attached += 1;
        } catch { failureCount += 1; }
      }
    }));
    if (failureCount) {
      console.warn(`[osu] guild link reconciliation had ${failureCount} database failure(s) in ${guild.id}`);
    }
  }

  console.log(`[osu] guild links reconciled: attached=${attached} checked=${checked}`);
  return { attached, checked };
}
