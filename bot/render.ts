import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type Message,
  type MessageContextMenuCommandInteraction,
} from "discord.js";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getAccountsByDiscord,
  listDiscordAccountAssignments,
} from "../src/db/repository";
import { getRecentScores } from "../src/lib/osu/client";
import type { OsuMode } from "../src/lib/osu/modes";
import type { OsuScore } from "../src/lib/osu/types";
import { getControlSettings } from "../src/lib/control/settings";
import { createCloudRenderBatch } from "../src/db/render-queue-repository";
import { publicAppUrl } from "../src/lib/public-app-url";

import {
  downloadDiscordReplay,
  RendererClient,
  RendererClientError,
  type RenderJobStatus,
  type RenderOptions,
} from "./renderer-client";
import { renderAccountChoiceName } from "./render-choice";
import { renderMissingDependencies } from "./render-readiness";

type RenderableRecentPlay = {
  scoreId: string;
  ruleset: Extract<OsuMode, "osu" | "mania">;
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

const RECENT_PLAY_CACHE_MS = 5 * 60_000;
const PERSISTED_RECENT_PLAY_MAX_AGE_MS = 48 * 60 * 60_000;
const AUTOCOMPLETE_DEADLINE_MS = 2_200;
const RENDERABLE_RULESETS = ["osu", "mania"] as const;
const recentPlayCachePath = resolve(process.cwd(), "work", "render-recent-cache.json");
const recentPlayCache = new Map<
  string,
  { expiresAt: number; savedAt: number; result: RenderableRecentResult }
>();
const recentPlayRequests = new Map<string, Promise<RenderableRecentResult>>();

function loadPersistedRecentPlayCache() {
  try {
    const parsed = JSON.parse(readFileSync(recentPlayCachePath, "utf8")) as {
      entries?: Record<string, { savedAt?: number; result?: RenderableRecentResult }>;
    };
    const now = Date.now();
    for (const [discordUserId, entry] of Object.entries(parsed.entries ?? {})) {
      if (!entry.result || !entry.savedAt || now - entry.savedAt > PERSISTED_RECENT_PLAY_MAX_AGE_MS) continue;
      recentPlayCache.set(discordUserId, {
        expiresAt: 0,
        savedAt: entry.savedAt,
        result: entry.result,
      });
    }
  } catch {
    // The cache is optional and is recreated after the first successful fetch.
  }
}

function persistRecentPlayCache() {
  try {
    mkdirSync(resolve(process.cwd(), "work"), { recursive: true });
    const entries = Object.fromEntries([...recentPlayCache.entries()].map(([discordUserId, entry]) => [
      discordUserId,
      { savedAt: entry.savedAt, result: entry.result },
    ]));
    const temporaryPath = `${recentPlayCachePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ entries }), "utf8");
    renameSync(temporaryPath, recentPlayCachePath);
  } catch (error) {
    console.error("[render] recent play cache persistence failed:", error);
  }
}

loadPersistedRecentPlayCache();

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
    accounts.flatMap((account) => RENDERABLE_RULESETS.map(async (ruleset) => ({
      account,
      ruleset,
      // Failed scores normally have no downloadable replay and can otherwise
      // push valid recent plays out of osu!'s 100-score response window.
      scores: await getRecentScores(account.osuUserId, ruleset, 100, undefined, {
        includeFails: false,
      }),
    }))),
  );
  const successful = results.filter(
    (result): result is PromiseFulfilledResult<{
      account: (typeof accounts)[number];
      ruleset: (typeof RENDERABLE_RULESETS)[number];
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
      const key = `${value.ruleset}:${scoreId}`;
      if (!/^[1-9][0-9]{0,18}$/.test(scoreId) || unique.has(key)) continue;
      unique.set(key, {
        scoreId,
        ruleset: value.ruleset,
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

export async function getRenderableRecentPlays(discordUserId: string, forceRefresh = false) {
  const cached = recentPlayCache.get(discordUserId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.result;

  const existingRequest = recentPlayRequests.get(discordUserId);
  if (existingRequest) return existingRequest;

  const request = fetchRenderableRecentPlays(discordUserId)
    .then((result) => {
      const savedAt = Date.now();
      recentPlayCache.set(discordUserId, {
        expiresAt: savedAt + RECENT_PLAY_CACHE_MS,
        savedAt,
        result,
      });
      persistRecentPlayCache();
      return result;
    })
    .finally(() => recentPlayRequests.delete(discordUserId));
  recentPlayRequests.set(discordUserId, request);
  return request;
}

function autocompleteResult(discordUserId: string) {
  const cached = recentPlayCache.get(discordUserId);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      void getRenderableRecentPlays(discordUserId).catch((error) => {
        console.error("[render] background recent score refresh failed:", error);
      });
    }
    return Promise.resolve(cached.result);
  }

  const timeout = new Promise<null>((resolveTimeout) => {
    const timer = setTimeout(() => resolveTimeout(null), AUTOCOMPLETE_DEADLINE_MS);
    timer.unref();
  });
  return Promise.race([getRenderableRecentPlays(discordUserId), timeout]);
}

export async function warmRenderRecentPlayCache() {
  const assignments = await listDiscordAccountAssignments();
  const discordUserIds = [...new Set(assignments.map((assignment) => assignment.discordUserId))];
  for (let index = 0; index < discordUserIds.length; index += 2) {
    const batch = discordUserIds.slice(index, index + 2);
    await Promise.allSettled(batch.map((discordUserId) => getRenderableRecentPlays(discordUserId)));
  }
  return discordUserIds.length;
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
  UNSUPPORTED_RULESET: "❌ 現在レンダリングに対応しているのはosu!standardとosu!maniaです。",
  BEATMAP_NOT_FOUND: "❌ 対応するBeatmapがosu! Songsフォルダにありません。",
  BEATMAP_DOWNLOAD_FAILED: "❌ Beatmapsetの自動ダウンロードに失敗しました。少し待って再試行してください。",
  DANSER_NOT_FOUND: "❌ danserが見つかりません。RendererのDANSER_PATHを確認してください。",
  MANIA_RENDERER_NOT_FOUND: "❌ osu!mania Rendererが見つかりません。`renderer/install_mania_renderer.ps1`を実行してください。",
  SKIN_NOT_FOUND: "❌ 使用するosu! Skinが見つかりません。RendererのSkin設定を確認してください。",
  FFMPEG_NOT_FOUND: "❌ FFmpegまたは指定した動画エンコーダーを利用できません。",
  DANSER_CRASHED: "❌ Replay Rendererが異常終了しました。Rendererログを確認してください。",
  FFMPEG_CRASHED: "❌ 動画の生成に失敗しました。Rendererログを確認してください。",
  RENDER_TIMEOUT: "❌ レンダリングが制限時間を超えたため停止しました。",
  RENDER_CANCELLED: "レンダリングはキャンセルされました。",
  TOO_MANY_JOBS: "⚠️ 実行中または待機中のJobが上限に達しています。完了後に再試行してください。",
  DUPLICATE_JOB: "⚠️ 同じReplayと設定のJobがすでに進行中です。",
  VIDEO_UPLOAD_FAILED: "❌ 完成動画を外部ストレージへアップロードできませんでした。R2またはVercel Blob設定を確認してください。",
  INVALID_OPTIONS: "❌ このモードで選択したレンダー設定は利用できません。maniaでは速度Original・モーションブラーOFFを選択してください。",
  DISK_FULL: "❌ 動画を保存するディスクの空き容量が不足しています。",
  STORAGE_UNAVAILABLE: "❌ USB共有ストレージを利用できません。OSU_PULSEを接続・マウントしてください。WindowsはFドライブ、Archは共有マウント先を確認してください。",
  UNAUTHORIZED: "❌ Rendererの接続トークンが一致していません。BotとRendererのRENDER_SERVER_TOKEN設定を確認してください。",
};

function numberEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function progressBar(progress: number) {
  const filled = Math.max(0, Math.min(20, Math.round(progress / 5)));
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
}

function progressDetail(message: string) {
  const render = message.match(/Progress:\s*\d+%\s*,\s*Speed:\s*([^,]+)\s*,\s*ETA:\s*(.+)$/i);
  if (render) return `処理速度: **${render[1].trim()}** · 残り目安: **${render[2].trim()}**`;
  const upload = message.match(/Uploading to YouTube:\s*(\d+)%/i);
  if (upload) return `YouTube転送: **${upload[1]}%**`;
  return null;
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
    const recent = await autocompleteResult(interaction.user.id);
    if (!recent) {
      await interaction.respond([]);
      return;
    }
    if (recent.accountCount === 0) {
      await interaction.respond([]);
      return;
    }
    const query = String(focused.value).trim().toLocaleLowerCase("ja");
    const choices = recent.plays
      .map((play) => ({
        name: renderAccountChoiceName(play),
        value: `${play.ruleset}:${play.scoreId}`,
      }))
      .filter((choice) => !query || choice.name.toLocaleLowerCase("ja").includes(query))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch (error) {
    console.error("[render] autocomplete failed:", error);
    await interaction.respond([]).catch(() => undefined);
  }
}

export function downloadComponents(url: string, youtubeUrl: string | null, provider?: "r2" | "vercel-blob" | "youtube", highlightUrl?: string | null) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (provider !== "youtube" && url.length <= 512) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("動画をダウンロード")
        .setEmoji("📥")
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    );
  }
  const videoUrl = youtubeUrl ?? (provider === "youtube" ? url : null);
  if (videoUrl && videoUrl.length <= 512 && /^https:\/\/youtu\.be\/[A-Za-z0-9_-]+$/.test(videoUrl)) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("YouTubeで見る")
        .setEmoji("▶️")
        .setStyle(ButtonStyle.Link)
        .setURL(videoUrl),
    );
  }
  if (highlightUrl && highlightUrl.length <= 512 && /^https:\/\//.test(highlightUrl)) {
    row.addComponents(
      new ButtonBuilder().setLabel("ハイライト").setEmoji("✂️").setStyle(ButtonStyle.Link).setURL(highlightUrl),
    );
  }
  return row.components.length ? [row] : [];
}

function renderJobControls(job: RenderJobStatus, discordUserId: string) {
  if (["completed", "failed", "cancelled"].includes(job.status)) return [];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`render-job:${job.job_id}:${discordUserId}:cancel`)
      .setLabel("キャンセル")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`render-job:${job.job_id}:${discordUserId}:prioritize`)
      .setLabel(job.priority > 0 ? "優先済み" : "優先する")
      .setEmoji("⏫")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(job.status !== "queued" || job.priority > 0),
  );
  return [row];
}

function renderEmbed(job: RenderJobStatus) {
  const metadata = job.metadata;
  const detail = progressDetail(job.message);
  const embed = new EmbedBuilder()
    .setColor(job.status === "completed" ? 0x55dd99 : job.status === "failed" ? 0xff5577 : 0xff66aa)
    .setTitle(job.status === "completed" ? "✅ Render Complete" : "🎬 osu! Replay Render")
    .setDescription(`状態: **${STATUS_LABELS[job.status]}**${job.queue_position ? `\n順番: **${job.queue_position}番目**` : ""}${job.estimated_wait_seconds > 0 ? `\n開始目安: **約${Math.ceil(job.estimated_wait_seconds / 60)}分後**` : ""}\n推定処理時間: **約${Math.max(1, Math.ceil(job.estimated_render_seconds / 60))}分**\n進捗: **${job.progress}%**\n\n${progressBar(job.progress)}`)
    .addFields(
      { name: "Resolution", value: job.options.resolution, inline: true },
      { name: "FPS", value: String(job.options.fps), inline: true },
      { name: "Speed", value: job.options.speed === "original" ? "Original" : `${job.options.speed}x`, inline: true },
    )
    .setFooter({ text: `Job ${job.job_id.slice(0, 8)}` });
  if (detail) embed.addFields({ name: "現在の処理", value: detail, inline: false });
  if (metadata?.player_name) embed.setAuthor({ name: metadata.player_name });
  if (metadata?.artist || metadata?.title) {
    const map = `${metadata.artist ?? "Unknown"} - ${metadata.title ?? "Unknown"}${metadata.difficulty ? ` [${metadata.difficulty}]` : ""}`;
    embed.addFields({ name: "Map", value: map.slice(0, 1024) });
  }
  if (metadata) {
    embed.addFields(
      { name: "Rank / PP", value: `${metadata.rank ?? "—"} / ${metadata.pp == null ? "—" : `${metadata.pp.toFixed(1)}pp`}`, inline: true },
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
  let ruleset: "osu" | "mania" | undefined;
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
    const selection = /^(?:(osu|mania):)?([1-9][0-9]{0,18})$/.exec(accountScoreId);
    if (!selection) {
      await interaction.reply({ content: "❌ 選択したプレイが正しくありません。候補から選び直してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    // Recent-play lookup can need several API requests. Acknowledge before
    // waiting so Discord does not expire the command at three seconds.
    await interaction.deferReply();
    let recent: RenderableRecentResult;
    try {
      recent = await getRenderableRecentPlays(interaction.user.id);
    } catch (error) {
      console.error("[render] recent score lookup failed:", error);
      await interaction.editReply({ content: ERROR_MESSAGES.OSU_API_UNAVAILABLE });
      return;
    }
    if (recent.accountCount === 0) {
      await interaction.editReply({ content: "❌ 先に `/osu link` でアカウントを登録してください。" });
      return;
    }
    const [, selectedRuleset, selectedScoreId] = selection;
    const play = recent.plays.find((candidate) => (
      candidate.scoreId === selectedScoreId && (!selectedRuleset || candidate.ruleset === selectedRuleset)
    ));
    if (!play) {
      await interaction.editReply({ content: "❌ このプレイはstd/maniaの直近100件にないか、ダウンロード可能なReplayがありません。候補から選び直してください。" });
      return;
    }
    url = `https://osu.ppy.sh/scores/${play.scoreId}`;
    ruleset = play.ruleset;
  }

  const options: RenderOptions = {
    resolution: interaction.options.getString("resolution") ?? "1920x1080",
    fps: interaction.options.getInteger("fps") ?? 60,
    speed: interaction.options.getString("speed") ?? "original",
    motionBlur: interaction.options.getBoolean("motion_blur") ?? false,
    highlight: interaction.options.getBoolean("highlight") ?? false,
  };
  await executeRender(interaction, url, replay, options, ruleset);
}

export async function handleRenderBatchCommand(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString("urls", true);
  const urls = raw.match(/https:\/\/osu\.ppy\.sh\/scores\/(?:osu\/|mania\/)?[1-9][0-9]{0,18}/gi) ?? [];
  const unique = [...new Set(urls)];
  if (!unique.length) {
    await interaction.reply({ content: "osu! Score URLを1件以上指定してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (unique.length > 20) {
    await interaction.reply({ content: "一度に追加できるのは20件までです。", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await getControlSettings();
  const result = await createCloudRenderBatch({
    scoreUrls: unique,
    options: {
      ...settings.values.renderDefaults,
      highlight: interaction.options.getBoolean("highlight") ?? false,
    },
  });
  const skipped = unique.length - result.created.length;
  const dashboard = publicAppUrl("/dashboard/render");
  await interaction.editReply(`✅ ${result.created.length}件を一括キューへ追加しました。${skipped ? ` ${skipped}件は重複のためスキップしました。` : ""}\nBatch: \`${result.batchId.slice(0, 8)}\`\n${dashboard}`);
}

type RenderCommandInteraction = ChatInputCommandInteraction | MessageContextMenuCommandInteraction;

async function executeRender(
  interaction: RenderCommandInteraction,
  url: string | null,
  replay: Parameters<typeof downloadDiscordReplay>[0] | null,
  options: RenderOptions,
  ruleset?: "osu" | "mania",
) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
  let progressMessage: Message | null = null;

  try {
    const client = new RendererClient();
    const health = await client.health();
    let replayBytes: Uint8Array | undefined;
    if (replay) {
      replayBytes = await downloadDiscordReplay(replay, numberEnv("RENDER_MAX_REPLAY_BYTES", 16 * 1024 * 1024));
      if (replayBytes[0] === 0) ruleset = "osu";
      else if (replayBytes[0] === 3) ruleset = "mania";
    } else if (!ruleset && url) {
      ruleset = /\/scores\/(osu|mania)\//.exec(url)?.[1] as "osu" | "mania" | undefined;
    }
    const missing = renderMissingDependencies(health, Boolean(url), ruleset);
    if (missing.length) {
      await interaction.editReply({ content: degradedMessage(missing), embeds: [] });
      return;
    }
    await interaction.editReply({ content: url ? "🔎 osu! Resultを確認しています..." : "🔎 Replayファイルを確認しています..." });
    progressMessage = await interaction.fetchReply();

    let submitted: { job_id: string };
    if (url) {
      submitted = await client.submitScore(interaction.user.id, url, options);
    } else {
      submitted = await client.submitReplay(interaction.user.id, replayBytes!, options);
    }

    const timeoutAt = Date.now() + numberEnv("RENDER_POLL_TIMEOUT_MS", 2_100_000);
    const interval = numberEnv("RENDER_POLL_INTERVAL_MS", 4_000);
    let fingerprint = "";
    let connectionFailures = 0;
    while (Date.now() < timeoutAt) {
      let job: RenderJobStatus;
      try {
        job = await client.getJob(submitted.job_id);
        connectionFailures = 0;
      } catch (error) {
        if (error instanceof RendererClientError && ["RENDERER_OFFLINE", "RENDERER_TIMEOUT"].includes(error.code)) {
          connectionFailures += 1;
          if (connectionFailures >= 5) {
            await progressMessage.edit({ content: `⚠️ Rendererの状態を確認できません。Jobはキャンセルしていません。\nJob: \`${submitted.job_id}\`\n${publicAppUrl("/dashboard/videos")}`, embeds: [] });
            return;
          }
          await progressMessage.edit({ content: `🔄 Rendererの応答を待っています。再接続 ${connectionFailures}/5（処理は継続します）` });
          fingerprint = "";
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        }
        throw error;
      }
      const nextFingerprint = `${job.status}:${job.progress}:${job.queue_position}:${job.message}:${job.metadata?.score_id ?? ""}`;
      if (nextFingerprint !== fingerprint) {
        await progressMessage.edit({ content: null, embeds: [renderEmbed(job)], components: renderJobControls(job, interaction.user.id) });
        fingerprint = nextFingerprint;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        await progressMessage.edit({ content: ERROR_MESSAGES[job.error_code ?? ""] ?? "❌ レンダリングに失敗しました。Rendererログを確認してください。", embeds: [renderEmbed(job)], components: [] });
        return;
      }
      if (job.status === "completed") {
        let shared;
        if (job.youtube_url) {
          // YouTube has already returned a confirmed video URL. A second /share
          // request is unnecessary and can leave Discord on a stale status while
          // local/R2 cleanup or a renderer restart is in progress.
          shared = {
            url: job.youtube_url,
            size: job.output_size_bytes ?? 1,
            provider: "youtube" as const,
          };
        } else {
          await progressMessage.edit({
            content: "🗜️ 動画を圧縮して外部ストレージへアップロードしています...",
            embeds: [renderEmbed(job)],
          });
          shared = await client.shareVideo(job.job_id);
        }
        let highlightUrl: string | null = null;
        if (job.highlight_available) {
          highlightUrl = await client.shareHighlight(job.job_id).then((result) => result.url).catch((error) => {
            console.error(`[render] highlight share failed job=${job.job_id}:`, error);
            return null;
          });
        }
        const provider = shared.provider === "r2" ? "Cloudflare R2" : shared.provider === "vercel-blob" ? "Vercel Blob" : "YouTube";
        const youtubeUrl = job.youtube_url ?? (shared.provider === "youtube" ? shared.url : null);
        const components = downloadComponents(shared.url, youtubeUrl, shared.provider, highlightUrl);
        const inlineLink = components.length === 0 ? `\n${shared.url}` : "";
        const saved = shared.original_size && shared.original_size > shared.size
          ? ` · 圧縮前 ${fileSizeLabel(shared.original_size)}（${Math.round((1 - shared.size / shared.original_size) * 100)}%削減）`
          : "";
        const youtube = youtubeUrl
          ? `\n▶️ YouTubeへ${job.youtube_privacy_status === "unlisted" ? "限定公開" : job.youtube_privacy_status === "private" ? "非公開" : "公開"}で投稿しました。`
          : job.youtube_error
            ? "\n⚠️ YouTube自動投稿に失敗しました。Rendererログを確認してください。"
            : "";
        const completed = shared.provider === "youtube"
          ? `✅ YouTubeへ投稿しました。${inlineLink}${highlightUrl ? "\n✂️ ハイライトクリップも生成しました。" : ""}`
          : `✅ 圧縮済み動画を${provider}へ保存しました（${fileSizeLabel(shared.size)}${saved}）。${inlineLink}${youtube}${highlightUrl ? "\n✂️ ハイライトクリップも生成しました。" : ""}`;
        await progressMessage.edit({
          content: completed,
          embeds: [renderEmbed(job)],
          components,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    await progressMessage.edit({ content: `⏳ Discordでの進捗監視を終了しました。レンダリングは継続します。完了動画とYouTube投稿状況はWeb UIで確認できます。\nJob: \`${submitted.job_id}\`\n${publicAppUrl("/dashboard/videos")}`, embeds: [] });
  } catch (error) {
    // Deleting the progress message does not cancel the independently running
    // renderer/YouTube job. Avoid a second edit to the same deleted message.
    if (typeof error === "object" && error !== null && "code" in error && Number(error.code) === 10008) {
      console.warn("[render] progress message was deleted; render continues on the server");
      return;
    }
    const payload = { content: errorMessage(error), embeds: [] };
    if (progressMessage) await progressMessage.edit(payload);
    else await interaction.editReply(payload);
  }
}

function scoreUrlFromMessage(interaction: MessageContextMenuCommandInteraction) {
  const message = interaction.targetMessage;
  const candidates = [
    message.content,
    ...message.embeds.flatMap((embed) => [embed.url, embed.title, embed.description, ...embed.fields.flatMap((field) => [field.name, field.value])]),
  ].filter((value): value is string => Boolean(value));
  const pattern = /https:\/\/osu\.ppy\.sh\/scores\/(?:osu\/|mania\/)?[1-9][0-9]{0,18}/i;
  return candidates.map((value) => value.match(pattern)?.[0] ?? null).find(Boolean) ?? null;
}

export async function handleRenderMessageCommand(interaction: MessageContextMenuCommandInteraction) {
  const url = scoreUrlFromMessage(interaction);
  if (!url) {
    await interaction.reply({ content: "❌ このメッセージからosu!リザルトURLを見つけられませんでした。", flags: MessageFlags.Ephemeral });
    return;
  }
  await executeRender(interaction, url, null, {
    resolution: "1920x1080",
    fps: 60,
    speed: "original",
    motionBlur: false,
    highlight: false,
  });
}

export function isRenderJobButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith("render-job:");
}

export async function handleRenderJobButton(interaction: ButtonInteraction) {
  const [, jobId, ownerId, action] = interaction.customId.split(":");
  if (!jobId || !ownerId || !action || interaction.user.id !== ownerId) {
    await interaction.reply({ content: "このレンダージョブを操作できるのは開始したユーザーだけです。", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const client = new RendererClient();
  if (action === "cancel") await client.cancel(jobId);
  else if (action === "prioritize") await client.prioritize(jobId);
  const job = await client.getJob(jobId);
  await interaction.message.edit({ embeds: [renderEmbed(job)], components: renderJobControls(job, ownerId) });
}

export async function handleRenderStatusCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const health = await new RendererClient().health();
    const youtube = health.render_stats?.youtube;
    const embed = new EmbedBuilder()
      .setColor(health.status === "online" ? 0x55dd99 : 0xffaa55)
      .setTitle(`Renderer: ${health.status === "online" ? "Online" : "Degraded"}`)
      .addFields(
        { name: "Queue", value: String(health.queue_size), inline: true },
        { name: "Rendering", value: String(health.rendering), inline: true },
        { name: "Encoder", value: health.nvenc ? "NVENC" : health.amf ? "AMD AMF" : "CPU", inline: true },
        { name: "danser", value: health.danser ? "OK" : "NOT FOUND", inline: true },
        { name: "mania", value: health.mania_renderer ? "OK" : "NOT FOUND", inline: true },
        { name: "FFmpeg", value: health.ffmpeg ? "OK" : "NOT FOUND", inline: true },
        { name: "Songs", value: health.osu_songs ? `${health.songs_index_count.toLocaleString()} maps` : "NOT FOUND", inline: true },
        { name: "osu! API", value: health.osu_api ? "OK" : "MISSING CREDENTIALS", inline: true },
        { name: "YouTube", value: youtube?.auth_status === "reauthorization_required" ? "⚠️ 再認証が必要です（Web UIのレンダリング画面）" : health.youtube_upload ? `AUTO / ${(health.youtube_privacy_status ?? "unlisted").toUpperCase()}` : "NOT CONFIGURED", inline: true },
      );
    if (youtube?.pending_count) embed.addFields({ name: "YouTube再試行待ち", value: `${youtube.pending_count}件`, inline: true });
    await interaction.editReply({ embeds: [embed] });
  } catch {
    await interaction.editReply({ content: "Renderer: Offline\n\nこのPCで `renderer/start_renderer.bat` を起動してください。" });
  }
}

function degradedMessage(missing: string[]) {
  return `❌ Rendererは起動していますが、必要な設定が不足しています。\n\n不足: ${missing.join(", ")}\n\`renderer/.env\` とRendererコンソールを確認してください。`;
}
