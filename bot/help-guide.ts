import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, type StringSelectMenuInteraction } from "discord.js";
import { legacyCommands } from "./commands";

const sections = [
  { id: "osu", label: "osu!・成長・ライバル", names: ["osu", "stats", "analysis", "session", "profile-card", "goal", "leaderboard", "rival", "track-player", "overlay"] },
  { id: "render", label: "レンダリング・動画", names: ["render", "render-batch", "render-status", "render-schedule", "render-compare", "render-versus", "montage"] },
  { id: "music", label: "音楽・プレイリスト", names: ["music"] },
  { id: "tools", label: "便利機能・状態確認", names: ["help", "ping", "health", "remind", "pomodoro", "export", "feedback"] },
  { id: "admin", label: "サーバー管理・認証", names: ["setup", "panel", "reports", "admin-log", "updates", "server-status", "verify", "verify-panel", "onboarding", "ticket", "community"] },
];

export function helpReply(sectionId = "osu") {
  const section = sections.find((item) => item.id === sectionId) ?? sections[0];
  const embed = new EmbedBuilder().setColor(0xff66aa).setTitle(`osu! Pulse · ${section.label}`)
    .setDescription("すべて `/pulse` の操作メニューから使えます。下は機能の一覧です。管理者用・運用者用は権限に応じて表示されます。")
    .setFooter({ text: "管理用の操作には権限が必要です · 不具合・要望も /pulse から" });
  for (const command of legacyCommands) {
    if (!section.names.includes(command.name) || !("description" in command)) continue;
    const subcommands = command.options?.filter((option) => option.type === 1 || option.type === 2).map((option) => `\`${option.name}\``) ?? [];
    embed.addFields({ name: command.name, value: `${command.description}${subcommands.length ? `\n${subcommands.join(" · ")}` : ""}`.slice(0, 1024) });
  }
  if (section.id === "render") embed.addFields({ name: "メッセージから", value: "リザルトを右クリック／長押し → アプリ → osu!リザルトをレンダリング" });
  if (section.id === "osu") embed.addFields({ name: "初めての方", value: "`/pulse` → osu! → 登録 → プロフィール → 成長を確認できます。" });
  if (section.id === "music") embed.addFields({ name: "再生の流れ", value: "VCへ参加 → `/pulse` → 音楽 → 検索・再生 → 候補を選択。再生パネルから音量・停止・ループを操作できます。" });
  const select = new StringSelectMenuBuilder().setCustomId("help-guide:section").setPlaceholder("機能のカテゴリを選択")
    .addOptions(sections.map((item) => ({ label: item.label, value: item.id, default: item.id === section.id })));
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

export function isHelpSelect(interaction: StringSelectMenuInteraction) {
  return interaction.customId === "help-guide:section";
}

export async function handleHelpSelect(interaction: StringSelectMenuInteraction) {
  await interaction.update(helpReply(interaction.values[0]));
}
