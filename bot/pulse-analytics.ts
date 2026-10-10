import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { statfs } from "node:fs/promises";
import { desc } from "drizzle-orm";
import { getDb } from "../src/db";
import { renderVideos } from "../src/db/schema";
import { getAccountByDiscord, getPlayerScoreHistory } from "../src/db/repository";
import { getPublicServiceStatus } from "../src/db/advanced-features";
import { isOsuMode, MODE_LABELS } from "../src/lib/osu/modes";
import { publicAppUrl } from "../src/lib/public-app-url";
import { RendererClient } from "./renderer-client";
import { dailyPlays, deviation, firstMilestones, improvementCandidates, mean, playSessions, validPlays, type AnalysisPlay } from "./pulse-analysis";

const pp = (value: number) => `${value.toFixed(2)}pp`;
const accuracy = (value: number) => `${(value * 100).toFixed(2)}%`;
const date = (value: Date) => value.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const safe = (value: string) => value.replace(/[\[\]()`*_~<>]/g, "").slice(0, 80);
const link = (play: AnalysisPlay) => `[${safe(play.title)}「${safe(play.difficulty)}」](https://osu.ppy.sh/scores/${play.osuScoreId})`;
const bytes = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GiB`;
function summary(plays: AnalysisPlay[]) {
  const points = plays.flatMap((play) => play.pp !== null && Number.isFinite(play.pp) ? [play.pp] : []);
  return `${plays.length}プレイ · 平均 ${points.length ? pp(mean(points)) : "未記録"} · 最高 ${points.length ? pp(Math.max(...points)) : "未記録"}\n平均精度 ${accuracy(mean(plays.map((play) => play.accuracy)))} · PB ${plays.filter((play) => play.isPersonalBest).length}件 · 未クリア ${plays.filter((play) => !play.passed).length}件`;
}
async function systemReport(kind: string, gatewayPing: number) {
  const embed = new EmbedBuilder().setColor(0x8c7cff).setTitle(kind === "storage" ? "ストレージ状況 · 確認のみ" : "ワーカー稼働状況");
  const [health, disk] = await Promise.all([new RendererClient().health().catch(() => null), statfs(process.cwd()).catch(() => null)]);
  if (kind === "storage") {
    embed.addFields({ name: "Botホストのディスク", value: disk ? `使用 ${bytes((disk.blocks - disk.bfree) * disk.bsize)} / 全体 ${bytes(disk.blocks * disk.bsize)}\n空き ${bytes(disk.bavail * disk.bsize)}` : "取得できません" },
      { name: "PC・USB側（Renderer報告）", value: health ? `使用 ${bytes(health.system.disk_used_bytes)} / 全体 ${bytes(health.system.disk_total_bytes)}\n動画 ${health.render_stats.video_count}本 · ${bytes(health.render_stats.video_bytes)}\n譜面保存先: ${health.render_stats.storage?.songs_available ? "利用可能" : "未取得／利用不可"}` : "PCオフライン／未取得。USB単体の使用量とは区別しています。" });
    // Bounded index-ordered read; do not scan a bucket or walk the PC's file tree.
    const recent = await getDb().select({ title: renderVideos.title, cleanup: renderVideos.cleanup, status: renderVideos.status })
      .from(renderVideos).orderBy(desc(renderVideos.uploadedAt)).limit(50);
    const candidates = recent.filter((video) => video.status === "active" && (video.cleanup?.r2_deleted === false || video.cleanup?.local_deleted === false));
    embed.addFields({ name: "YouTube投稿後の削除候補（直近50本から）", value: candidates.length ? candidates.slice(0, 8).map((video) => `• ${safe(video.title)} · ${[video.cleanup?.r2_deleted === false ? "R2残存記録" : "", video.cleanup?.local_deleted === false ? "PC残存記録" : ""].filter(Boolean).join(" / ")}`).join("\n") : "残存が明示された候補はありません。未取得を空き容量0として扱いません。" },
      { name: "R2", value: `${process.env.R2_ENDPOINT && process.env.R2_BUCKET ? "接続設定あり" : "設定未取得（管理画面の設定も確認してください）"} · 実容量は未取得\n自動削除は実行しません。[動画管理を開く](${publicAppUrl("/dashboard/videos")})` });
  } else {
    const status = await getPublicServiceStatus();
    embed.setDescription("Bot・Web・DBはOracle、レンダリング・音楽・YouTubeはPC側。Windows／Archは同時ではなく起動中のOSが担当します。");
    for (const service of status.services.filter((item) => item.name !== "web").slice(0, 18)) embed.addFields({ name: safe(service.name), value: `${safe(service.status)} · 最終報告 <t:${Math.floor(new Date(service.lastSeenAt).getTime() / 1000)}:R>`, inline: true });
    embed.addFields({ name: "Discord Gateway", value: `${Math.round(Math.max(0, gatewayPing))}ms · ${Math.floor(process.uptime() / 60)}分稼働`, inline: true },
      { name: "PC Renderer", value: health ? `${health.status} · 実行 ${health.rendering} / 待機 ${health.queue_size}\nYouTube ${health.youtube_upload ? "設定あり" : "未設定／無効"}` : "オフライン／応答なし", inline: true });
  }
  return embed;
}
export async function handlePulseAnalytics(interaction: ChatInputCommandInteraction, kind: string) {
  await interaction.deferReply();
  if (kind === "storage" || kind === "workers") {
    await interaction.editReply({ embeds: [await systemReport(kind, interaction.client.ws.ping)] }); return;
  }
  const account = await getAccountByDiscord(interaction.user.id);
  if (!account) { await interaction.editReply("まず `/pulse` → osu! → アカウント登録からosu!ユーザー名を登録してください。"); return; }
  const requested = interaction.options.getString("mode");
  const mode = isOsuMode(requested) ? requested : account.primaryMode;
  const plays = validPlays(await getPlayerScoreHistory(account.id, mode));
  const embed = new EmbedBuilder().setColor(0xff66aa).setAuthor({ name: `${account.username} · ${MODE_LABELS[mode]}` })
    .setFooter({ text: `DB保存済み ${plays.length}件に基づく分析 · 未収集期間は含みません` });
  if (!plays.length) { embed.setTitle("まだ分析用の記録がありません").setDescription("統計収集後にもう一度お試しください。"); }
  else if (kind === "stability") {
    const recent = plays.slice(-100);
    const accuracies = recent.map((play) => play.accuracy);
    embed.setTitle("安定性分析 · 直近100プレイまで").setDescription(`${summary(recent)}\n\n精度の標準偏差 **${(deviation(accuracies) * 100).toFixed(2)}ポイント**（小さいほど安定）\nミス判定数はDB未記録のため表示していません。`);
    const groups = new Map<string, AnalysisPlay[]>();
    for (const play of recent) {
      if (play.starRating === null) continue;
      const bucket = Math.floor(play.starRating / 0.5) * 0.5;
      const key = `★${bucket.toFixed(1)}–${(bucket + 0.5).toFixed(1)} / ${[...play.mods].sort().join("") || "NM"}`;
      const group = groups.get(key) ?? []; group.push(play); groups.set(key, group);
    }
    for (const [key, group] of [...groups].filter(([, group]) => group.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 8)) embed.addFields({ name: key, value: `${group.length}件 · 平均 ${accuracy(mean(group.map((p) => p.accuracy)))} · σ ${(deviation(group.map((p) => p.accuracy)) * 100).toFixed(2)}pt`, inline: true });
  } else if (kind === "fatigue") {
    const session = playSessions(plays).at(-1)!;
    embed.setTitle("セッション前半・後半の比較");
    if (session.length < 6) embed.setDescription(`直近は${session.length}プレイ。比較には6プレイ以上必要です。`);
    else {
      const middle = Math.floor(session.length / 2), first = session.slice(0, middle), last = session.slice(middle);
      embed.addFields({ name: "前半", value: summary(first) }, { name: "後半", value: summary(last) });
      embed.setDescription(`精度差 **${((mean(last.map((p) => p.accuracy)) - mean(first.map((p) => p.accuracy))) * 100).toFixed(2)}ポイント**\n難易度・MOD・曲の選択でも変わります。疲労の診断ではありません。`);
    }
  } else if (kind === "improve") {
    const candidates = improvementCandidates(plays);
    embed.setTitle("自己ベスト更新の練習候補").setDescription("同じ譜面・同じMODで、直近のPPが保存済みベストを下回る譜面。推定PPではなく、実績を取り戻すための候補です。");
    for (const item of candidates) embed.addFields({ name: `${pp(item.gap)}の差 · ${item.tries}回`, value: `${link(item.best)}\nベスト ${pp(item.best.pp!)} → 直近 ${pp(item.latest.pp!)} · ${item.best.mods.join("") || "NM"}` });
    if (!candidates.length) embed.addFields({ name: "候補なし", value: "同条件の複数回プレイを保存すると分析できます。" });
  } else if (kind === "milestones") {
    embed.setTitle("初達成・マイルストーン").setDescription("保存済み記録の中での初達成です。アカウント作成以来の全履歴を保証するものではありません。");
    for (const item of firstMilestones(plays).slice(0, 15)) embed.addFields({ name: `${item.label} · ${date(item.play.endedAt)}`, value: `${link(item.play)} · ${pp(item.play.pp ?? 0)} · ${item.play.rank}` });
    if (!embed.data.fields?.length) embed.addFields({ name: "記録待ち", value: "50pp以上／S以上の保存済みリザルトはまだありません。" });
  } else if (kind === "calendar") {
    const days = dailyPlays(plays);
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const end = new Date(`${today}T00:00:00Z`);
    const cells = Array.from({ length: 35 }, (_, index) => {
      const day = new Date(end.getTime() - (34 - index) * 86_400_000).toISOString().slice(0, 10);
      const item = days.get(day);
      return { day, item, icon: !item ? "⬜" : item.count >= 20 ? "🟩" : item.count >= 5 ? "🟦" : "🟨" };
    });
    embed.setTitle("プレイカレンダー · 直近35日 / JST").setDescription(`${cells[0].day} → ${today}\n${Array.from({ length: 5 }, (_, week) => cells.slice(week * 7, week * 7 + 7).map((cell) => cell.icon).join("")).join("\n")}\n⬜0 · 🟨1–4 · 🟦5–19 · 🟩20+プレイ`);
    embed.addFields({ name: "日別の詳細（直近10日）", value: cells.filter((cell) => cell.item).slice(-10).map(({ day, item }) => `${day.slice(5)} · ${item!.count}回 · 平均 ${item!.pp.length ? pp(mean(item!.pp)) : "—"} · 最高 ${item!.pp.length ? pp(Math.max(...item!.pp)) : "—"}`).join("\n") || "直近35日の記録はありません。" });
    embed.addFields({ name: "PPについて", value: "各プレイの獲得PPを表示しています。プロフィール総PPの増加量ではありません。" });
  } else if (kind === "bests") {
    const unique = new Map<string, AnalysisPlay>();
    for (const play of plays.filter((play) => play.passed && play.pp !== null)) {
      const key = `${play.beatmapId}:${[...play.mods].sort().join(",")}`;
      if (!unique.has(key) || unique.get(key)!.pp! < play.pp!) unique.set(key, play);
    }
    embed.setTitle("個人ベスト · 保存済み譜面別TOP10");
    for (const [index, play] of [...unique.values()].sort((a, b) => b.pp! - a.pp!).slice(0, 10).entries()) embed.addFields({ name: `${index + 1}. ${pp(play.pp!)} · ${play.rank} · ${accuracy(play.accuracy)}`, value: `${link(play)} · ${play.mods.join("") || "NM"}` });
    if (!embed.data.fields?.length) embed.setDescription("PP付きのクリア記録がありません。");
  } else if (kind === "compare-sessions") {
    const sessions = playSessions(plays).slice(-2);
    embed.setTitle("直近2セッションの比較").setDescription("45分以上のプレイ間隔でセッションを区切っています。");
    for (const [index, session] of sessions.entries()) embed.addFields({ name: `${sessions.length === 2 && index === 0 ? "前回" : "直近"} · ${date(session[0].endedAt)}〜${date(session.at(-1)!.endedAt)}`, value: summary(session) });
    if (sessions.length < 2) embed.addFields({ name: "比較待ち", value: "まだ1セッションです。次回のプレイ後に比較できます。" });
  }
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
