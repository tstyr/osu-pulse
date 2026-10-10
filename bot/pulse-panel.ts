import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, EmbedBuilder,
  FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type ButtonInteraction, type ChannelType, type Client, type Interaction,
  type InteractionReplyOptions, type MessageActionRowComponentBuilder,
  type MessageComponentInteraction, type ModalSubmitInteraction,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";
import { canUsePulseAction, pulseActions, pulseCategories, validatePulseValue, type PulseAction, type PulseActor, type PulseOption } from "./pulse-catalog";
import { PulseSessionStore, type PulseSession } from "./pulse-session";
import { pulseCommandInteraction } from "./pulse-adapter";
import { handleCommand } from "./handlers";
import { measureBotCommand } from "./command-telemetry";
import { getRenderableRecentPlays } from "./render";
import { renderAccountChoiceName } from "./render-choice";
import { handlePulseAnalytics } from "./pulse-analytics";

type Context = { client: Client; lavalink: LavalinkManager | null };
type InputInteraction = MessageComponentInteraction | ModalSubmitInteraction;
const store = new PulseSessionStore();
const operators = new Set<string>();
export async function initializePulseOperators(client: Client) {
  const app = await client.application?.fetch();
  const owner = app?.owner;
  const ownerId = owner && ("ownerId" in owner ? owner.ownerId : owner.id);
  if (ownerId) operators.add(ownerId);
}
function actor(interaction: Pick<Interaction, "user" | "guildId" | "memberPermissions">): PulseActor {
  const configured = (process.env.CONTROL_PANEL_DISCORD_ADMIN_IDS ?? "").split(",").map((id) => id.trim());
  return { userId: interaction.user.id, guildId: interaction.guildId, permissions: interaction.memberPermissions?.bitfield ?? BigInt(0),
    operator: operators.has(interaction.user.id) || configured.includes(interaction.user.id) };
}
const cut = (value: string, length: number) => value.slice(0, length);
const id = (session: PulseSession, operation: string) => `pulse:${session.id}:${session.revision}:${operation}`;
function button(session: PulseSession, operation: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id(session, operation)).setLabel(label).setStyle(style);
}
function row(...items: MessageActionRowComponentBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(items);
}
function displayValue(value: unknown) {
  if (value == null) return "未指定（既定値）";
  if (typeof value === "boolean") return value ? "オン" : "オフ";
  if (typeof value === "object") {
    const object = value as { name?: string; username?: string; id?: string };
    return cut(object.name ?? object.username ?? object.id ?? "選択済み", 70);
  }
  return cut(String(value), 70).replace(/`/g, "ʼ");
}
function view(session: PulseSession, currentActor: PulseActor, notice?: string) {
  const allowed = pulseActions.filter((action) => canUsePulseAction(action, currentActor));
  const categories = pulseCategories.filter((category) => allowed.some((action) => action.category === category.id));
  if (!categories.some((category) => category.id === session.category)) session.category = categories[0].id;
  const selected = allowed.find((action) => action.id === session.action);
  const embed = new EmbedBuilder().setColor(0xff66aa).setTitle("osu! Pulse · 操作メニュー")
    .setFooter({ text: "本人専用 · 操作のたびに権限確認 · 再起動／1時間未操作で開き直し" });
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (selected) {
    embed.setTitle(cut(selected.label, 256)).setDescription(`${selected.description}\n${notice ?? "項目を選んで入力 → 実行。任意項目は未指定のまま利用できます。"}`);
    if (selected.options.length) {
      embed.addFields(selected.options.map((option) => ({ name: cut(`${option.required ? "必須 · " : ""}${option.description}`, 256), value: displayValue(session.values[option.name]), inline: true })));
      components.push(row(new StringSelectMenuBuilder().setCustomId(id(session, "field")).setPlaceholder("設定する項目を選択")
        .addOptions(selected.options.map((option) => ({ label: cut(`${option.required ? "必須 · " : ""}${option.description}`, 100), value: option.name, description: cut(option.name, 100) })))));
    }
    if (session.confirming) {
      embed.addFields({ name: "実行の確認", value: "削除・停止など、取り消せない場合がある操作です。設定内容を確認してください。" });
      components.push(row(button(session, "confirm", "確認して実行", ButtonStyle.Danger), button(session, "cancel-confirm", "戻る")));
    } else components.push(row(button(session, "run", "実行", ButtonStyle.Success), button(session, "reset", "入力をリセット"), button(session, "home", "カテゴリへ戻る")));
  } else {
    embed.setDescription(notice ?? "すべての機能をここから操作できます。管理者・運用者のメニューは権限のある方だけ表示されます。");
    components.push(row(new StringSelectMenuBuilder().setCustomId(id(session, "category")).setPlaceholder("カテゴリを選択")
      .addOptions(categories.map((category) => ({ label: category.label, value: category.id, default: category.id === session.category })))));
    const actions = allowed.filter((action) => action.category === session.category);
    const pages = Math.max(1, Math.ceil(actions.length / 25));
    session.page = Math.max(0, Math.min(session.page, pages - 1));
    components.push(row(new StringSelectMenuBuilder().setCustomId(id(session, "action")).setPlaceholder(`機能を選択 · ${session.page + 1}/${pages}`)
      .addOptions(actions.slice(session.page * 25, session.page * 25 + 25).map((action) => ({ label: cut(action.label, 100), value: action.id, description: cut(action.description, 100) })))));
    components.push(row(button(session, "prev", "前へ").setDisabled(session.page === 0), button(session, "next", "次へ").setDisabled(session.page >= pages - 1), button(session, "home", "ホーム")));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] as never[] } };
}
async function update(interaction: InputInteraction, session: PulseSession, notice?: string) {
  const payload = view(session, actor(interaction), notice);
  if (interaction.deferred) await interaction.editReply(payload);
  else if (interaction.isMessageComponent() || interaction.isModalSubmit() && interaction.isFromMessage()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
async function editField(interaction: MessageComponentInteraction, session: PulseSession, action: PulseAction, option: PulseOption) {
  session.option = option.name;
  session.confirming = false;
  if ([3, 4, 10, 11].includes(option.type) && !option.choices && !(action.root === "render" && option.name === "account")) {
    const modal = new ModalBuilder().setCustomId(id(session, "input")).setTitle(cut(option.description, 45));
    const label = new LabelBuilder().setLabel(cut(option.description, 45));
    if (option.type === 11) label.setFileUploadComponent(new FileUploadBuilder().setCustomId("value").setRequired(!!option.required).setMinValues(option.required ? 1 : 0).setMaxValues(1));
    else {
      const input = new TextInputBuilder().setCustomId("value").setStyle((option.max_length ?? 0) > 200 ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(!!option.required).setMaxLength(Math.min(4000, option.type === 3 ? option.max_length ?? 4000 : 100));
      if (option.min_length) input.setMinLength(option.min_length);
      if (session.values[option.name] != null) input.setValue(cut(String(session.values[option.name]), 4000));
      label.setTextInputComponent(input);
    }
    await interaction.showModal(modal.addLabelComponents(label));
    return;
  }
  let select: MessageActionRowComponentBuilder;
  if (option.type === 6) select = new UserSelectMenuBuilder().setCustomId(id(session, "value")).setPlaceholder("ユーザーを選択").setMinValues(option.required ? 1 : 0).setMaxValues(1);
  else if (option.type === 7) {
    const channels = new ChannelSelectMenuBuilder().setCustomId(id(session, "value")).setPlaceholder("チャンネルを選択").setMinValues(option.required ? 1 : 0).setMaxValues(1);
    if (option.channel_types?.length) channels.setChannelTypes(option.channel_types as ChannelType[]);
    select = channels;
  } else if (option.type === 8) select = new RoleSelectMenuBuilder().setCustomId(id(session, "value")).setPlaceholder("ロールを選択").setMinValues(option.required ? 1 : 0).setMaxValues(1);
  else {
    let choices = option.type === 5 ? [{ name: "オン", value: "true" }, { name: "オフ", value: "false" }]
      : (option.choices ?? []).map((choice) => ({ name: choice.name, value: String(choice.value) }));
    if (action.root === "render" && option.name === "account") {
      await interaction.deferUpdate();
      const recent = await getRenderableRecentPlays(interaction.user.id, true);
      choices = recent.plays.slice(0, 25).map((play) => ({ name: renderAccountChoiceName(play), value: `${play.ruleset}:${play.scoreId}` }));
      if (!choices.length) { await update(interaction, session, "最近のプレイがありません。アカウント登録・リプレイの有無を確認するか、URL／.osrを指定してください。"); return; }
    }
    select = new StringSelectMenuBuilder().setCustomId(id(session, "value")).setPlaceholder(cut(option.description, 100))
      .setMinValues(option.required ? 1 : 0).setMaxValues(1).addOptions(choices.map((choice) => ({ label: cut(choice.name, 100), value: choice.value })));
  }
  const controls = [button(session, "back", "入力一覧へ")];
  if (!option.required) controls.push(button(session, "clear", "未指定に戻す"));
  const payload = { embeds: [new EmbedBuilder().setColor(0xff66aa).setTitle(cut(option.description, 256)).setDescription("選択すると入力一覧へ戻ります。")], components: [row(select), row(...controls)], allowedMentions: { parse: [] as never[] } };
  if (interaction.deferred) await interaction.editReply(payload); else await interaction.update(payload);
}
export function isPulseInteraction(interaction: Interaction) {
  return interaction.isChatInputCommand() && interaction.commandName === "pulse"
    || "customId" in interaction && interaction.customId.startsWith("pulse:");
}
export async function handlePulseInteraction(interaction: Interaction, context: Context) {
  if (interaction.isChatInputCommand() || interaction.isButton() && interaction.customId === "pulse:open") {
    const session = store.create(interaction.user.id, interaction.guildId, interaction.channelId);
    await interaction.reply({ ...view(session, actor(interaction)), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(interaction.isMessageComponent() || interaction.isModalSubmit())) return;
  const parts = interaction.customId.split(":");
  const session = store.get(parts[1], interaction.user.id, interaction.guildId, interaction.channelId);
  if (!session) {
    await interaction.reply({ content: "このメニューは期限切れ・再起動後、または別の方のものです。新しく開き直してください。", flags: MessageFlags.Ephemeral,
      components: [row(new ButtonBuilder().setCustomId("pulse:open").setLabel("自分のメニューを開く").setStyle(ButtonStyle.Primary))] });
    return;
  }
  if (!store.claim(session, Number(parts[2]))) { await update(interaction, session, "画面が更新されています。最新のメニューから選び直してください。"); return; }
  const operation = parts[3];
  const currentActor = actor(interaction);
  const action = pulseActions.find((item) => item.id === session.action);
  if (action && !canUsePulseAction(action, currentActor)) {
    session.action = undefined; session.values = {}; session.confirming = false;
    await update(interaction, session, "この操作を実行する権限がありません。"); return;
  }
  if (operation === "home") { session.action = undefined; session.values = {}; session.option = undefined; session.confirming = false; session.page = 0; }
  else if (operation === "prev") session.page--;
  else if (operation === "next") session.page++;
  else if (operation === "category" && interaction.isStringSelectMenu()) { session.category = interaction.values[0]; session.page = 0; }
  else if (operation === "action" && interaction.isStringSelectMenu()) {
    const selected = pulseActions.find((item) => item.id === interaction.values[0]);
    if (!selected || !canUsePulseAction(selected, currentActor)) { await update(interaction, session, "選択した操作は利用できません。"); return; }
    session.action = selected.id; session.values = {}; session.option = undefined; session.confirming = false;
  } else if (operation === "field" && interaction.isStringSelectMenu() && action) {
    const option = action.options.find((item) => item.name === interaction.values[0]);
    if (option) await editField(interaction, session, action, option);
    else await update(interaction, session);
    return;
  } else if (operation === "input" || operation === "value") {
    const option = action?.options.find((item) => item.name === session.option);
    if (!option) { await update(interaction, session, "入力欄を選び直してください。"); return; }
    let value: unknown;
    if (interaction.isModalSubmit()) {
      value = option.type === 11 ? interaction.fields.getUploadedFiles("value")?.first() ?? null : interaction.fields.getTextInputValue("value").trim();
      if (value === "") value = null;
      else if ([4, 10].includes(option.type)) value = Number(value);
    } else if (interaction.isStringSelectMenu()) {
      value = interaction.values[0] ?? null;
      if (value !== null && option.type === 5) value = value === "true";
      else if (value !== null && [4, 10].includes(option.type)) value = Number(value);
    } else if (interaction.isUserSelectMenu()) value = interaction.users.first() ?? null;
    else if (interaction.isChannelSelectMenu()) value = interaction.channels.first() ?? null;
    else if (interaction.isRoleSelectMenu()) value = interaction.roles.first() ?? null;
    else { await update(interaction, session, "入力形式が正しくありません。"); return; }
    const invalid = validatePulseValue(option, value);
    if (invalid) { await update(interaction, session, invalid); return; }
    session.values[option.name] = value; session.option = undefined;
  } else if (operation === "clear" && session.option) { delete session.values[session.option]; session.option = undefined; }
  else if (operation === "reset") { session.values = {}; session.confirming = false; }
  else if (operation === "cancel-confirm") session.confirming = false;
  else if ((operation === "run" || operation === "confirm") && action && interaction.isButton()) {
    const invalid = action.options.map((option) => validatePulseValue(option, session.values[option.name])).find(Boolean);
    if (invalid) { await update(interaction, session, invalid); return; }
    if (action.confirm && !(operation === "confirm" && session.confirming)) {
      session.confirming = true; await update(interaction, session); return;
    }
    const values = { ...session.values };
    session.action = undefined; session.option = undefined; session.values = {}; session.confirming = false;
    const adapted = pulseCommandInteraction(interaction as ButtonInteraction, action, values);
    await measureBotCommand(adapted, () => action.extra ? handlePulseAnalytics(adapted, action.extra) : handleCommand(adapted, context));
    // Don't overwrite music/render controls or a modal's acknowledgement.
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: "別の操作はここから開けます。", flags: MessageFlags.Ephemeral,
      components: [row(new ButtonBuilder().setCustomId("pulse:open").setLabel("操作メニュー").setStyle(ButtonStyle.Secondary))] }).catch(() => {});
    return;
  }
  await update(interaction, session);
}

export function pulseOpenReply(): InteractionReplyOptions {
  return { content: "すべての操作は `/pulse` にまとまりました。", components: [row(new ButtonBuilder().setCustomId("pulse:open").setLabel("全機能メニューを開く").setStyle(ButtonStyle.Primary))] };
}
