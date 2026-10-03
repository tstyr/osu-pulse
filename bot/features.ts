import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";

import {
  clearUserGoal,
  configureGuildAutomationChannels,
  configureUpdatesChannel,
  configureUtilityPanel,
  createBotFeedback,
  getScoreAnalysis,
  getRecentSessions,
  getPulseLeaderboard,
  getSeasonLeaderboard,
  getUserGoal,
  getWeeklyLeaderboard,
  setUserGoal,
} from "@/db/feature-repository";
import { getAccountByDiscord, getLatestSnapshots, pingDatabase } from "@/db/repository";
import { formatNumber, formatRank, formatScoreAccuracy } from "@/lib/format";
import { isOsuMode, MODE_ACCENTS, MODE_LABELS, type OsuMode } from "@/lib/osu/modes";
import { publicAppUrl } from "@/lib/public-app-url";
import { RendererClient } from "./renderer-client";
import { helpReply } from "./help-guide";

const UTILITY_PREFIX = "utility";
const FEEDBACK_PREFIX = "feedback-submit";

function webUrl(path: string) {
  return publicAppUrl(path);
}

function modeOption(interaction: ChatInputCommandInteraction, fallback: OsuMode): OsuMode {
  const value = interaction.options.getString("mode");
  return isOsuMode(value) ? value : fallback;
}

function utilityButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${UTILITY_PREFIX}:help`).setLabel("ヘルプ").setEmoji("📖").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${UTILITY_PREFIX}:health`).setLabel("システム状態").setEmoji("🩺").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${UTILITY_PREFIX}:goal`).setLabel("目標").setEmoji("🎯").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${UTILITY_PREFIX}:stats`).setLabel("統計").setEmoji("📊").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${UTILITY_PREFIX}:render`).setLabel("Renderer").setEmoji("🎬").setStyle(ButtonStyle.Secondary),
  );
}

async function healthEmbed(manager: LavalinkManager | null) {
  const startedAt = Date.now();
  const [database, renderer] = await Promise.allSettled([
    pingDatabase(),
    new RendererClient().health(),
  ]);
  const lavalinkConnected = Boolean(manager && [...manager.nodeManager.nodes.values()].some((node) => node.connected));
  const rendererHealth = renderer.status === "fulfilled" ? renderer.value : null;
  const ok = database.status === "fulfilled" && Boolean(rendererHealth) && lavalinkConnected;
  return new EmbedBuilder()
    .setColor(ok ? 0x2ecc71 : 0xf1c40f)
    .setTitle(`🩺 osu! Pulse Health · ${ok ? "正常" : "確認が必要"}`)
    .addFields(
      { name: "Discord", value: "🟢 接続中", inline: true },
      { name: "Database", value: database.status === "fulfilled" ? "🟢 Online" : "🔴 Offline", inline: true },
      { name: "Renderer", value: rendererHealth ? `${rendererHealth.status === "online" ? "🟢" : "🟠"} ${rendererHealth.status}\n${rendererHealth.rendering}実行 / ${rendererHealth.queue_size}待機` : "🔴 Offline", inline: true },
      { name: "Lavalink", value: lavalinkConnected ? "🟢 Connected" : manager ? "🟠 Reconnecting" : "⚪ 未設定", inline: true },
      { name: "osu! API", value: rendererHealth?.osu_api ? "🟢 Configured" : "🟠 Renderer側未設定", inline: true },
      { name: "YouTube", value: rendererHealth?.youtube_upload ? "🟢 Ready" : "🟠 未設定", inline: true },
    )
    .setFooter({ text: `確認 ${Date.now() - startedAt}ms` })
    .setTimestamp();
}

async function goalEmbed(discordUserId: string, requestedMode?: OsuMode) {
  const account = await getAccountByDiscord(discordUserId);
  if (!account) return new EmbedBuilder().setColor(0xf1c40f).setTitle("目標").setDescription("先に `/osu link` でアカウントを登録してください。");
  const mode = requestedMode ?? account.primaryMode;
  const [goal, snapshots] = await Promise.all([getUserGoal(discordUserId, mode), getLatestSnapshots(account.id)]);
  const latest = snapshots.find((row) => row.mode === mode);
  const embed = new EmbedBuilder().setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16)).setTitle(`🎯 ${account.username} · ${MODE_LABELS[mode]}`);
  if (!goal) return embed.setDescription("目標はまだありません。`/goal set` でPPまたは世界順位を設定できます。");
  const lines = [];
  if (goal.targetPp !== null) {
    const current = latest?.pp ?? 0;
    lines.push(`**PP** ${formatNumber(current)} / ${formatNumber(goal.targetPp)} pp (${Math.min(100, current / goal.targetPp * 100).toFixed(1)}%)`);
  }
  if (goal.targetGlobalRank !== null) {
    const current = latest?.globalRank;
    const progress = current ? Math.min(100, goal.targetGlobalRank / current * 100) : 0;
    lines.push(`**世界順位** ${formatRank(current)} → #${goal.targetGlobalRank.toLocaleString()} (${progress.toFixed(1)}%)`);
  }
  if (goal.achievedAt) lines.push(`\n✅ <t:${Math.floor(goal.achievedAt.getTime() / 1_000)}:D> に達成`);
  return embed.setDescription(lines.join("\n"));
}

export function isUtilityButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith(`${UTILITY_PREFIX}:`);
}

export function isFeedbackModal(interaction: ModalSubmitInteraction) {
  return interaction.customId.startsWith(`${FEEDBACK_PREFIX}:`);
}

export async function handleUtilityButton(interaction: ButtonInteraction, manager: LavalinkManager | null) {
  const action = interaction.customId.split(":")[1];
  if (action === "help") await interaction.reply({ ...helpReply(), flags: MessageFlags.Ephemeral });
  else if (action === "health" || action === "goal" || action === "render") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({ embeds: [action === "goal" ? await goalEmbed(interaction.user.id) : await healthEmbed(manager)], content: action === "render" ? "開始は `/render`、進捗確認は `/render-status` を利用してください。" : undefined });
  }
  else if (action === "stats") await interaction.reply({ content: `📊 詳細統計: ${webUrl("/dashboard/statistics")}\nDiscord内では \`/stats\` を利用できます。`, flags: MessageFlags.Ephemeral });
}

export async function handleFeedbackModal(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const kind = interaction.customId.split(":")[1] ?? "other";
  const title = interaction.fields.getTextInputValue("title").trim();
  const details = interaction.fields.getTextInputValue("details").trim();
  const row = await createBotFeedback({ discordUserId: interaction.user.id, guildId: interaction.guildId, kind, title, details });
  await interaction.editReply({ content: `✅ 送信しました。受付ID: \`${row?.id.slice(0, 8)}\`` });
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function meter(value: number) {
  const count = Math.max(0, Math.min(10, Math.round(value / 10)));
  return `${"█".repeat(count)}${"░".repeat(10 - count)} ${Math.round(value)}`;
}

async function analysisTarget(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const account = await getAccountByDiscord(target.id);
  if (!account) return null;
  const mode = modeOption(interaction, account.primaryMode);
  return { target, account, mode, scores: await getScoreAnalysis(account.id, mode) };
}

function groupedPerformance(rows: Awaited<ReturnType<typeof getScoreAnalysis>>, key: "bpm" | "ar" | "od" | "cs") {
  const bins = new Map<string, { pp: number[]; accuracy: number[]; count: number }>();
  for (const row of rows) {
    const raw = row[key];
    if (raw === null) continue;
    const bucket = key === "bpm" ? `${Math.floor(raw / 20) * 20}–${Math.floor(raw / 20) * 20 + 19}` : (Math.round(raw * 2) / 2).toFixed(1);
    const current = bins.get(bucket) ?? { pp: [], accuracy: [], count: 0 };
    if (row.pp !== null) current.pp.push(row.pp);
    current.accuracy.push(row.accuracy * 100);
    current.count += 1;
    bins.set(bucket, current);
  }
  return [...bins.entries()].map(([bucket, value]) => ({ bucket, count: value.count, pp: average(value.pp), accuracy: average(value.accuracy) })).sort((left, right) => right.pp - left.pp);
}

export async function handleFeatureCommand(interaction: ChatInputCommandInteraction, manager: LavalinkManager | null) {
  if (interaction.commandName === "help") {
    await interaction.reply({ ...helpReply(), flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "health") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({ embeds: [await healthEmbed(manager)] });
    return;
  }
  if (interaction.commandName === "panel") {
    if (!interaction.guildId || !interaction.channel?.isSendable()) throw new Error("サーバーのテキストチャンネルで実行してください。");
    const message = await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(0xff66aa).setTitle("osu! Pulse Quick Panel").setDescription("よく使う操作をここから開始できます。ボタンはBot再起動後も利用できます。").setFooter({ text: "osu! Pulse" })],
      components: [utilityButtons()],
    });
    await configureUtilityPanel({ guildId: interaction.guildId, channelId: interaction.channelId, messageId: message.id });
    await interaction.reply({ content: `✅ 操作パネルを設置しました: ${message.url}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "updates") {
    if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
    const channel = interaction.options.getChannel("channel", true);
    await configureUpdatesChannel(interaction.guildId, channel.id);
    await interaction.reply({ content: `✅ 今後のBot更新内容を <#${channel.id}> へ自動投稿します。`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "reports") {
    if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
    const daily = interaction.options.getChannel("daily_channel", true);
    const weekly = interaction.options.getChannel("weekly_channel", true);
    await configureGuildAutomationChannels({ guildId: interaction.guildId, dailyReportChannelId: daily.id, weeklyAwardsChannelId: weekly.id });
    await interaction.reply({ content: `✅ デイリーレポートを <#${daily.id}>、週間表彰を <#${weekly.id}> へ送信します。`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "admin-log") {
    if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
    const audit = interaction.options.getChannel("audit_channel", true);
    const consoleChannel = interaction.options.getChannel("console_channel", true);
    await configureGuildAutomationChannels({ guildId: interaction.guildId, auditLogChannelId: audit.id, consoleLogChannelId: consoleChannel.id });
    await interaction.reply({ content: `✅ 管理操作ログを <#${audit.id}>、マスク済みコンソールログを <#${consoleChannel.id}> へ送信します。`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "feedback") {
    const kind = interaction.options.getString("type", true);
    const modal = new ModalBuilder().setCustomId(`${FEEDBACK_PREFIX}:${kind}`).setTitle(kind === "bug" ? "不具合を報告" : "要望を送信");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("title").setLabel("タイトル").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("details").setLabel("詳細・再現手順").setStyle(TextInputStyle.Paragraph).setMaxLength(1_500).setRequired(true)),
    );
    await interaction.showModal(modal);
    return;
  }
  if (interaction.commandName === "goal") {
    const account = await getAccountByDiscord(interaction.user.id);
    if (!account) throw new Error("先に /osu link でアカウントを登録してください。");
    const subcommand = interaction.options.getSubcommand();
    const mode = modeOption(interaction, account.primaryMode);
    if (subcommand === "set") {
      const targetPp = interaction.options.getNumber("pp");
      const targetGlobalRank = interaction.options.getInteger("rank");
      if (targetPp === null && targetGlobalRank === null) throw new Error("PPまたは世界順位のどちらかを指定してください。");
      await setUserGoal({ discordUserId: interaction.user.id, accountId: account.id, mode, targetPp, targetGlobalRank });
      await interaction.reply({ embeds: [await goalEmbed(interaction.user.id, mode)], flags: MessageFlags.Ephemeral });
    } else if (subcommand === "clear") {
      const deleted = await clearUserGoal(interaction.user.id, mode);
      await interaction.reply({ content: deleted ? `✅ ${MODE_LABELS[mode]}の目標を削除しました。` : "設定済みの目標はありません。", flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ embeds: [await goalEmbed(interaction.user.id, mode)], flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (interaction.commandName === "leaderboard") {
    if (!interaction.guildId) throw new Error("サーバー内で実行してください。");
    const mode = modeOption(interaction, "osu");
    const period = interaction.options.getString("period") ?? "season";
    if (period === "pulse") {
      await interaction.deferReply();
      const rows = await getPulseLeaderboard(interaction.guildId, mode, 30);
      const bandLabel = { active: "🔥 高頻度（12活動日以上）", regular: "🎮 通常（4〜11活動日）", light: "🌱 ライト（1〜3活動日）" } as const;
      const fields = (["active", "regular", "light"] as const).flatMap((band) => {
        const members = rows.filter((row) => row.activityBand === band).slice(0, 8);
        if (!members.length) return [];
        return [{
          name: bandLabel[band],
          value: members.map((row, index) => `${index + 1}. **${row.username}** · **${row.pulseIndex.toFixed(2)}** · 品質 ${row.execution.toFixed(1)} · ${row.activeDays}日/${row.playCount}plays${row.growthRate === null ? "" : ` · ${row.growthRate >= 0 ? "+" : ""}${row.growthRate.toFixed(1)}%`}`).join("\n"),
        }];
      });
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
        .setTitle(`Pulse Indexランキング · ${MODE_LABELS[mode]}`)
        .setDescription("上級者・初心者という区分ではなく、直近30日の**プレイ頻度**ごとに比較します。")
        .addFields(fields.length ? fields : [{ name: "集計待ち", value: "直近30日に保存されたプレイがありません。" }])
        .setFooter({ text: "総合指数 · 同点時は実行品質順 · 活動日はDB保存プレイのある日" })] });
    } else if (period === "season") {
      const rows = await getSeasonLeaderboard(interaction.guildId, mode);
      const lines = rows.slice(0, 20).map((row, index) => `${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} **${row.username}** · **${row.points.toLocaleString()}pt** · ${row.ppGain >= 0 ? "+" : ""}${row.ppGain.toFixed(1)}pp · ${row.rankGain >= 0 ? "+" : ""}${row.rankGain.toLocaleString()}位 · ${row.playCount} plays`);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf48120).setTitle(`${rows[0]?.month ?? "今月"} シーズンランキング · ${MODE_LABELS[mode]}`).setDescription(lines.join("\n") || "今月の比較可能な日次データがまだありません。").setFooter({ text: "PP増加・順位上昇・保存プレイ数からシーズンポイントを算出" })] });
    } else {
      const rows = await getWeeklyLeaderboard(interaction.guildId, mode);
      const lines = rows.slice(0, 20).map((row, index) => `${index + 1}. **${row.username}** · ${row.ppGain >= 0 ? "+" : ""}${row.ppGain.toFixed(1)}pp${row.rankGain === null ? "" : ` · ${row.rankGain >= 0 ? "+" : ""}${row.rankGain.toLocaleString()}位`}`);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff66aa).setTitle(`週間PPランキング · ${MODE_LABELS[mode]}`).setDescription(lines.join("\n") || "比較できる7日分のデータがまだありません。").setFooter({ text: "直近8日間のDBスナップショットから計算" })] });
    }
    return;
  }
  if (interaction.commandName === "session") {
    await interaction.deferReply();
    const target = interaction.options.getUser("user") ?? interaction.user;
    const account = await getAccountByDiscord(target.id);
    if (!account) { await interaction.editReply("対象ユーザーはosu!アカウントを登録していません。"); return; }
    const mode = modeOption(interaction, account.primaryMode);
    const [session] = await getRecentSessions(account.id, mode, 1);
    if (!session) { await interaction.editReply("分析できる保存済みプレイがありません。"); return; }
    const minutes = Math.max(1, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000));
    const best = session.best;
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16))
      .setTitle(`🎮 ${account.username} · 直近セッション`)
      .setDescription(`45分以上空いた区間を別セッションとしてDBから自動集計しています。`)
      .addFields(
        { name: "時間 / プレイ数", value: `${minutes}分 · ${session.plays} plays`, inline: true },
        { name: "平均精度", value: formatScoreAccuracy(session.averageAccuracy), inline: true },
        { name: "平均PP", value: session.averagePp === null ? "—" : `${session.averagePp.toFixed(1)}pp`, inline: true },
        { name: "PB更新", value: `${session.personalBests}件`, inline: true },
        { name: "Best", value: `**${best.artist} — ${best.title} [${best.difficulty}]**\n${best.rank} · ${best.pp?.toFixed(1) ?? "—"}pp · ${formatScoreAccuracy(best.accuracy)}`, inline: false },
      )
      .setTimestamp(session.endedAt)] });
    return;
  }
  if (interaction.commandName === "profile-card") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const account = await getAccountByDiscord(target.id);
    if (!account) throw new Error("対象ユーザーはosu!アカウントを登録していません。");
    const mode = modeOption(interaction, account.primaryMode);
    const publicPage = webUrl(`/players/${account.osuUserId}?mode=${mode}`);
    const image = webUrl(`/api/cards/profile/${account.osuUserId}?mode=${mode}`);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(Number.parseInt(MODE_ACCENTS[mode].slice(1), 16)).setTitle(`${account.username} · ${MODE_LABELS[mode]}`).setURL(publicPage).setImage(image).setDescription(`[詳細な公開プロフィールを開く](${publicPage})`)] });
    return;
  }
  if (interaction.commandName === "analysis") {
    await interaction.deferReply();
    const data = await analysisTarget(interaction);
    if (!data) { await interaction.editReply("対象ユーザーはosu!アカウントを登録していません。"); return; }
    const usable = data.scores.filter((score) => score.pp !== null);
    const subcommand = interaction.options.getSubcommand();
    const embed = new EmbedBuilder().setColor(Number.parseInt(MODE_ACCENTS[data.mode].slice(1), 16)).setTitle(`${data.account.username} · ${MODE_LABELS[data.mode]} 分析`).setFooter({ text: `DB保存済み ${data.scores.length}件` });
    if (subcommand === "skill") {
      const acc = average(usable.map((score) => score.accuracy * 100));
      const speed = Math.min(100, average(usable.flatMap((score) => score.bpm === null ? [] : [score.bpm])) / 2.4);
      const aim = Math.min(100, average(usable.flatMap((score) => score.starRating === null ? [] : [score.starRating])) * 13);
      const reading = Math.min(100, average(usable.flatMap((score) => score.ar === null ? [] : [score.ar])) * 10);
      const ppValues = usable.map((score) => score.pp!);
      const ppAverage = average(ppValues);
      const deviation = Math.sqrt(average(ppValues.map((value) => (value - ppAverage) ** 2)));
      const consistency = Math.max(0, 100 - deviation / Math.max(ppAverage, 1) * 120);
      embed.setDescription(`**Aim / Difficulty**\n${meter(aim)}\n**Speed**\n${meter(speed)}\n**Accuracy**\n${meter(acc)}\n**Reading**\n${meter(reading)}\n**Consistency**\n${meter(consistency)}`).addFields({ name: "算出方法", value: "Stars・BPM・AR・精度・PP分散を0〜100へ正規化したDBベースの傾向値です。" });
    } else if (subcommand === "bpm") {
      const groups = groupedPerformance(data.scores, "bpm").slice(0, 12);
      embed.setDescription(groups.map((group, index) => `${index === 0 ? "🏆" : "•"} **${group.bucket} BPM** · ${group.pp.toFixed(1)}pp · ${group.accuracy.toFixed(2)}% · ${group.count}件`).join("\n") || "BPM情報付きのリザルトがまだありません。");
    } else {
      const sections = (["ar", "od", "cs"] as const).map((key) => {
        const groups = groupedPerformance(data.scores, key).slice(0, 5);
        return `**${key.toUpperCase()}**\n${groups.map((group) => `${group.bucket}: ${group.pp.toFixed(1)}pp / ${group.accuracy.toFixed(2)}% (${group.count})`).join("\n") || "データなし"}`;
      });
      embed.setDescription(sections.join("\n\n"));
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }
  if (interaction.commandName === "export") {
    const account = await getAccountByDiscord(interaction.user.id);
    if (!account) throw new Error("先に /osu link でアカウントを登録してください。");
    const mode = modeOption(interaction, account.primaryMode);
    const format = interaction.options.getString("format", true);
    const scores = await getScoreAnalysis(account.id, mode);
    const safeName = account.username.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "player";
    let body: string;
    if (format === "json") body = JSON.stringify(scores, null, 2);
    else {
      const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const headers = ["score_id", "artist", "title", "difficulty", "rank", "pp", "accuracy", "stars", "bpm", "ar", "od", "cs", "mods", "ended_at"];
      body = [headers.join(","), ...scores.map((score) => [score.osuScoreId, score.artist, score.title, score.difficulty, score.rank, score.pp, score.accuracy, score.starRating, score.bpm, score.ar, score.od, score.cs, score.mods.join(" "), score.endedAt.toISOString()].map(quote).join(","))].join("\r\n");
    }
    const attachment = new AttachmentBuilder(Buffer.from(body, "utf8"), { name: `${safeName}-${mode}.${format}` });
    await interaction.reply({ content: `✅ ${scores.length.toLocaleString()}件を書き出しました。`, files: [attachment], flags: MessageFlags.Ephemeral });
  }
}
