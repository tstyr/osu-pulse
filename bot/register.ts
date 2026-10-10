import { REST, Routes } from "discord.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { commands, legacyCommands } from "./commands";
import { assertKnownRegistration, registrationBody } from "./register-plan";

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

async function main() {
  const unify = process.argv.includes("--unify-all");
  const dryRun = process.argv.includes("--dry-run");
  const targets = [{ route, body: commands }];
  if (unify) {
    targets.splice(0, 1, { route: Routes.applicationCommands(clientId!), body: commands });
    const guilds: { id: string }[] = [];
    let after: string | undefined;
    do {
      const page = await rest.get(Routes.userGuilds(), { query: new URLSearchParams({ limit: "200", ...(after ? { after } : {}) }) }) as { id: string }[];
      guilds.push(...page);
      after = page.length === 200 ? page.at(-1)!.id : undefined;
    } while (after);
    for (const guild of guilds) targets.push({ route: Routes.applicationGuildCommands(clientId!, guild.id), body: [] });
  }
  // Only explicitly named, reviewed stale registrations may be retired.
  const retire = process.argv.filter((argument) => argument.startsWith("--retire-command=")).map((argument) => argument.slice("--retire-command=".length));
  if (retire.some((name) => !/^[a-z0-9_-]{1,32}$/.test(name))) throw new Error("Invalid retirement command name");
  const known = new Set([...legacyCommands.map((command) => command.name), "pulse", ...retire]);
  const snapshots = [];
  for (const target of targets) {
    const existing = await rest.get(target.route) as Array<{ name: string; type?: number; [key: string]: unknown }>;
    assertKnownRegistration(existing, known);
    snapshots.push({ ...target, previous: existing });
    console.log(`Registration plan: ${existing.length} -> ${target.body.length} commands (${target.route.includes("/guilds/") ? "guild override" : "global"}).`);
  }
  if (dryRun) { console.log("Dry run complete; registrations were not changed."); return; }
  const directory = resolve("work", "command-registration");
  await mkdir(directory, { recursive: true });
  const backup = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backup, JSON.stringify(snapshots, null, 2), { mode: 0o600, flag: "wx" });
  const attempted: typeof snapshots = [];
  try {
    for (const target of snapshots) {
      attempted.push(target);
      await rest.put(target.route, { body: target.body });
    }
    console.log(`Registered /pulse and message render shortcut. Backup saved under work/command-registration. ${unify ? "Legacy guild overrides removed." : ""}`);
  } catch {
    let failed = false;
    for (const target of attempted.reverse()) {
      try { await rest.put(target.route, { body: registrationBody(target.previous) }); }
      catch { failed = true; }
    }
    throw new Error(failed ? "Registration failed; rollback incomplete. Restore the saved registration backup." : "Registration failed; previous registrations restored.");
  }
}

void main().catch((error) => {
  // Discord REST errors can include credential-bearing request URLs. Never print them.
  console.error("Command registration failed.", error instanceof Error && /UNRECOGNIZED_COMMANDS|rollback|registrations restored/.test(error.message) ? error.message : "Check application permissions and connectivity; no credentials are logged.");
  process.exitCode = 1;
});
