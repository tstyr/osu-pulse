import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
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
  getActiveFocusSession,
  getGrowthHistory,
  getLatestSnapshots,
  getModeScoreCounts,
  getOverviewCounts,
  getPlayerScoreHistory,
  getRecentPlays,
  getSnapshotDelta,
  listReminders,
  setDailyDm,
  unlinkAccount,
} from "@/db/repository";
import { reportInteractionError } from "./interaction-errors";
import { formatAccuracy, formatNumber, formatRank, formatScoreAccuracy } from "@/lib/format";
import { isOsuMode, MODE_ACCENTS, MODE_LABELS, type OsuMode } from "@/lib/osu/modes";
import { calculatePulseHistory, calculatePulseIndex } from "@/lib/osu/pulse-index";
import { calculateSkillProfile, skillLabels } from "@/lib/osu/skill-profile";
import { formatRelativeDuration, parseDurationInput } from "@/lib/time";
import { publicAppUrl } from "@/lib/public-app-url";
import { registerManuallyTrackedOsuAccount, registerOsuAccount } from "@/services/osu-sync";
import { auditAdminAction } from "@/services/admin-log";
import { buildGrowthReport } from "./growth-report";

import { runLocalPomodoro, triggerRemoteAutomation } from "./automation";
import { handleMusicCommand } from "./music";
import { handleRenderBatchCommand, handleRenderCommand, handleRenderStatusCommand } from "./render";
import { handleServerStatusCommand } from "./server-status";
import { handleVerificationCommand } from "./verification";
import { handleFeatureCommand } from "./features";
import {
  handleCommunityCommand,
} from "./community";
import {
  handleMontageCommand,
  handleOverlayCommand,
  handleRenderCompareCommand,
  handleRenderVersusCommand,
  handleRenderScheduleCommand,
  handleRivalCommand,
} from "./advanced-features";

type HandlerContext = {
  client: Client;
  lavalink: LavalinkManager | null;
};

function webUrl(path: string) {
  return publicAppUrl(path);
}

function osuProfileUrl(osuUserId: number, mode: OsuMode) {
  return `https://osu.ppy.sh/users/${osuUserId}/${mode}`;
}

function modeFromOption(interaction: ChatInputCommandInteraction, fallback: OsuMode): OsuMode {
  const value = interaction.options.getString("mode");
  return isOsuMode(value) ? value : fallback;
}

async function targetAccount(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  return { target, account: await getAccountByDiscord(target.id) };
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
    if (interaction.commandName === "ping") await handlePing(interaction);
    else if (["help", "health", "panel", "updates", "feedback", "goal", "leaderboard", "analysis", "session", "profile-card", "reports", "admin-log", "export"].includes(interaction.commandName)) await handleFeatureCommand(interaction, context.lavalink);
    else if (interaction.commandName === "osu") await handleOsu(interaction);
    else if (interaction.commandName === "setup") await handleSetup(interaction);
    else if (interaction.commandName === "stats") await handleStats(interaction);
    else if (interaction.commandName === "remind") await handleReminder(interaction);
    else if (interaction.commandName === "pomodoro") await handlePomodoro(interaction);
    else if (interaction.commandName === "music") await handleMusicCommand(interaction, context.lavalink);
    else if (interaction.commandName === "render") await handleRenderCommand(interaction);
    else if (interaction.commandName === "render-batch") await handleRenderBatchCommand(interaction);
    else if (interaction.commandName === "render-schedule") await handleRenderScheduleCommand(interaction);
    else if (interaction.commandName === "render-compare") await handleRenderCompareCommand(interaction);
    else if (interaction.commandName === "render-versus") await handleRenderVersusCommand(interaction);
    else if (interaction.commandName === "rival") await handleRivalCommand(interaction);
    else if (interaction.commandName === "overlay") await handleOverlayCommand(interaction);
    else if (interaction.commandName === "montage") await handleMontageCommand(interaction);
    else if (interaction.commandName === "render-status") await handleRenderStatusCommand(interaction);
    else if (interaction.commandName === "server-status") await handleServerStatusCommand(interaction);
    else if (interaction.commandName === "verify" || interaction.commandName === "verify-panel") await handleVerificationCommand(interaction);
    else if (interaction.commandName === "track-player") await handleTrackPlayer(interaction);
    else if (["onboarding", "ticket", "community"].includes(interaction.commandName)) await handleCommunityCommand(interaction);
    else await interaction.reply({ content: "このコマンドには現在対応していません。`/help` から利用できる操作を確認してください。", flags: MessageFlags.Ephemeral });
    if (interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await auditAdminAction({
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        source: "discord",
        action: `/${interaction.commandName}`,
        summary: `${interaction.user.tag} が /${interaction.commandName} を実行しました。`,
      }).catch((error) => console.error("[audit] command logging failed:", error));
    }
  } catch (error) {
    await reportInteractionError(interaction, error);
  }
}

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [
    days > 0 ? `${days}日` : null,
    hours > 0 ? `${hours}時間` : null,
    `${minutes}分`,
  ];
  return parts.filter(Boolean).join(" ");
}

async function handlePing(interaction: ChatInputCommandInteraction) {
  const startedAt = Date.now();
  await interaction.reply({ content: "🏓 計測中…" });

  const responseLatency = Date.now() - startedAt;
  const gatewayLatency = Math.max(0, Math.round(interaction.client.ws.ping));
  const worstLatency = Math.max(responseLatency, gatewayLatency);
  const color = worstLatency < 150 ? 0x2ecc71 : worstLatency < 300 ? 0xf1c40f : 0xe74c3c;

  await interaction.editReply({
    content: "",
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "Bot応答", value: `\`${responseLatency} ms\``, inline: true },
        { name: "Discord Gateway", value: `\`${gatewayLatency} ms\``, inline: true },
        { name: "稼働時間", value: formatUptime(process.uptime()), inline: true },
        { name: "接続サーバー", value: `${interaction.client.guilds.cache.size}`, inline: true },
        { name: "状態", value: interaction.client.isReady() ? "🟢 正常" : "🟠 接続処理中", inline: true },
      )
      .setFooter({ text: "osu! Pulse Discord Bot" })
      .setTimestamp()],
  });
}

async function handleTrackPlayer(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const username = interaction.options.getString("username", true);
  const mode = modeFromOption(interaction, "osu");
  const result = await registerManuallyTrackedOsuAccount({ username, primaryMode: mode });
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${result.account.username} の追跡を開始しました`)
      .setURL(osuProfileUrl(result.account.osuUserId, mode))
      .setThumbnail(result.account.avatarUrl)
      .setDescription(`Discord連携なしでDBへ追加し、${result.capturedModes}モード・最近の${result.importedScores}件を取り込みました。以後も自動集計します。`)],
  });
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
        .setURL(osuProfileUrl(result.account.osuUserId, mode))
        .setDescription(`4モードのスナップショットを保存し、${result.importedScores}件の最近のリザルトを取り込みました。`)
        .setThumbnail(result.account.avatarUrl)
        .addFields({ name: "メインモード", value: MODE_LABELS[mode], inline: true }, { name: "osu!プロフィール", value: `[公式ページを開く](${osuProfileUrl(result.account.osuUserId, mode)})`, inline: true })
        .setFooter({ text: "以後の新しいリザルトを自動追跡します" })],
    });
    return;
  }

  if (subcommand === "unlink") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deleted = await unlinkAccount(interaction.user.id);
    await interaction.editReply({ content: deleted ? `**${deleted.username}** との登録を解除しました。` : "登録済みアカウントはありません。" });
    return;
  }

  if (subcommand === "daily") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const enabled = interaction.options.getBoolean("enabled", true);
    const updated = await setDailyDm(interaction.user.id, enabled);
    if (!updated) return replyNotLinked(interaction);
    await interaction.editReply({ content: enabled ? "✅ 毎日21:00（JST）の成長DMを有効にしました。" : "成長DMを停止しました。" });
    return;
  }

  await interaction.deferReply();
  const { target, account } = await targetAccount(interaction);
  if (!account) return replyNotLinked(interaction);
  const mode = modeFromOption(interaction, account.primaryMode);

  if (subcommand === "profile") {
    const { latest, previous } = await getSnapshotDelta(account.id, mode);
    if (!latest) {
      await interaction.editReply(`${account.username} の${MODE_LABELS[mode]}の統計はまだ保存されていません。登録は完了しています。同期後に再確認してください。`);
      return;
    }
    const ppGain = latest.pp - (previous?.pp ?? latest.pp);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
        .setAuthor({ name: `${target.username} · ${MODE_LABELS[mode]}`, iconURL: target.displayAvatarURL() })
        .setTitle(account.username)
        .setURL(osuProfileUrl(account.osuUserId, mode))
        .setThumbnail(account.avatarUrl)
        .addFields(
          { name: "Performance", value: `${formatNumber(latest.pp)} pp\n${ppGain >= 0 ? "+" : ""}${ppGain.toFixed(0)}（前回保存比）`, inline: true },
          { name: "Global", value: formatRank(latest.globalRank), inline: true },
          { name: "Accuracy", value: formatAccuracy(latest.accuracy), inline: true },
        )
        .setImage(webUrl(`/api/charts/growth/${account.osuUserId}?mode=${mode}`))],
    });
  } else if (subcommand === "recent") {
    const plays = await getRecentPlays(account.id, mode, 8);
    const aimLabel = skillLabels(mode).aim;
    const lines = plays.map((play, index) => {
      const pulse = calculatePulseIndex(play, mode).total;
      const aim = calculateSkillProfile([play], mode)?.aim ?? null;
      return `${index + 1}. **${play.rank} · ${play.pp ? `${play.pp.toFixed(1)}pp` : "—"}** — ${play.artist} · ${play.title} [${play.difficulty}]\n   ${formatScoreAccuracy(play.accuracy)}${play.mods.length ? ` · +${play.mods.join("")}` : ""} · Pulse ${pulse.toFixed(1)} · ${aimLabel} ${aim?.toFixed(1) ?? "—"}`;
    });
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x8c7cff).setTitle(`${account.username} · recent ${MODE_LABELS[mode]}`).setDescription((lines.join("\n") || "まだリザルトがありません。").slice(0, 4096)).setURL(osuProfileUrl(account.osuUserId, mode))] });
  } else if (subcommand === "pulse") {
    const [scoreRows, snapshotRows] = await Promise.all([
      getPlayerScoreHistory(account.id, mode),
      getGrowthHistory(account.id, mode, 100),
    ]);
    const cutoff = Date.now() - 90 * 86_400_000;
    const history = calculatePulseHistory(
      scoreRows.filter((score) => score.endedAt.getTime() >= cutoff),
      snapshotRows.map((snapshot) => ({ date: snapshot.snapshotDate, pp: snapshot.pp, globalRank: snapshot.globalRank })),
      mode,
    );
    const latest = history.at(-1);
    if (!latest) {
      await interaction.editReply("総合指数を計算できる保存済みリザルトがありません。");
      return;
    }
    const latestDate = Date.parse(`${latest.date}T23:59:59+09:00`);
    const recent = history.filter((row) => Date.parse(`${row.date}T23:59:59+09:00`) >= latestDate - 30 * 86_400_000);
    const activeDays = recent.length;
    const plays = recent.reduce((sum, row) => sum + row.plays, 0);
    const activityBand = activeDays >= 12 ? "高頻度" : activeDays >= 4 ? "通常" : "ライト";
    const detailUrl = webUrl(`/players/${account.osuUserId}?mode=${mode}`);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
        .setAuthor({ name: `${target.username} · ${MODE_LABELS[mode]}`, iconURL: target.displayAvatarURL() })
        .setTitle(`${account.username} · Pulse Index ${latest.rollingIndex.toFixed(2)}`)
        .setURL(detailUrl)
        .setThumbnail(account.avatarUrl)
        .setDescription("PPだけでなく、精度・判定・譜面難度・曲尺・MOD・総PP・世界順位を統合した成長指標です。")
        .addFields(
          { name: "期間内成長", value: latest.growthRate === null ? "比較待ち" : `${latest.growthRate >= 0 ? "+" : ""}${latest.growthRate.toFixed(2)}%`, inline: true },
          { name: "プレイ頻度", value: `${activityBand} · ${activeDays}活動日`, inline: true },
          { name: "直近30日", value: `${plays.toLocaleString()} plays`, inline: true },
          { name: "プレイ実力", value: latest.playIndex.toFixed(2), inline: true },
          { name: "実行品質", value: latest.execution.toFixed(2), inline: true },
          { name: "譜面難度", value: latest.difficulty.toFixed(2), inline: true },
          { name: "プロフィール", value: `${latest.totalPp === null ? "—" : `${latest.totalPp.toFixed(2)}pp`} · ${latest.globalRank === null ? "順位 —" : `#${latest.globalRank.toLocaleString()}`}`, inline: false },
          { name: "データ充足率", value: `${latest.coverage.toFixed(1)}%`, inline: true },
        )
        .setFooter({ text: `直近7活動日の平均 · DB ${history.length}活動日 · osu! Pulse独自指標` })
        .setTimestamp()],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("総合成長グラフを見る").setURL(detailUrl),
      )],
    });
  } else if (subcommand === "growth") {
    const history = await getGrowthHistory(account.id, mode, 400);
    const report = buildGrowthReport(history);
    if (!report) {
      await interaction.editReply("比較できる成長履歴がまだありません。次回の定期同期後にもう一度お試しください。");
      return;
    }
    const detailUrl = webUrl(`/players/${account.osuUserId}?mode=${mode}`);
    const embed = new EmbedBuilder()
      .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
      .setAuthor({ name: `${target.username} の成長レポート`, iconURL: target.displayAvatarURL() })
      .setTitle(`${account.username} の成長率 [${MODE_LABELS[mode]}]`)
      .setDescription("前回値と期間別の変化を表示します。実行時の履歴はDBへ自動保存されています。")
      .setURL(detailUrl)
      .setThumbnail(account.avatarUrl)
      .addFields(
        { name: "現在値", value: report.current },
        ...report.periods.map((period) => ({ name: period.name, value: period.value })),
        { name: "日次サマリー（最新10区間）", value: report.daily },
        { name: "期間比較", value: report.comparison },
        { name: "成長インサイト", value: report.insights },
      )
      .setImage(webUrl(`/api/charts/growth/${account.osuUserId}?mode=${mode}&v=${report.latest.snapshotDate}`))
      .setFooter({ text: `osu! Pulse · DB ${history.length.toLocaleString()}日分 · 最終記録 ${report.latest.snapshotDate}` })
      .setTimestamp(report.latest.updatedAt);
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("詳細グラフを見る").setURL(detailUrl),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("osu!プロフィール").setURL(osuProfileUrl(account.osuUserId, mode)),
    );
    await interaction.editReply({ embeds: [embed], components: [actions] });
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = interaction.options.getChannel("results_channel", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const minimumPp = interaction.options.getNumber("minimum_pp") ?? 0;
  await configureGuild({ guildId: interaction.guildId, resultChannelId: channel.id, minimumPp, announcementsEnabled: true });
  await interaction.editReply({ content: `✅ 新しいリザルトを <#${channel.id}> に送信します。最小pp: ${minimumPp}` });
}

async function handleStats(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const account = await getAccountByDiscord(interaction.user.id);
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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "list") {
    const rows = await listReminders(interaction.user.id);
    const lines = rows.map((row) => `\`${row.id}\` · <t:${Math.floor(row.dueAt.getTime() / 1000)}:R>\n${row.message}`);
    const content = lines.join("\n\n") || "予定中のリマインダーはありません。";
    await interaction.editReply(content.length <= 1900
      ? { content, allowedMentions: { parse: [] } }
      : { content: `予定中のリマインダー ${rows.length}件を添付しました（直近20件まで）。`, files: [new AttachmentBuilder(Buffer.from(rows.map((row) => `${row.id} | ${row.dueAt.toISOString()}\n${row.message}`).join("\n\n"), "utf8"), { name: "reminders.txt" })] });
  } else if (subcommand === "cancel") {
    const id = interaction.options.getString("id", true);
    const cancelled = await cancelReminder(id, interaction.user.id);
    await interaction.editReply({ content: cancelled ? "リマインダーをキャンセルしました。" : "該当するリマインダーが見つかりません。" });
  } else {
    const amount = interaction.options.getInteger("after", true);
    const unit = interaction.options.getString("unit", true) as "minutes" | "hours" | "days";
    const message = interaction.options.getString("message", true);
    const dm = interaction.options.getBoolean("dm") ?? false;
    const duration = parseDurationInput(amount, unit);
    const dueAt = new Date(Date.now() + duration);
    const reminder = await createReminder({ discordUserId: interaction.user.id, guildId: interaction.guildId, channelId: dm ? null : interaction.channelId, message, dueAt });
    await triggerRemoteAutomation({ type: "reminder", reminderId: reminder.id, dueAt: dueAt.toISOString() });
    await interaction.editReply({ content: `⏰ ${formatRelativeDuration(duration)}後（<t:${Math.floor(dueAt.getTime() / 1000)}:F>）に通知します。\nID: \`${reminder.id}\`` });
  }
}

async function handlePomodoro(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: subcommand === "start" ? undefined : MessageFlags.Ephemeral });
  const current = await getActiveFocusSession(interaction.user.id);
  if (subcommand === "status") {
    await interaction.editReply({ content: current ? `🍅 ${current.completedRounds}/${current.rounds} セッション完了 · 集中 ${current.focusMinutes}分 / 休憩 ${current.breakMinutes}分` : "進行中のポモドーロはありません。" });
  } else if (subcommand === "stop") {
    const cancelled = current ? await cancelFocusSession(current.id, interaction.user.id) : null;
    await interaction.editReply({ content: cancelled ? "現在のポモドーロを停止しました。" : "進行中のポモドーロはありません。" });
  } else {
    if (current) {
      await interaction.editReply({ content: "すでにポモドーロが進行中です。/pomodoro stop で停止できます。" });
      return;
    }
    const focus = interaction.options.getInteger("focus") ?? 25;
    const breakMinutes = interaction.options.getInteger("break") ?? 5;
    const rounds = interaction.options.getInteger("rounds") ?? 4;
    const session = await createFocusSession({ discordUserId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId, focusMinutes: focus, breakMinutes, rounds });
    const remote = await triggerRemoteAutomation({ type: "pomodoro", sessionId: session.id });
    if (!remote) void runLocalPomodoro(session.id).catch((error) => console.error(`[pomodoro] session=${session.id} failed:`, error));
    await interaction.editReply(`🍅 ${focus}分集中 / ${breakMinutes}分休憩 × ${rounds}セットを開始します。`);
  }
}
