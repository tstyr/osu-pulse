import { REST, Routes } from "discord.js";

import { commands } from "./commands";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
}

const rest = new REST({ version: "10" }).setToken(token);
const guildId = process.env.DISCORD_DEV_GUILD_ID;
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });
console.log(`Registered ${commands.length} commands ${guildId ? `in guild ${guildId}` : "globally"}.`);
