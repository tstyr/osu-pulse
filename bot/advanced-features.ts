import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, type Client } from "discord.js";
import type { LavalinkManager } from "lavalink-client";

import {
  configureMonthlyMontage,
  createRivalry,
  disableOverlayFeed,
  getMonthlyBestScoreUrls,
  getRivalrySnapshot,
  listDueRivalries,
  listMonthlyMontageGuilds,
  listRivalries,
  markMonthlyMontageCreated,
  markRivalryNotified,
  openServiceIncident,
  recordServiceHeartbeat,
  removeRivalry,
  resolveServiceIncident,
  rotateOverlayFeed,
} from "@/db/advanced-features";
import { createCloudCompositionJob, createCloudRenderBatch } from "@/db/render-queue-repository";
import { getAccountByDiscord, getGrowthHistory, getPlayerScoreHistory } from "@/db/repository";
import { getControlSettings } from "@/lib/control/settings";
import { getOsuScore } from "@/lib/osu/client";
import { formatNumber, formatRank } from "@/lib/format";
import { isOsuMode, MODE_ACCENTS, MODE_LABELS, type OsuMode } from "@/lib/osu/modes";
import { calculatePulseHistory } from "@/lib/osu/pulse-index";
import { calculateSkillProfile, skillLabels } from "@/lib/osu/skill-profile";
import { publicAppUrl } from "@/lib/public-app-url";
import { parseScoreUrl } from "@/lib/render/score-url";
import { registerManuallyTrackedOsuAccount } from "@/services/osu-sync";

function webUrl(path: string) {
  return publicAppUrl(path);
}

function renderableMode(value: string | null | undefined, fallback: OsuMode = "osu"): Extract<OsuMode, "osu" | "mania"> {
  const mode = isOsuMode(value) ? value : fallback;
  if (mode !== "osu" && mode !== "mania") throw new Error("動画作成に対応しているモードはstdとmaniaです。");
  return mode;
}

async function rivalryAnalysis(accountId: string, mode: OsuMode) {
  const [scores, snapshots] = await Promise.all([
    getPlayerScoreHistory(accountId, mode),
    getGrowthHistory(accountId, mode, 100),
  ]);
  const cutoff = Date.now() - 90 * 86_400_000;
  const recentScores = scores.filter((score) => score.endedAt.getTime() >= cutoff);
  const history = calculatePulseHistory(recentScores, snapshots.map((snapshot) => ({ date: snapshot.snapshotDate, pp: snapshot.pp, globalRank: snapshot.globalRank })), mode);
  return { scores: recentScores, pulse: history.at(-1) ?? null, skills: calculateSkillProfile(recentScores, mode) };
}

async function resolveRivalParticipants(interaction: ChatInputCommandInteraction) {
  const linkedOwner = await getAccountByDiscord(interaction.user.id);
  const requestedMode = interaction.options.getString("mode");
  const mode = (isOsuMode(requestedMode) ? requestedMode : linkedOwner?.primaryMode ?? "osu") as OsuMode;
  const ownerIdentifier = interaction.options.getString("your_osu")?.trim();
  const rivalIdentifier = interaction.options.getString("rival_osu")?.trim();
  const rivalUser = interaction.options.getUser("user");

  const ownerAccount = ownerIdentifier
    ? (await registerManuallyTrackedOsuAccount({ username: ownerIdentifier, primaryMode: mode })).account
    : linkedOwner;
  const rivalAccount = rivalIdentifier
    ? (await registerManuallyTrackedOsuAccount({ username: rivalIdentifier, primaryMode: mode })).account
    : rivalUser
      ? await getAccountByDiscord(rivalUser.id)
      : null;

  if (!ownerAccount) {
    throw new Error("自分側を指定してください。`your_osu` にosu!ユーザー名またはIDを入力すれば、`/osu link` は不要です。");
  }
  if (!rivalAccount) {
    throw new Error("相手側を指定してください。リンク済みDiscordメンバーを `user` で選ぶか、`rival_osu` にosu!ユーザー名またはIDを入力してください。");
  }
  if (ownerAccount.osuUserId === rivalAccount.osuUserId) {
    throw new Error("同じosu!アカウント同士は比較できません。");
  }

  return {
    ownerAccount,
    rivalAccount,
    rivalDiscordUserId: rivalIdentifier ? null : rivalUser?.id ?? null,
    mode,
  };
}

export async function handleRivalCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "compare") {
    await interaction.deferReply();
    const { ownerAccount, rivalAccount, mode } = await resolveRivalParticipants(interaction);
    const [owner, rival] = await Promise.all([rivalryAnalysis(ownerAccount.id, mode), rivalryAnalysis(rivalAccount.id, mode)]);
    if (!owner.pulse || !rival.pulse || !owner.skills || !rival.skills) throw new Error("比較に必要な保存済みプレイが不足しています。");
    const labels = skillLabels(mode);
    const skillRows = [["aim", labels.aim], ["speed", labels.speed], ["precision", labels.precision], ["reading", labels.reading], ["endurance", labels.endurance]] as const;
    const common = new Set(owner.scores.map((score) => score.beatmapId));
    const commonCount = new Set(rival.scores.filter((score) => common.has(score.beatmapId)).map((score) => score.beatmapId)).size;
    const skillText = skillRows.map(([key, label]) => {
      const left = owner.skills![key];
      const right = rival.skills![key];
      return `**${label}** ${left.toFixed(1)} — ${right.toFixed(1)} ${left === right ? "＝" : left > right ? `← ${ownerAccount.username}` : `${rivalAccount.username} →`}`;
    }).join("\n");
    const url = webUrl(`/compare/${ownerAccount.osuUserId}/${rivalAccount.osuUserId}?mode=${mode}`);
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
      .setTitle(`⚔️ ${ownerAccount.username} vs ${rivalAccount.username}`)
      .setURL(url)
      .setDescription(`${MODE_LABELS[mode]} · 直近90日のDB保存プレイを比較`)
      .addFields(
        { name: ownerAccount.username, value: `Pulse **${owner.pulse.rollingIndex.toFixed(2)}**\n${owner.pulse.totalPp?.toFixed(1) ?? "—"}pp · ${owner.pulse.globalRank ? formatRank(owner.pulse.globalRank) : "順位 —"}\n${owner.pulse.growthRate === null ? "成長比較待ち" : `成長 ${owner.pulse.growthRate >= 0 ? "+" : ""}${owner.pulse.growthRate.toFixed(2)}%`}`, inline: true },
        { name: rivalAccount.username, value: `Pulse **${rival.pulse.rollingIndex.toFixed(2)}**\n${rival.pulse.totalPp?.toFixed(1) ?? "—"}pp · ${rival.pulse.globalRank ? formatRank(rival.pulse.globalRank) : "順位 —"}\n${rival.pulse.growthRate === null ? "成長比較待ち" : `成長 ${rival.pulse.growthRate >= 0 ? "+" : ""}${rival.pulse.growthRate.toFixed(2)}%`}`, inline: true },
        { name: "スキル対戦", value: skillText, inline: false },
        { name: "共通譜面", value: `${commonCount}譜面 · [Head-to-Head詳細を開く](${url})`, inline: false },
      )
      .setFooter({ text: "公式Aim/Speed譜面難度 + 保存リザルトの成果指数" })
      .setTimestamp()] });
    return;
  }
  if (subcommand === "add") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { ownerAccount, rivalAccount, rivalDiscordUserId, mode } = await resolveRivalParticipants(interaction);
    const channel = interaction.options.getChannel("channel");
    const row = await createRivalry({
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
      ownerAccountId: ownerAccount.id,
      rivalDiscordUserId,
      rivalAccountId: rivalAccount.id,
      mode,
      notificationChannelId: channel?.id,
    });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xf48120).setTitle("⚔️ ライバル登録完了").setDescription(`**${ownerAccount.username}** vs **${rivalAccount.username}** · ${MODE_LABELS[mode]}\n毎日21:00 JSTに差分を通知します。`).addFields({ name: "公開比較URL", value: webUrl(`/compare/${ownerAccount.osuUserId}/${rivalAccount.osuUserId}?mode=${mode}`) }).setFooter({ text: `ID ${row.id.slice(0, 8)}` })],
    });
    return;
  }
  if (subcommand === "list") {
    const rows = await listRivalries({ guildId: interaction.guildId, ownerDiscordUserId: interaction.user.id });
    const lines = rows.map((row) => `\`${row.id.slice(0, 8)}\` ${row.enabled ? "🟢" : "⚪"} **${row.rivalAccount?.username ?? "Unknown"}** · ${MODE_LABELS[row.mode]} · ${row.notificationChannelId ? `<#${row.notificationChannelId}>` : "DM"}`);
    await interaction.reply({ content: lines.join("\n") || "登録中のライバルはいません。", flags: MessageFlags.Ephemeral });
    return;
  }
  const id = interaction.options.getString("id", true).trim().toLowerCase();
  const rows = await listRivalries({ guildId: interaction.guildId, ownerDiscordUserId: interaction.user.id });
  const target = rows.find((row) => row.id.toLowerCase() === id || row.id.toLowerCase().startsWith(id));
  const deleted = target ? await removeRivalry({ id: target.id, guildId: interaction.guildId, ownerDiscordUserId: interaction.user.id }) : null;
  await interaction.reply({ content: deleted ? "ライバル登録を解除しました。" : "該当するライバルIDが見つかりません。", flags: MessageFlags.Ephemeral });
}

export async function handleOverlayCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
  if (interaction.options.getSubcommand() === "disable") {
    await disableOverlayFeed(interaction.guildId);
    await interaction.reply({ content: "OBSオーバーレイURLを無効化しました。", flags: MessageFlags.Ephemeral });
    return;
  }
  const token = await rotateOverlayFeed({ guildId: interaction.guildId, createdByDiscordUserId: interaction.user.id });
  const url = webUrl(`/overlay/${token}`);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x0f67d8).setTitle("OBS Browser Source").setDescription(`OBSの「ブラウザ」に次のURLを貼り付けてください。\n\n${url}`).addFields({ name: "推奨サイズ", value: "1920 × 1080", inline: true }, { name: "更新", value: "5秒ごと", inline: true }).setFooter({ text: "このURLはパスワード相当です。公開しないでください。/overlay setup で失効・再発行できます。" })],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleRenderScheduleCommand(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString("url", true);
  const minutes = interaction.options.getInteger("after_minutes", true);
  const scheduledAt = new Date(Date.now() + minutes * 60_000);
  const settings = await getControlSettings();
  const result = await createCloudRenderBatch({
    scoreUrls: [url],
    options: settings.values.renderDefaults,
    scheduledAt,
    requestedByDiscordUserId: interaction.user.id,
  });
  if (!result.created.length) throw new Error("同じスコアのレンダーがすでに待機中です。");
  await interaction.reply({ content: `🗓️ <t:${Math.floor(scheduledAt.getTime()/1000)}:F> にレンダーを開始します。\nJob: \`${result.created[0].id.slice(0,8)}\``, flags: MessageFlags.Ephemeral });
}

export async function handleRenderCompareCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const oldUrl = interaction.options.getString("old_url", true);
  const newUrl = interaction.options.getString("new_url", true);
  const [oldScore, newScore] = await Promise.all([
    getOsuScore(parseScoreUrl(oldUrl).split("/").at(-1)!),
    getOsuScore(parseScoreUrl(newUrl).split("/").at(-1)!),
  ]);
  if (oldScore.beatmap.id !== newScore.beatmap.id || (oldScore.ruleset ?? oldScore.mode) !== (newScore.ruleset ?? newScore.mode)) {
    throw new Error("昔/現在比較は同じ譜面・同じモードの2スコアを指定してください。");
  }
  const settings = await getControlSettings();
  const job = await createCloudCompositionJob({
    kind: "comparison",
    comparisonMode: "same-beatmap",
    title: "Old vs New Comparison",
    scoreUrls: [oldUrl, newUrl],
    options: settings.values.renderDefaults,
    requestedByDiscordUserId: interaction.user.id,
  });
  await interaction.editReply(`🎞️ 昔 / 現在の横並び比較動画をキューへ追加しました。\nJob: \`${job.id.slice(0,8)}\`\n${webUrl("/dashboard/render")}`);
}

export async function handleRenderVersusCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await getControlSettings();
  const job = await createCloudCompositionJob({
    kind: "comparison",
    comparisonMode: "versus",
    title: "Player vs Player",
    scoreUrls: [interaction.options.getString("player_1_url", true), interaction.options.getString("player_2_url", true)],
    options: settings.values.renderDefaults,
    requestedByDiscordUserId: interaction.user.id,
  });
  await interaction.editReply(`⚔️ 2プレイヤーの横並び比較動画をキューへ追加しました。\nJob: \`${job.id.slice(0,8)}\`\n${webUrl("/dashboard/render")}`);
}

function monthRange(raw?: string | null) {
  const now = new Date();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const match = raw?.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  const start = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : fallback;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end, key: start.toISOString().slice(0, 7) };
}

async function createMonthlyMontageJob(input: { guildId: string; month?: string | null; mode: Extract<OsuMode, "osu" | "mania">; requestedBy?: string | null }) {
  const range = monthRange(input.month);
  const scores = await getMonthlyBestScoreUrls(input.guildId, input.mode, range.start, range.end, 5);
  if (scores.length < 2) throw new Error(`${range.key} は動画化できる保存済みスコアが2件未満です。`);
  const settings = await getControlSettings();
  const job = await createCloudCompositionJob({
    kind: "montage",
    title: `${range.key} ${MODE_LABELS[input.mode]} Monthly Best Plays`,
    scoreUrls: scores.map((item) => item.url),
    options: settings.values.renderDefaults,
    requestedByDiscordUserId: input.requestedBy,
  });
  return { job, range, scores };
}

export async function handleMontageCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "setup") {
    const mode = renderableMode(interaction.options.getString("mode"));
    const channel = interaction.options.getChannel("channel", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    await configureMonthlyMontage({ guildId: interaction.guildId, channelId: channel.id, mode, enabled });
    await interaction.reply({ content: enabled ? `毎月1日に${MODE_LABELS[mode]}のベスト5動画を作成し、<#${channel.id}>へ通知します。` : "月間動画の自動作成を停止しました。", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const mode = renderableMode(interaction.options.getString("mode"));
  const result = await createMonthlyMontageJob({ guildId: interaction.guildId, month: interaction.options.getString("month"), mode, requestedBy: interaction.user.id });
  await interaction.editReply(`🎬 ${result.range.key} ${MODE_LABELS[mode]} ベスト${result.scores.length}件の月間動画をキューへ追加しました。\nJob: \`${result.job.id.slice(0,8)}\``);
}

export async function dispatchDailyRivalReports(client: Client) {
  const jst = new Date(Date.now() + 9 * 3_600_000);
  if (jst.getUTCHours() !== 21) return 0;
  const reportDate = jst.toISOString().slice(0, 10);
  const due = await listDueRivalries(reportDate);
  let sent = 0;
  for (const row of due) {
    const snapshot = await getRivalrySnapshot(row.id);
    if (!snapshot?.owner.snapshot || !snapshot.rival.snapshot) continue;
    const left = snapshot.owner.snapshot;
    const right = snapshot.rival.snapshot;
    const ppDiff = left.pp - right.pp;
    const rankLead = left.globalRank && right.globalRank ? right.globalRank - left.globalRank : null;
    const [ownerAnalysis, rivalAnalysis] = await Promise.all([
      rivalryAnalysis(snapshot.owner.account.id, row.mode),
      rivalryAnalysis(snapshot.rival.account.id, row.mode),
    ]);
    const labels = skillLabels(row.mode);
    const skillKeys = [["aim", labels.aim], ["speed", labels.speed], ["precision", labels.precision], ["reading", labels.reading], ["endurance", labels.endurance]] as const;
    const skillSummary = ownerAnalysis.skills && rivalAnalysis.skills
      ? skillKeys.map(([key, label]) => `${label} ${ownerAnalysis.skills![key].toFixed(0)}:${rivalAnalysis.skills![key].toFixed(0)}`).join(" · ")
      : "スキルデータ集計待ち";
    const common = new Set(ownerAnalysis.scores.map((score) => score.beatmapId));
    const commonCount = new Set(rivalAnalysis.scores.filter((score) => common.has(score.beatmapId)).map((score) => score.beatmapId)).size;
    const embed = new EmbedBuilder().setColor(0xf48120).setTitle(`⚔️ Daily Rival · ${MODE_LABELS[row.mode]}`).setDescription(`**${snapshot.owner.account.username}** vs **${snapshot.rival.account.username}**`).addFields(
      { name: snapshot.owner.account.username, value: `${formatNumber(left.pp,1)}pp · ${formatRank(left.globalRank)}`, inline: true },
      { name: snapshot.rival.account.username, value: `${formatNumber(right.pp,1)}pp · ${formatRank(right.globalRank)}`, inline: true },
      { name: "差", value: `${ppDiff>=0?"+":""}${ppDiff.toFixed(1)}pp${rankLead===null?"":` · 順位 ${rankLead>=0?"+":""}${rankLead}`}`, inline: false },
      { name: "Pulse Index", value: ownerAnalysis.pulse && rivalAnalysis.pulse ? `${ownerAnalysis.pulse.rollingIndex.toFixed(2)} : ${rivalAnalysis.pulse.rollingIndex.toFixed(2)}（差 ${Math.abs(ownerAnalysis.pulse.rollingIndex-rivalAnalysis.pulse.rollingIndex).toFixed(2)}）` : "集計待ち" },
      { name: "スキル対戦", value: skillSummary },
      { name: "共通譜面", value: `${commonCount}譜面`, inline: true },
      { name: "比較グラフ", value: webUrl(`/compare/${snapshot.owner.account.osuUserId}/${snapshot.rival.account.osuUserId}?mode=${row.mode}`) },
    ).setTimestamp();
    try {
      if (row.notificationChannelId) {
        const channel = await client.channels.fetch(row.notificationChannelId);
        if (!channel?.isSendable()) throw new Error("通知チャンネルへ送信できません");
        await channel.send({ embeds: [embed] });
      } else {
        await (await client.users.fetch(row.ownerDiscordUserId)).send({ embeds: [embed] });
      }
      await markRivalryNotified(row.id, reportDate);
      sent += 1;
    } catch (error) { console.error(`[rival] ${row.id} delivery failed:`, error); }
  }
  return sent;
}

export async function dispatchMonthlyMontages(client: Client) {
  const jst = new Date(Date.now() + 9 * 3_600_000);
  if (jst.getUTCDate() !== 1 || jst.getUTCHours() !== 9) return 0;
  const range = monthRange();
  let created = 0;
  for (const guild of await listMonthlyMontageGuilds()) {
    if (guild.lastMonthlyMontageMonth === range.key || !guild.monthlyMontageChannelId) continue;
    try {
      const mode = renderableMode(guild.monthlyMontageMode);
      const result = await createMonthlyMontageJob({ guildId: guild.guildId, month: range.key, mode });
      const channel = await client.channels.fetch(guild.monthlyMontageChannelId);
      if (channel?.isSendable()) await channel.send(`🎬 **${range.key} ${MODE_LABELS[mode]} 月間ベスト動画**を作成開始しました。\nJob: \`${result.job.id.slice(0,8)}\`\n${webUrl("/dashboard/render")}`);
      await markMonthlyMontageCreated(guild.guildId, range.key);
      created += 1;
    } catch (error) { console.error(`[montage] guild=${guild.guildId} failed:`, error); }
  }
  return created;
}

export async function publishBotHeartbeats(client: Client, lavalink: LavalinkManager | null) {
  const connected = Boolean(lavalink && [...lavalink.nodeManager.nodes.values()].some((node) => node.connected));
  await Promise.all([
    recordServiceHeartbeat("discord-bot", client.isReady() ? "operational" : "degraded", { gatewayPing: client.ws.ping, guilds: client.guilds.cache.size }),
    recordServiceHeartbeat("lavalink", connected ? "operational" : "degraded", { connected }),
    connected ? resolveServiceIncident("lavalink") : openServiceIncident({ service: "lavalink", title: "音楽再生サービスの接続低下", message: "Lavalinkノードへ接続できていません。Botは自動再接続を継続しています。", severity: "degraded" }),
  ]);
}
