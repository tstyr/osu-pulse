import {
  type AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type Client,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";

import {
  cancelFocusSession,
  cancelReminder,
  configureGuild,
  createFocusSession,
  createReminder,
  getAccountByDiscord,
  getAccountsByDiscord,
  getActiveFocusSession,
  getGrowthHistory,
  getLatestSnapshots,
  getModeScoreCounts,
  getOverviewCounts,
  getRecentPlays,
  getSnapshotDelta,
  listReminders,
  setDailyDm,
  unlinkAccount,
} from "@/db/repository";
import { formatAccuracy, formatNumber, formatRank, formatScoreAccuracy } from "@/lib/format";
import { isOsuMode, MODE_ACCENTS, MODE_LABELS, type OsuMode } from "@/lib/osu/modes";
import { formatRelativeDuration, parseDurationInput } from "@/lib/time";
import { registerOsuAccount } from "@/services/osu-sync";

import { runLocalPomodoro, triggerRemoteAutomation } from "./automation";
import { handleMusicCommand } from "./music";
import { handleRenderCommand, handleRenderStatusCommand } from "./render";
import { handleServerStatusCommand } from "./server-status";

type HandlerContext = {
  client: Client;
  lavalink: LavalinkManager | null;
};

export async function handleAccountAutocomplete(
  interaction: AutocompleteInteraction,
) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "account") {
    await interaction.respond([]);
    return;
  }

  try {
    const targetOption = interaction.options.get("user");
    const discordUserId = typeof targetOption?.value === "string"
      ? targetOption.value
      : interaction.user.id;
    const query = String(focused.value).trim().toLocaleLowerCase("en-US");
    const linked = await getAccountsByDiscord(discordUserId);
    const choices = linked
      .map((account) => ({
        name: `${account.username} (${account.osuUserId})`.slice(0, 100),
        value: account.username,
      }))
      .filter((choice) =>
        !query || choice.name.toLocaleLowerCase("en-US").includes(query),
      )
      .slice(0, 25);
    await interaction.respond(choices);
  } catch (error) {
    console.error("[osu] account autocomplete failed:", error);
    await interaction.respond([]).catch(() => undefined);
  }
}

function webUrl(path: string) {
  return `${(process.env.WEB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

function modeFromOption(interaction: ChatInputCommandInteraction, fallback: OsuMode): OsuMode {
  const value = interaction.options.getString("mode");
  return isOsuMode(value) ? value : fallback;
}

async function targetAccount(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const selector = interaction.options.getString("account")?.trim() || null;
  return {
    target,
    selector,
    account: await getAccountByDiscord(target.id, selector),
  };
}

async function replyNotLinked(interaction: ChatInputCommandInteraction) {
  const payload = {
    content: "まだosu!アカウントが登録されていません。`/osu link username:<名前>` を実行してください。",
    flags: MessageFlags.Ephemeral,
  } as const;
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content });
  else await interaction.reply(payload);
}

export async function handleCommand(interaction: ChatInputCommandInteraction, context: HandlerContext) {
  try {
    if (interaction.commandName === "osu") await handleOsu(interaction);
    else if (interaction.commandName === "setup") await handleSetup(interaction);
    else if (interaction.commandName === "stats") await handleStats(interaction);
    else if (interaction.commandName === "remind") await handleReminder(interaction);
    else if (interaction.commandName === "pomodoro") await handlePomodoro(interaction);
    else if (interaction.commandName === "music") await handleMusicCommand(interaction, context.lavalink);
    else if (interaction.commandName === "render") await handleRenderCommand(interaction);
    else if (interaction.commandName === "render-status") await handleRenderStatusCommand(interaction);
    else if (interaction.commandName === "server-status") await handleServerStatusCommand(interaction);
  } catch (error) {
    console.error(`[command] /${interaction.commandName} failed:`, error);
    const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `⚠️ ${message}`, embeds: [] });
    else await interaction.reply({ content: `⚠️ ${message}`, flags: MessageFlags.Ephemeral });
  }
}

async function handleOsu(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "link") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const username = interaction.options.getString("username", true);
    const mode = modeFromOption(interaction, "osu");
    const result = await registerOsuAccount({ discordUserId: interaction.user.id, guildId: interaction.guildId, username, primaryMode: mode });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xff66aa)
        .setTitle(`${result.account.username} を登録しました`)
        .setURL(webUrl(`/u/${result.account.osuUserId}?mode=${mode}`))
        .setDescription(`4モードのスナップショットを保存し、${result.importedScores}件の最近のリザルトを取り込みました。`)
        .setThumbnail(result.account.avatarUrl)
        .addFields({ name: "メインモード", value: MODE_LABELS[mode], inline: true }, { name: "成長ページ", value: `[ダッシュボードを開く](${webUrl(`/u/${result.account.osuUserId}?mode=${mode}`)})`, inline: true })
        .setFooter({ text: "以後の新しいリザルトを自動追跡します" })],
    });
    return;
  }

  if (subcommand === "unlink") {
    const selector = interaction.options.getString("account")?.trim() || null;
    const deleted = await unlinkAccount(interaction.user.id, selector);
    await interaction.reply({ content: deleted ? `**${deleted.username}** の登録と追跡データを削除しました。` : "登録済みアカウントはありません。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "accounts") {
    const linked = await getAccountsByDiscord(interaction.user.id);
    if (linked.length === 0) return replyNotLinked(interaction);
    const lines = linked.map((account, index) =>
      `${index + 1}. **${account.username}**${index === 0 ? " · default" : ""}\n   ID: \`${account.osuUserId}\` · ${MODE_LABELS[account.primaryMode]}`,
    );
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xff66aa)
        .setTitle(`登録済みosu!アカウント · ${linked.length}件`)
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: "各コマンドの account にはusernameまたはuser IDを指定できます" })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "daily") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const selector = interaction.options.getString("account")?.trim() || null;
    const updated = await setDailyDm(interaction.user.id, enabled, selector);
    if (updated.length === 0) return replyNotLinked(interaction);
    const target = selector ? `**${updated[0].username}**` : `${updated.length}件の登録アカウント`;
    await interaction.reply({ content: enabled ? `✅ ${target}の毎日21:00（JST）の成長DMを有効にしました。` : `${target}の成長DMを停止しました。`, flags: MessageFlags.Ephemeral });
    return;
  }

  const { target, selector, account } = await targetAccount(interaction);
  if (!account) {
    if (!selector) return replyNotLinked(interaction);
    await interaction.reply({ content: "指定したosu!アカウントは登録されていません。", flags: MessageFlags.Ephemeral });
    return;
  }
  const mode = modeFromOption(interaction, account.primaryMode);

  if (subcommand === "profile") {
    const { latest, previous } = await getSnapshotDelta(account.id, mode);
    if (!latest) return replyNotLinked(interaction);
    const ppGain = latest.pp - (previous?.pp ?? latest.pp);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
        .setAuthor({ name: `${target.username} · ${MODE_LABELS[mode]}`, iconURL: target.displayAvatarURL() })
        .setTitle(account.username)
        .setURL(webUrl(`/u/${account.osuUserId}?mode=${mode}`))
        .setThumbnail(account.avatarUrl)
        .addFields(
          { name: "Performance", value: `${formatNumber(latest.pp)} pp\n${ppGain >= 0 ? "+" : ""}${ppGain.toFixed(0)} today`, inline: true },
          { name: "Global", value: formatRank(latest.globalRank), inline: true },
          { name: "Accuracy", value: formatAccuracy(latest.accuracy), inline: true },
        )
        .setImage(webUrl(`/api/charts/growth/${account.osuUserId}?mode=${mode}`))],
    });
  } else if (subcommand === "recent") {
    const plays = await getRecentPlays(account.id, mode, 8);
    const lines = plays.map((play, index) => `${index + 1}. **${play.rank} · ${play.pp ? `${play.pp.toFixed(1)}pp` : "—"}** — ${play.artist} · ${play.title} [${play.difficulty}]\n   ${formatScoreAccuracy(play.accuracy)}${play.mods.length ? ` · +${play.mods.join("")}` : ""}`);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8c7cff).setTitle(`${account.username} · recent ${MODE_LABELS[mode]}`).setDescription(lines.join("\n") || "まだリザルトがありません。").setURL(webUrl(`/u/${account.osuUserId}?mode=${mode}`))] });
  } else if (subcommand === "growth") {
    const history = await getGrowthHistory(account.id, mode, 30);
    const gain = history.length > 1 ? history.at(-1)!.pp - history[0].pp : 0;
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff66aa).setTitle(`${account.username} · 30日成長`).setDescription(`${gain >= 0 ? "+" : ""}${gain.toFixed(0)} pp · ${MODE_LABELS[mode]}`).setURL(webUrl(`/u/${account.osuUserId}?mode=${mode}`)).setImage(webUrl(`/api/charts/growth/${account.osuUserId}?mode=${mode}`))] });
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = interaction.options.getChannel("results_channel", true);
  const minimumPp = interaction.options.getNumber("minimum_pp") ?? 0;
  await configureGuild({ guildId: interaction.guildId, resultChannelId: channel.id, minimumPp, announcementsEnabled: true });
  await interaction.reply({ content: `✅ 新しいリザルトを <#${channel.id}> に送信します。最小pp: ${minimumPp}`, flags: MessageFlags.Ephemeral });
}

async function handleStats(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const account = await getAccountByDiscord(
    interaction.user.id,
    interaction.options.getString("account")?.trim() || null,
  );
  const overview = await getOverviewCounts();
  const embed = new EmbedBuilder().setColor(0xff66aa).setTitle("osu pulse statistics").addFields(
    { name: "Tracked players", value: formatNumber(overview.accounts), inline: true },
    { name: "Scores stored", value: formatNumber(overview.scores), inline: true },
    { name: "Servers", value: formatNumber(overview.guilds), inline: true },
    { name: "Focus sessions", value: formatNumber(overview.focusSessions), inline: true },
  );
  if (account) {
    const mode = modeFromOption(interaction, account.primaryMode);
    const latest = (await getLatestSnapshots(account.id)).find((row) => row.mode === mode);
    const counts = await getModeScoreCounts(account.id);
    if (latest) embed.setDescription(`**${account.username}** · ${MODE_LABELS[mode]}\n${formatNumber(latest.pp)} pp · ${formatRank(latest.globalRank)} · ${formatAccuracy(latest.accuracy)}\n保存済み: ${formatNumber(counts.find((row) => row.mode === mode)?.value ?? 0)} plays`);
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleReminder(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "list") {
    const rows = await listReminders(interaction.user.id);
    const lines = rows.map((row) => `\`${row.id}\` · <t:${Math.floor(row.dueAt.getTime() / 1000)}:R>\n${row.message}`);
    await interaction.reply({ content: lines.join("\n\n") || "予定中のリマインダーはありません。", flags: MessageFlags.Ephemeral });
  } else if (subcommand === "cancel") {
    const id = interaction.options.getString("id", true);
    const cancelled = await cancelReminder(id, interaction.user.id);
    await interaction.reply({ content: cancelled ? "リマインダーをキャンセルしました。" : "該当するリマインダーが見つかりません。", flags: MessageFlags.Ephemeral });
  } else {
    const amount = interaction.options.getInteger("after", true);
    const unit = interaction.options.getString("unit", true) as "minutes" | "hours" | "days";
    const message = interaction.options.getString("message", true);
    const dm = interaction.options.getBoolean("dm") ?? false;
    const duration = parseDurationInput(amount, unit);
    const dueAt = new Date(Date.now() + duration);
    const reminder = await createReminder({ discordUserId: interaction.user.id, guildId: interaction.guildId, channelId: dm ? null : interaction.channelId, message, dueAt });
    await triggerRemoteAutomation({ type: "reminder", reminderId: reminder.id, dueAt: dueAt.toISOString() });
    await interaction.reply({ content: `⏰ ${formatRelativeDuration(duration)}後（<t:${Math.floor(dueAt.getTime() / 1000)}:F>）に通知します。\nID: \`${reminder.id}\``, flags: MessageFlags.Ephemeral });
  }
}

async function handlePomodoro(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const current = await getActiveFocusSession(interaction.user.id);
  if (subcommand === "status") {
    await interaction.reply({ content: current ? `🍅 ${current.completedRounds}/${current.rounds} セッション完了 · 集中 ${current.focusMinutes}分 / 休憩 ${current.breakMinutes}分` : "進行中のポモドーロはありません。", flags: MessageFlags.Ephemeral });
  } else if (subcommand === "stop") {
    const cancelled = current ? await cancelFocusSession(current.id, interaction.user.id) : null;
    await interaction.reply({ content: cancelled ? "現在のポモドーロを停止しました。" : "進行中のポモドーロはありません。", flags: MessageFlags.Ephemeral });
  } else {
    if (current) {
      await interaction.reply({ content: "すでにポモドーロが進行中です。/pomodoro stop で停止できます。", flags: MessageFlags.Ephemeral });
      return;
    }
    const focus = interaction.options.getInteger("focus") ?? 25;
    const breakMinutes = interaction.options.getInteger("break") ?? 5;
    const rounds = interaction.options.getInteger("rounds") ?? 4;
    const session = await createFocusSession({ discordUserId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId, focusMinutes: focus, breakMinutes, rounds });
    const remote = await triggerRemoteAutomation({ type: "pomodoro", sessionId: session.id });
    if (!remote) void runLocalPomodoro(session.id);
    await interaction.reply(`🍅 ${focus}分集中 / ${breakMinutes}分休憩 × ${rounds}セットを開始します。`);
  }
}
