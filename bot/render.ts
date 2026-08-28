import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type Message,
} from "discord.js";

import {
  getAccountsByDiscord,
} from "@/db/repository";
import { getRecentScores } from "@/lib/osu/client";
import type { OsuScore } from "@/lib/osu/types";

import {
  downloadDiscordReplay,
  RendererClient,
  RendererClientError,
  type RendererHealth,
  type RenderJobStatus,
  type RenderOptions,
} from "./renderer-client";
import { renderAccountChoiceName } from "./render-choice";

type RenderableRecentPlay = {
  scoreId: string;
  pp: number | null;
  rank: string;
  username?: string;
  artist: string;
  title: string;
  difficulty: string;
  endedAt: number;
};

type RenderableRecentResult = {
  accountCount: number;
  plays: RenderableRecentPlay[];
};

const RECENT_PLAY_CACHE_MS = 30_000;
const recentPlayCache = new Map<
  string,
  { expiresAt: number; result: RenderableRecentResult }
>();
const recentPlayRequests = new Map<string, Promise<RenderableRecentResult>>();

function scoreEndedAt(score: OsuScore) {
  const parsed = Date.parse(score.ended_at ?? score.created_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchRenderableRecentPlays(
  discordUserId: string,
): Promise<RenderableRecentResult> {
  const accounts = await getAccountsByDiscord(discordUserId);
  if (accounts.length === 0) return { accountCount: 0, plays: [] };

  const results = await Promise.allSettled(
    accounts.map(async (account) => ({
      account,
      scores: await getRecentScores(account.osuUserId, "osu", 100),
    })),
  );
  const successful = results.filter(
    (result): result is PromiseFulfilledResult<{
      account: (typeof accounts)[number];
      scores: OsuScore[];
    }> => result.status === "fulfilled",
  );
  if (successful.length === 0) {
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failed?.reason ?? new Error("osu! APIから直近プレイを取得できませんでした。");
  }

  const includeUsername = accounts.length > 1;
  const unique = new Map<string, RenderableRecentPlay>();
  for (const { value } of successful) {
    for (const score of value.scores) {
      if (score.has_replay !== true) continue;
      const scoreId = String(score.id);
      if (!/^[1-9][0-9]{0,18}$/.test(scoreId) || unique.has(scoreId)) continue;
      unique.set(scoreId, {
        scoreId,
        pp: score.pp,
        rank: score.rank,
        username: includeUsername ? value.account.username : undefined,
        artist: score.beatmapset?.artist ?? "Unknown artist",
        title: score.beatmapset?.title ?? `Beatmap #${score.beatmap.id}`,
        difficulty: score.beatmap.version,
        endedAt: scoreEndedAt(score),
      });
    }
  }

  return {
    accountCount: accounts.length,
    plays: [...unique.values()].sort((left, right) => right.endedAt - left.endedAt),
  };
}

async function getRenderableRecentPlays(discordUserId: string) {
  const cached = recentPlayCache.get(discordUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const existingRequest = recentPlayRequests.get(discordUserId);
  if (existingRequest) return existingRequest;

  const request = fetchRenderableRecentPlays(discordUserId)
    .then((result) => {
      recentPlayCache.set(discordUserId, {
        expiresAt: Date.now() + RECENT_PLAY_CACHE_MS,
        result,
      });
      return result;
    })
    .finally(() => recentPlayRequests.delete(discordUserId));
  recentPlayRequests.set(discordUserId, request);
  return request;
}

const STATUS_LABELS: Record<RenderJobStatus["status"], string> = {
  created: "受付済み",
  resolving_score: "osu! Resultを確認中",
  downloading_replay: "Replay取得中",
  resolving_beatmap: "Beatmap確認中",
  queued: "キュー待機",
  rendering: "Rendering",
  encoding: "Encoding",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル済み",
};

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_OSU_URL: "❌ osu!のリザルトURLとして認識できません。",
  INVALID_SCORE_ID: "❌ Score IDが正しくありません。",
  SCORE_NOT_FOUND: "❌ 指定されたScoreが見つかりません。",
  OSU_API_UNAVAILABLE: "❌ osu! APIへ接続できません。しばらくしてから再試行してください。",
  OAUTH_FAILED: "❌ Rendererのosu! API設定が正しくありません。",
  REPLAY_UNAVAILABLE: "❌ このスコアのReplayは取得できません。\n\nReplayが保存されていない、またはダウンロードできないスコアの可能性があります。\n.osrファイルを持っている場合は直接添付してください。",
  INVALID_REPLAY: "❌ 有効なosu! Replayファイルとして読み取れません。",
  UNSUPPORTED_RULESET: "❌ 現在レンダリングに対応しているのはosu!standardのみです。",
  BEATMAP_NOT_FOUND: "❌ 対応するBeatmapがosu! Songsフォルダにありません。",
  BEATMAP_DOWNLOAD_FAILED: "❌ Beatmapsetの自動ダウンロードに失敗しました。少し待って再試行してください。",
  DANSER_NOT_FOUND: "❌ danserが見つかりません。RendererのDANSER_PATHを確認してください。",
  FFMPEG_NOT_FOUND: "❌ FFmpegまたは指定した動画エンコーダーを利用できません。",
  DANSER_CRASHED: "❌ danserが異常終了しました。Rendererログを確認してください。",
  FFMPEG_CRASHED: "❌ 動画の生成に失敗しました。Rendererログを確認してください。",
  RENDER_TIMEOUT: "❌ レンダリングが制限時間を超えたため停止しました。",
  RENDER_CANCELLED: "レンダリングはキャンセルされました。",
  TOO_MANY_JOBS: "⚠️ 実行中または待機中のJobが上限に達しています。完了後に再試行してください。",
  DUPLICATE_JOB: "⚠️ 同じReplayと設定のJobがすでに進行中です。",
  VIDEO_UPLOAD_FAILED: "❌ 完成動画を外部ストレージへアップロードできませんでした。R2またはVercel Blob設定を確認してください。",
};

function numberEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function progressBar(progress: number) {
  const filled = Math.max(0, Math.min(20, Math.round(progress / 5)));
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
}

function fileSizeLabel(bytes: number) {
  const gibibytes = bytes / (1024 ** 3);
  return gibibytes >= 1
    ? `${gibibytes.toFixed(2)} GiB`
    : `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
}

export async function handleRenderAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "account") {
    await interaction.respond([]);
    return;
  }

  try {
    const recent = await getRenderableRecentPlays(interaction.user.id);
    if (recent.accountCount === 0) {
      await interaction.respond([]);
      return;
    }
    const query = String(focused.value).trim().toLocaleLowerCase("ja");
    const choices = recent.plays
      .map((play) => ({
        name: renderAccountChoiceName(play),
        value: play.scoreId,
      }))
      .filter((choice) => !query || choice.name.toLocaleLowerCase("ja").includes(query))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch (error) {
    console.error("[render] autocomplete failed:", error);
    await interaction.respond([]).catch(() => undefined);
  }
}

function downloadComponents(url: string) {
  if (url.length > 512) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("動画をダウンロード")
        .setEmoji("📥")
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    ),
  ];
}

function renderEmbed(job: RenderJobStatus) {
  const metadata = job.metadata;
  const embed = new EmbedBuilder()
    .setColor(job.status === "completed" ? 0x55dd99 : job.status === "failed" ? 0xff5577 : 0xff66aa)
    .setTitle(job.status === "completed" ? "✅ Render Complete" : "🎬 osu! Replay Render")
    .setDescription(`状態: **${STATUS_LABELS[job.status]}**${job.queue_position ? `\n順番: **${job.queue_position}番目**` : ""}\n進捗: **${job.progress}%**\n\n${progressBar(job.progress)}`)
    .addFields(
      { name: "Resolution", value: job.options.resolution, inline: true },
      { name: "FPS", value: String(job.options.fps), inline: true },
      { name: "Speed", value: job.options.speed === "original" ? "Original" : `${job.options.speed}x`, inline: true },
    )
    .setFooter({ text: `Job ${job.job_id.slice(0, 8)}` });
  if (metadata?.player_name) embed.setAuthor({ name: metadata.player_name });
  if (metadata?.artist || metadata?.title) {
    const map = `${metadata.artist ?? "Unknown"} - ${metadata.title ?? "Unknown"}${metadata.difficulty ? ` [${metadata.difficulty}]` : ""}`;
    embed.addFields({ name: "Map", value: map.slice(0, 1024) });
  }
  if (metadata) {
    embed.addFields(
      { name: "Mods", value: metadata.mods.length ? metadata.mods.join("") : "NM", inline: true },
      { name: "Accuracy", value: metadata.accuracy == null ? "—" : `${(metadata.accuracy * 100).toFixed(2)}%`, inline: true },
      { name: "Combo / Miss", value: `${metadata.max_combo == null ? "—" : `${metadata.max_combo}x`} / ${metadata.miss_count ?? "—"}`, inline: true },
    );
  }
  if (job.status === "completed" && job.render_duration_seconds != null) {
    const total = Math.round(job.render_duration_seconds);
    embed.addFields({ name: "Render Time", value: `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`, inline: true });
  }
  return embed;
}

function rendererOfflineMessage() {
  return "❌ レンダリングサーバーが起動していません。\n\nこのPCで `renderer/start_renderer.bat` を起動してください。";
}

function errorMessage(error: unknown) {
  if (error instanceof RendererClientError) {
    if (error.code === "RENDERER_OFFLINE" || error.code === "RENDERER_TIMEOUT") return rendererOfflineMessage();
    return ERROR_MESSAGES[error.code] ?? "❌ レンダリング処理に失敗しました。Rendererログを確認してください。";
  }
  return "❌ レンダリング処理に失敗しました。";
}

export async function handleRenderCommand(interaction: ChatInputCommandInteraction) {
  let url = interaction.options.getString("url")?.trim() || null;
  const replay = interaction.options.getAttachment("replay");
  const accountScoreId = interaction.options.getString("account")?.trim() || null;
  const sourceCount = Number(Boolean(url)) + Number(Boolean(replay)) + Number(Boolean(accountScoreId));
  if (sourceCount > 1) {
    await interaction.reply({ content: "❌ アカウント履歴、リザルトURL、Replayファイルはどれか1つだけ指定してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (sourceCount === 0) {
    await interaction.reply({ content: "❌ `account`、osu!のリザルトURL、または.osrファイルを指定してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (replay && !replay.name.toLowerCase().endsWith(".osr")) {
    await interaction.reply({ content: "❌ `.osr` ファイルを添付してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (accountScoreId) {
    if (!/^[1-9][0-9]{0,18}$/.test(accountScoreId)) {
      await interaction.reply({ content: "❌ 選択したプレイが正しくありません。候補から選び直してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    let recent: RenderableRecentResult;
    try {
      recent = await getRenderableRecentPlays(interaction.user.id);
    } catch (error) {
      console.error("[render] recent score lookup failed:", error);
      await interaction.reply({ content: ERROR_MESSAGES.OSU_API_UNAVAILABLE, flags: MessageFlags.Ephemeral });
      return;
    }
    if (recent.accountCount === 0) {
      await interaction.reply({ content: "❌ 先に `/osu link` でアカウントを登録してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    const play = recent.plays.find((candidate) => candidate.scoreId === accountScoreId);
    if (!play) {
      await interaction.reply({ content: "❌ このプレイは直近100件にないか、ダウンロード可能なReplayがありません。候補から選び直してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    url = `https://osu.ppy.sh/scores/osu/${play.scoreId}`;
  }

  await interaction.deferReply();
  let progressMessage: Message | null = null;
  const client = new RendererClient();
  const options: RenderOptions = {
    resolution: interaction.options.getString("resolution") ?? "1920x1080",
    fps: interaction.options.getInteger("fps") ?? 60,
    speed: interaction.options.getString("speed") ?? "original",
    motionBlur: interaction.options.getBoolean("motion_blur") ?? false,
  };

  try {
    const health = await client.health();
    if (!health.danser || !health.ffmpeg || !health.osu_songs || !health.songs_index_ready || (url && !health.osu_api)) {
      await interaction.editReply({ content: degradedMessage(health), embeds: [] });
      return;
    }
    await interaction.editReply({ content: url ? "🔎 osu! Resultを確認しています..." : "🔎 Replayファイルを確認しています..." });
    progressMessage = await interaction.fetchReply();

    let submitted: { job_id: string };
    if (url) {
      submitted = await client.submitScore(interaction.user.id, url, options);
    } else {
      const maximum = numberEnv("RENDER_MAX_REPLAY_BYTES", 16 * 1024 * 1024);
      const bytes = await downloadDiscordReplay(replay!, maximum);
      submitted = await client.submitReplay(interaction.user.id, bytes, options);
    }

    const timeoutAt = Date.now() + numberEnv("RENDER_POLL_TIMEOUT_MS", 2_100_000);
    const interval = numberEnv("RENDER_POLL_INTERVAL_MS", 4_000);
    let fingerprint = "";
    while (Date.now() < timeoutAt) {
      let job: RenderJobStatus;
      try {
        job = await client.getJob(submitted.job_id);
      } catch (error) {
        if (error instanceof RendererClientError && ["RENDERER_OFFLINE", "RENDERER_TIMEOUT"].includes(error.code)) {
          await progressMessage.edit({ content: "❌ レンダリングサーバーとの接続が切断されました。\n\nレンダリング処理が中断された可能性があります。", embeds: [] });
          return;
        }
        throw error;
      }
      const nextFingerprint = `${job.status}:${job.progress}:${job.queue_position}:${job.message}:${job.metadata?.score_id ?? ""}`;
      if (nextFingerprint !== fingerprint) {
        await progressMessage.edit({ content: null, embeds: [renderEmbed(job)] });
        fingerprint = nextFingerprint;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        await progressMessage.edit({ content: ERROR_MESSAGES[job.error_code ?? ""] ?? "❌ レンダリングに失敗しました。Rendererログを確認してください。", embeds: [renderEmbed(job)] });
        return;
      }
      if (job.status === "completed") {
        await progressMessage.edit({
          content: "🗜️ 動画を圧縮して外部ストレージへアップロードしています...",
          embeds: [renderEmbed(job)],
        });
        const shared = await client.shareVideo(job.job_id);
        const provider = shared.provider === "r2" ? "Cloudflare R2" : "Vercel Blob";
        const components = downloadComponents(shared.url);
        const inlineLink = components.length === 0 ? `\n${shared.url}` : "";
        const saved = shared.original_size && shared.original_size > shared.size
          ? ` · 圧縮前 ${fileSizeLabel(shared.original_size)}（${Math.round((1 - shared.size / shared.original_size) * 100)}%削減）`
          : "";
        await progressMessage.edit({
          content: `✅ 圧縮済み動画を${provider}へ保存しました（${fileSizeLabel(shared.size)}${saved}）。${inlineLink}`,
          embeds: [renderEmbed(job)],
          components,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    await client.cancel(submitted.job_id).catch(() => undefined);
    await progressMessage.edit({ content: "❌ Bot側の待機時間を超えたためJobをキャンセルしました。", embeds: [] });
  } catch (error) {
    const payload = { content: errorMessage(error), embeds: [] };
    if (progressMessage) await progressMessage.edit(payload);
    else await interaction.editReply(payload);
  }
}

export async function handleRenderStatusCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const health = await new RendererClient().health();
    const embed = new EmbedBuilder()
      .setColor(health.status === "online" ? 0x55dd99 : 0xffaa55)
      .setTitle(`Renderer: ${health.status === "online" ? "Online" : "Degraded"}`)
      .addFields(
        { name: "Queue", value: String(health.queue_size), inline: true },
        { name: "Rendering", value: String(health.rendering), inline: true },
        { name: "Encoder", value: health.nvenc ? "NVENC" : health.amf ? "AMD AMF" : "CPU", inline: true },
        { name: "danser", value: health.danser ? "OK" : "NOT FOUND", inline: true },
        { name: "FFmpeg", value: health.ffmpeg ? "OK" : "NOT FOUND", inline: true },
        { name: "Songs", value: health.osu_songs ? `${health.songs_index_count.toLocaleString()} maps` : "NOT FOUND", inline: true },
        { name: "osu! API", value: health.osu_api ? "OK" : "MISSING CREDENTIALS", inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
  } catch {
    await interaction.editReply({ content: "Renderer: Offline\n\nこのPCで `renderer/start_renderer.bat` を起動してください。" });
  }
}

function degradedMessage(health: RendererHealth) {
  const missing = [
    !health.danser && "danser",
    !health.ffmpeg && "FFmpeg",
    !health.osu_songs && "osu! Songs",
    !health.songs_index_ready && "Songs Index",
    !health.osu_api && "osu! API credentials",
  ].filter(Boolean).join(", ");
  return `❌ Rendererは起動していますが、必要な設定が不足しています。\n\n不足: ${missing}\n\`renderer/.env\` とRendererコンソールを確認してください。`;
}
