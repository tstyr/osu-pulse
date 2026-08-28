import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import { dispatchDueReminders } from "./automation";
import { handleCommand } from "./handlers";
import { createLavalinkManager } from "./music";
import { runOsuPoller } from "./poller";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const lavalink = createLavalinkManager(client);
const pollController = new AbortController();
let reminderTimer: ReturnType<typeof setInterval> | undefined;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[discord] ready as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} guild(s)`);

  if (lavalink) lavalink.init({ ...readyClient.user });
  if (process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET) {
    void runOsuPoller(pollController.signal);
  } else {
    console.warn("[osu] poller disabled: OSU_CLIENT_ID / OSU_CLIENT_SECRET missing");
  }

  reminderTimer = setInterval(() => {
    void dispatchDueReminders().catch((error) => console.error("[reminder] dispatcher failed:", error));
  }, 15_000);
  reminderTimer.unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction, { client, lavalink });
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  pollController.abort();
  if (reminderTimer) clearInterval(reminderTimer);
  client.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  await client.login(token);
}

void main().catch((error) => {
  console.error("[worker] failed to start:", error);
  process.exitCode = 1;
});
