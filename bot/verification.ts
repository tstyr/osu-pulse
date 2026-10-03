import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { setLinkedPrimaryMode } from "@/db/repository";
import { registerOsuAccount } from "@/services/osu-sync";

import {
  parseLanguageStepCustomId,
  VERIFICATION_LANGUAGE_ROLES,
  VERIFICATION_MODE_ROLES,
  type VerificationAccountState as AccountState,
  type VerificationLanguageKey as LanguageKey,
  type VerificationModeKey as ModeKey,
} from "./verification-config";

const PREFIX = "osu-verify";

function roleByName(guild: Guild, name: string) {
  const normalized = name.toLocaleLowerCase("en-US");
  return guild.roles.cache.find((role) => role.name.toLocaleLowerCase("en-US") === normalized);
}

function accountStep() {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:account`)
      .setLabel("osu!ユーザー名を入力")
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:no-account`)
      .setLabel("osu!アカウントを持っていない")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xff66aa)
      .setTitle("認証 1/3 · osu!アカウント")
      .setDescription("osu!のユーザー名を登録すると、その場でDBへ保存して4モードの集計を開始します。アカウントがない場合も次へ進めます。")],
    components: [row],
  };
}

function availableModeRoles(guild: Guild) {
  return VERIFICATION_MODE_ROLES.filter((definition) => roleByName(guild, definition.roleName));
}

function availableLanguageRoles(guild: Guild) {
  return VERIFICATION_LANGUAGE_ROLES.filter((definition) => roleByName(guild, definition.roleName));
}

function modeStep(guild: Guild, accountState: AccountState, accountMessage: string) {
  const available = availableModeRoles(guild);
  if (available.length === 0) {
    throw new Error("モードロール（std / mania / taiko / catch）がサーバーに見つかりません。");
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:modes:${accountState}`)
    .setPlaceholder("付与したいモードロールを選択（複数可）")
    .setMinValues(1)
    .setMaxValues(available.length)
    .addOptions(available.map((definition) => ({
      label: definition.label,
      value: definition.key,
      description: `既存の「${definition.roleName}」ロールを付与`,
    })));
  const unavailable = VERIFICATION_MODE_ROLES
    .filter((definition) => !available.includes(definition))
    .map((definition) => definition.roleName);
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x8c7cff)
      .setTitle("認証 2/3 · プレイモード")
      .setDescription(`${accountMessage}\n\nプレイするモードを1つ以上選んでください。${unavailable.length ? `\n未検出: ${unavailable.join(" / ")}` : ""}`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

function languageStep(guild: Guild, accountState: AccountState, modes: ModeKey[]) {
  const available = availableLanguageRoles(guild);
  if (available.length === 0) {
    throw new Error("言語ロール（Japan / America / Russia / Korea / Brazil）がサーバーに見つかりません。");
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:language:${accountState}:${modes.join(",")}`)
    .setPlaceholder("付与したい言語ロールを1つ選択")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(available.map((definition) => ({
      label: definition.label,
      value: definition.key,
      description: `既存の「${definition.roleName}」ロールを付与`,
    })));
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xf48120)
      .setTitle("認証 3/3 · 言語")
      .setDescription(`モード: **${modes.join(" / ")}**\n最後に言語ロールを1つ選んでください。`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

async function refreshRoles(guild: Guild) {
  await guild.roles.fetch();
}

export function isVerificationButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith(`${PREFIX}:`);
}

export function isVerificationSelect(interaction: StringSelectMenuInteraction) {
  return interaction.customId.startsWith(`${PREFIX}:`);
}

export function isVerificationModal(interaction: ModalSubmitInteraction) {
  return interaction.customId === `${PREFIX}:username`;
}

export async function handleVerificationCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "サーバー内で実行してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "verify-panel") {
    const button = new ButtonBuilder()
      .setCustomId(`${PREFIX}:start`)
      .setLabel("認証を始める")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xff66aa)
        .setTitle("サーバー認証")
        .setDescription("下のボタンからosu!アカウントとロールを登録してください。入力内容と選択画面は本人にだけ表示されます。")],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
    return;
  }
  await interaction.reply({ ...accountStep(), flags: MessageFlags.Ephemeral });
}

export async function handleVerificationButton(interaction: ButtonInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "サーバー内で操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === `${PREFIX}:start`) {
    await interaction.reply({ ...accountStep(), flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === `${PREFIX}:account`) {
    const input = new TextInputBuilder()
      .setCustomId("username")
      .setLabel("osu!ユーザー名 または User ID")
      .setPlaceholder("例: hakaka_aa")
      .setMinLength(1)
      .setMaxLength(64)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);
    const modal = new ModalBuilder()
      .setCustomId(`${PREFIX}:username`)
      .setTitle("osu!アカウント登録")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId === `${PREFIX}:no-account`) {
    await refreshRoles(interaction.guild);
    await interaction.update(modeStep(interaction.guild, "none", "osu!アカウントなしで認証を続けます。"));
  }
}

export async function handleVerificationModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "サーバー内で操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const username = interaction.fields.getTextInputValue("username").trim();
  try {
    const result = await registerOsuAccount({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      username,
      primaryMode: "osu",
    });
    await refreshRoles(interaction.guild);
    await interaction.editReply(modeStep(
      interaction.guild,
      "linked",
      `✅ **${result.account.username}** をDBへ登録し、${result.capturedModes}モード・最近の${result.importedScores}件を取り込みました。集計はこのまま自動継続します。`,
    ));
  } catch (error) {
    console.error("[verification] osu account registration failed:", error);
    await interaction.editReply({
      content: "⚠️ osu!ユーザーが見つからないか、APIへ接続できませんでした。名前を確認してもう一度認証を開始してください。",
      components: [],
      embeds: [],
    });
  }
}

export async function handleVerificationSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "サーバー内で操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId.startsWith(`${PREFIX}:modes:`)) {
    const accountState = interaction.customId.endsWith(":linked") ? "linked" : "none";
    const allowed = new Set(VERIFICATION_MODE_ROLES.map((definition) => definition.key));
    const modes = interaction.values.filter((value): value is ModeKey => allowed.has(value as ModeKey));
    if (modes.length === 0) throw new Error("モードを1つ以上選択してください。");
    await refreshRoles(interaction.guild);
    await interaction.update(languageStep(interaction.guild, accountState, modes));
    return;
  }

  const state = parseLanguageStepCustomId(interaction.customId);
  if (!state) throw new Error("認証画面の情報が壊れています。/verify からやり直してください。");
  const languageKey = interaction.values[0] as LanguageKey | undefined;
  const languageDefinition = VERIFICATION_LANGUAGE_ROLES.find((definition) => definition.key === languageKey);
  if (!languageDefinition) throw new Error("言語ロールを1つ選択してください。");

  await interaction.deferUpdate();
  await refreshRoles(interaction.guild);
  const modeDefinitions = state.modes.map((key) => VERIFICATION_MODE_ROLES.find((definition) => definition.key === key)!);
  const selectedRoles = [
    ...modeDefinitions.map((definition) => roleByName(interaction.guild!, definition.roleName)),
    roleByName(interaction.guild, languageDefinition.roleName),
  ];
  const missing = selectedRoles.map((role, index) => role ? null : index < modeDefinitions.length ? modeDefinitions[index].roleName : languageDefinition.roleName).filter(Boolean);
  if (missing.length) throw new Error(`既存ロールが見つかりません: ${missing.join(" / ")}`);
  const blocked = selectedRoles.filter((role) => role && !role.editable).map((role) => role!.name);
  if (blocked.length) throw new Error(`Botのロールを次のロールより上へ移動してください: ${blocked.join(" / ")}`);

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const otherLanguageRoles = VERIFICATION_LANGUAGE_ROLES
    .filter((definition) => definition.key !== languageKey)
    .map((definition) => roleByName(interaction.guild!, definition.roleName))
    .filter((role) => role && member.roles.cache.has(role.id) && role.editable);
  if (otherLanguageRoles.length) {
    await member.roles.remove(otherLanguageRoles.map((role) => role!.id), "osu! Pulse verification language update");
  }
  await member.roles.add(selectedRoles.map((role) => role!.id), "osu! Pulse verification");

  if (state.accountState === "linked") {
    await setLinkedPrimaryMode(interaction.user.id, modeDefinitions[0].mode);
  }
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ 認証が完了しました")
      .setDescription(`付与したモード: **${modeDefinitions.map((definition) => definition.label).join(" / ")}**\n言語: **${languageDefinition.label}**${state.accountState === "linked" ? "\nosu!の統計収集も有効です。" : "\nosu!アカウントは未登録です。"}`)],
    components: [],
  });
}
