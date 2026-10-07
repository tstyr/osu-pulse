import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { MessageFlags, type Interaction, type InteractionReplyOptions, type RepliableInteraction } from "discord.js";
import { recordBotError } from "../src/db/feature-repository";
import { markBotCommandFailed } from "./command-telemetry";

export function interactionErrorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
  if (code === 10008) return "元のメッセージが削除されています。コマンドをもう一度実行して、新しいパネルを開いてください。";
  if (code === 10062 || code === 40060) return "操作の受付期限が切れたか、すでに受け付け済みです。状態を確認してからもう一度実行してください。";
  if (code === 50001 || code === 50013) return "Botの権限が足りません。対象チャンネルの閲覧・送信権限と、操作に必要なロール権限を確認してください。";
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
  if (/Failed query|database|postgres|neon|quota exceeded|ECONNREFUSED.*543\d\d/i.test(message)) {
    return "DBに接続できませんでした。ローカルDBの稼働状態を確認してから再試行してください。";
  }
  if (/timeout|timed out|ETIMEDOUT|fetch failed|ECONNRESET/i.test(message)) {
    return "接続先の応答を確認できませんでした。少し待ってから状態を確認してください。";
  }
  // Keep user-facing validation guidance, not raw upstream payloads, URLs or stack traces.
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(message) && !/https?:\/\/|token|secret|password|api[_ -]?key|\bat\s+\S+\(/i.test(message)) return message.slice(0, 350);
  return "操作を完了できませんでした。もう一度試し、繰り返す場合はエラーIDを管理者に伝えてください。";
}

export async function sendInteractionError(interaction: RepliableInteraction, content: string) {
  const privateReply: InteractionReplyOptions = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  // A component's editReply may target the shared music/render panel: never replace it with an error.
  if (interaction.replied || (interaction.deferred && interaction.ephemeral === null && (interaction.isMessageComponent() || interaction.isModalSubmit()))) {
    await interaction.followUp(privateReply);
  } else if (interaction.deferred) {
    try {
      await interaction.editReply({ content, components: [], embeds: [], allowedMentions: { parse: [] } });
    } catch {
      await interaction.followUp(privateReply);
    }
  } else {
    await interaction.reply(privateReply);
  }
}

export async function reportInteractionError(interaction: Interaction, error: unknown) {
  markBotCommandFailed(interaction);
  const traceId = randomBytes(5).toString("hex").toUpperCase();
  console.error(`[interaction:${traceId}] failed:`, error);
  const logDirectory = resolve(process.cwd(), "work");
  void mkdir(logDirectory, { recursive: true }).then(() => appendFile(resolve(logDirectory, "interaction-errors.jsonl"), `${JSON.stringify({
    traceId, occurredAt: new Date().toISOString(),
    command: interaction.isCommand() ? interaction.commandName : "component",
    message: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
    stack: error instanceof Error ? error.stack?.slice(0, 12000) : undefined,
  })}\n`, "utf8")).catch(() => console.warn(`[interaction:${traceId}] local file log unavailable.`));
  // Log asynchronously so a database outage cannot consume Discord's acknowledgement deadline.
  void recordBotError({ traceId, command: interaction.isCommand() ? interaction.commandName : "component", discordUserId: interaction.user.id, guildId: interaction.guildId, error })
    .catch(() => console.warn(`[interaction:${traceId}] DB log unavailable; details remain in the Bot log.`));
  if (interaction.isAutocomplete()) {
    if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
  } else if (interaction.isRepliable()) {
    await sendInteractionError(interaction, `⚠️ ${interactionErrorMessage(error)}\nエラーID: \`${traceId}\``)
      .catch(() => console.warn(`[interaction:${traceId}] reply unavailable or expired.`));
  }
}
