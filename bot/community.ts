import { randomInt } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import {
  closeCommunityTicket,
  completeCommunityEvent,
  configureOnboarding,
  configureTickets,
  createCommunityEvent,
  createCommunityTicket,
  enterCommunityEvent,
  findOpenCommunityTicket,
  getCommunityEvent,
  getCommunityGuildSettings,
  getCommunityTicketByChannel,
  listCommunityEvents,
  listDueCommunityEvents,
  setCommunityEventMessage,
} from "@/db/community-repository";
import { auditAdminAction } from "@/services/admin-log";

const ONBOARDING_PREFIX = "onboarding:accept";
const TICKET_CREATE_PREFIX = "ticket:create";
const TICKET_CLOSE_PREFIX = "ticket:close";
const POLL_PREFIX = "community:poll";
const GIVEAWAY_PREFIX = "community:giveaway";

function eventComponents(event: NonNullable<Awaited<ReturnType<typeof getCommunityEvent>>>["event"]) {
  if (event.status !== "active" || event.endsAt.getTime() <= Date.now()) return [];
  if (event.kind === "giveaway") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${GIVEAWAY_PREFIX}:${event.id}`).setLabel("参加する").setEmoji("🎉").setStyle(ButtonStyle.Success),
    )];
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    event.options.slice(0, 5).map((option, index) => new ButtonBuilder()
      .setCustomId(`${POLL_PREFIX}:${event.id}:${index}`)
      .setLabel(option.slice(0, 80))
      .setStyle(index === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  )];
}

function eventEmbed(data: NonNullable<Awaited<ReturnType<typeof getCommunityEvent>>>) {
  const { event, entries } = data;
  const endUnix = Math.floor(event.endsAt.getTime() / 1_000);
  if (event.kind === "giveaway") {
    return new EmbedBuilder()
      .setColor(event.status === "active" ? 0xff66aa : 0x64748b)
      .setTitle(`🎉 ${event.title}`)
      .setDescription(`${entries.length}人参加 · 当選 ${event.winnerCount}人\n終了: <t:${endUnix}:R>`)
      .setFooter({ text: event.status === "active" ? "ボタンから参加できます" : "受付終了" });
  }
  const counts = event.options.map((option, index) => ({
    option,
    count: entries.filter((entry) => entry.choiceIndex === index).length,
  }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  return new EmbedBuilder()
    .setColor(event.status === "active" ? 0x5865f2 : 0x64748b)
    .setTitle(`📊 ${event.title}`)
    .setDescription(counts.map((item, index) => {
      const ratio = total ? item.count / total : 0;
      const bars = Math.round(ratio * 10);
      return `**${index + 1}. ${item.option}**\n${"█".repeat(bars)}${"░".repeat(10 - bars)} ${item.count}票 (${(ratio * 100).toFixed(1)}%)`;
    }).join("\n\n"))
    .setFooter({ text: `${total}票 · ${event.status === "active" ? `終了 ${new Date(event.endsAt).toLocaleString("ja-JP")}` : "受付終了"}` });
}

export function isCommunityButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith(`${ONBOARDING_PREFIX}:`)
    || interaction.customId.startsWith(`${TICKET_CREATE_PREFIX}:`)
    || interaction.customId.startsWith(`${TICKET_CLOSE_PREFIX}:`)
    || interaction.customId.startsWith(`${POLL_PREFIX}:`)
    || interaction.customId.startsWith(`${GIVEAWAY_PREFIX}:`);
}

export async function handleCommunityCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.guild || !interaction.channel?.isSendable()) {
    throw new Error("サーバーのテキストチャンネルで実行してください。");
  }

  if (interaction.commandName === "onboarding") {
    const channel = interaction.options.getChannel("channel", true);
    const role = interaction.options.getRole("role", true);
    const targetChannel = interaction.guild.channels.cache.get(channel.id);
    if (!targetChannel?.isSendable()) throw new Error("案内を送信できるチャンネルを指定してください。");
    const message = await targetChannel.send({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("ようこそ！参加設定を始めましょう").setDescription("下のボタンを押すとメンバーロールが付与されます。続けて `/verify` からosu!登録もできます。").setFooter({ text: "osu!アカウントを持っていなくても参加できます" })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ONBOARDING_PREFIX}:${interaction.guildId}`).setLabel("参加を開始").setEmoji("👋").setStyle(ButtonStyle.Primary),
      )],
    });
    await configureOnboarding({ guildId: interaction.guildId, channelId: channel.id, roleId: role.id, panelMessageId: message.id });
    await interaction.reply({ content: `✅ オンボーディングを ${channel} に設置しました。`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "ticket") {
    const subcommand = interaction.options.getSubcommand();
    if ((subcommand === "setup" || subcommand === "panel") && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      throw new Error("この操作にはサーバー管理権限が必要です。");
    }
    if (subcommand === "setup") {
      const category = interaction.options.getChannel("category", true);
      const logChannel = interaction.options.getChannel("log_channel", true);
      const supportRole = interaction.options.getRole("support_role");
      if (category.type !== ChannelType.GuildCategory) throw new Error("カテゴリを指定してください。");
      await configureTickets({ guildId: interaction.guildId, categoryId: category.id, logChannelId: logChannel.id, supportRoleId: supportRole?.id });
      await interaction.reply({ content: "✅ チケットの保存先と担当ロールを設定しました。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "panel") {
      const settings = await getCommunityGuildSettings(interaction.guildId);
      if (!settings?.ticketCategoryId || !settings.ticketLogChannelId) throw new Error("先に `/ticket setup` を実行してください。");
      const message = await interaction.channel.send({
        embeds: [new EmbedBuilder().setColor(0x0f67d8).setTitle("サポートチケット").setDescription("質問・不具合・相談がある場合は、下のボタンから自分専用のチャンネルを作成できます。")],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${TICKET_CREATE_PREFIX}:${interaction.guildId}`).setLabel("チケットを作成").setEmoji("🎫").setStyle(ButtonStyle.Primary),
        )],
      });
      await interaction.reply({ content: `✅ チケットパネルを設置しました: ${message.url}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const ticket = await getCommunityTicketByChannel(interaction.channelId);
    if (!ticket || ticket.status !== "open") throw new Error("このチャンネルは開いているチケットではありません。");
    await closeTicket(interaction, ticket.id);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "status") {
    const rows = (await listCommunityEvents(50)).filter((row) => row.guildId === interaction.guildId && row.status === "active");
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("開催中のイベント").setDescription(rows.map((row) => `• **${row.title}** · ${row.kind === "poll" ? "投票" : "抽選"} · <t:${Math.floor(row.endsAt.getTime() / 1_000)}:R>`).join("\n") || "現在開催中の投票・抽選はありません。")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const durationMinutes = interaction.options.getInteger("duration_minutes", true);
  const endsAt = new Date(Date.now() + durationMinutes * 60_000);
  const kind = subcommand === "poll" ? "poll" : "giveaway";
  const options = kind === "poll"
    ? interaction.options.getString("options", true).split("|").map((value) => value.trim()).filter(Boolean).slice(0, 5)
    : [];
  if (kind === "poll" && options.length < 2) throw new Error("選択肢を `赤|青|緑` のように | 区切りで2個以上入力してください。");
  const event = await createCommunityEvent({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    kind,
    title: interaction.options.getString(kind === "poll" ? "question" : "prize", true),
    options,
    winnerCount: kind === "giveaway" ? interaction.options.getInteger("winners") ?? 1 : 1,
    createdByDiscordUserId: interaction.user.id,
    endsAt,
  });
  const data = await getCommunityEvent(event.id);
  if (!data) throw new Error("イベントの作成に失敗しました。");
  const message = await interaction.channel.send({ embeds: [eventEmbed(data)], components: eventComponents(event) });
  await setCommunityEventMessage(event.id, message.id);
  await interaction.reply({ content: `✅ ${kind === "poll" ? "投票" : "抽選"}を開始しました: ${message.url}`, flags: MessageFlags.Ephemeral });
}

async function closeTicket(interaction: ChatInputCommandInteraction | ButtonInteraction, ticketId: string) {
  const ticket = await getCommunityTicketByChannel(interaction.channelId);
  if (!ticket || ticket.id !== ticketId || ticket.status !== "open") throw new Error("開いているチケットが見つかりません。");
  const member = interaction.member as GuildMember;
  const settings = await getCommunityGuildSettings(ticket.guildId);
  const allowed = ticket.openerDiscordUserId === interaction.user.id
    || member.permissions.has(PermissionFlagsBits.ManageChannels)
    || Boolean(settings?.ticketSupportRoleId && member.roles.cache.has(settings.ticketSupportRoleId));
  if (!allowed) throw new Error("このチケットを閉じる権限がありません。");
  const closed = await closeCommunityTicket(ticket.id, interaction.user.id);
  if (!closed) throw new Error("チケットは既に閉じられています。");
  const channel = interaction.guild?.channels.cache.get(ticket.channelId);
  if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) {
    await channel.permissionOverwrites.edit(ticket.openerDiscordUserId, { SendMessages: false }).catch(() => undefined);
    await channel.setName(`closed-${channel.name.replace(/^closed-/, "").slice(0, 82)}`).catch(() => undefined);
  }
  await auditAdminAction({ guildId: ticket.guildId, actorDiscordUserId: interaction.user.id, source: "discord", action: "ticket-close", summary: `チケット ${ticket.id.slice(0, 8)} を閉じました。`, details: { channelId: ticket.channelId, opener: ticket.openerDiscordUserId } });
  const logChannel = settings?.ticketLogChannelId ? interaction.guild?.channels.cache.get(settings.ticketLogChannelId) : null;
  if (logChannel?.isSendable()) {
    await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x64748b).setTitle("🔒 チケット終了").setDescription(`Ticket ${ticket.id.slice(0, 8)} · <#${ticket.channelId}>`).addFields({ name: "作成者", value: `<@${ticket.openerDiscordUserId}>`, inline: true }, { name: "終了者", value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  const payload = { content: "🔒 チケットを閉じました。履歴保持のためチャンネルは残します。", components: [] };
  if (interaction.isButton()) await interaction.update(payload);
  else await interaction.reply(payload);
}

export async function handleCommunityButton(interaction: ButtonInteraction) {
  const [group, action, id, choice] = interaction.customId.split(":");
  if (!interaction.guildId || !interaction.guild) throw new Error("サーバー内で操作してください。");

  if (`${group}:${action}` === ONBOARDING_PREFIX) {
    const settings = await getCommunityGuildSettings(interaction.guildId);
    if (!settings?.onboardingRoleId || id !== interaction.guildId) throw new Error("オンボーディング設定が見つかりません。");
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await member.roles.add(settings.onboardingRoleId, "osu! Pulse onboarding accepted");
    await interaction.reply({ content: "✅ 参加設定が完了しました。osu!を利用する場合は `/verify`、機能一覧は `/help` を使えます。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (`${group}:${action}` === TICKET_CREATE_PREFIX) {
    const existing = await findOpenCommunityTicket(interaction.guildId, interaction.user.id);
    if (existing) {
      await interaction.reply({ content: `既に開いているチケットがあります: <#${existing.channelId}>`, flags: MessageFlags.Ephemeral });
      return;
    }
    const settings = await getCommunityGuildSettings(interaction.guildId);
    if (!settings?.ticketCategoryId || !settings.ticketLogChannelId) throw new Error("チケット機能が設定されていません。");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 45) || "member";
    const channel = await interaction.guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      parent: settings.ticketCategoryId,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
        ...(settings.ticketSupportRoleId ? [{ id: settings.ticketSupportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
      ],
      reason: `Ticket opened by ${interaction.user.tag}`,
    });
    const ticket = await createCommunityTicket({ guildId: interaction.guildId, channelId: channel.id, openerDiscordUserId: interaction.user.id });
    await channel.send({
      content: `<@${interaction.user.id}>${settings.ticketSupportRoleId ? ` <@&${settings.ticketSupportRoleId}>` : ""}`,
      embeds: [new EmbedBuilder().setColor(0x0f67d8).setTitle(`🎫 Ticket ${ticket.id.slice(0, 8)}`).setDescription("相談内容を書いてください。解決後は下のボタンで閉じられます。")],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${TICKET_CLOSE_PREFIX}:${ticket.id}`).setLabel("チケットを閉じる").setEmoji("🔒").setStyle(ButtonStyle.Danger),
      )],
      allowedMentions: { users: [interaction.user.id], roles: settings.ticketSupportRoleId ? [settings.ticketSupportRoleId] : [] },
    });
    const logChannel = interaction.guild.channels.cache.get(settings.ticketLogChannelId);
    if (logChannel?.isSendable()) {
      await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x0f67d8).setTitle("🎫 チケット開始").setDescription(`Ticket ${ticket.id.slice(0, 8)} · ${channel}`).addFields({ name: "作成者", value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    await auditAdminAction({ guildId: interaction.guildId, actorDiscordUserId: interaction.user.id, source: "discord", action: "ticket-open", summary: `チケット ${ticket.id.slice(0, 8)} を作成しました。`, details: { channelId: channel.id } });
    await interaction.editReply(`✅ チケットを作成しました: ${channel}`);
    return;
  }

  if (`${group}:${action}` === TICKET_CLOSE_PREFIX) {
    await closeTicket(interaction, id);
    return;
  }

  const data = await getCommunityEvent(id);
  if (!data || data.event.guildId !== interaction.guildId) throw new Error("イベントが見つかりません。");
  if (data.event.status !== "active" || data.event.endsAt.getTime() <= Date.now()) {
    await interaction.reply({ content: "このイベントは終了しています。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (`${group}:${action}` === POLL_PREFIX) {
    const choiceIndex = Number.parseInt(choice ?? "", 10);
    if (!Number.isInteger(choiceIndex) || !data.event.options[choiceIndex]) throw new Error("選択肢が正しくありません。");
    await enterCommunityEvent({ eventId: id, discordUserId: interaction.user.id, choiceIndex });
    const updated = await getCommunityEvent(id);
    if (updated) await interaction.message.edit({ embeds: [eventEmbed(updated)], components: eventComponents(updated.event) });
    await interaction.reply({ content: `✅ 「${data.event.options[choiceIndex]}」へ投票しました。再選択すると票を変更できます。`, flags: MessageFlags.Ephemeral });
    return;
  }
  await enterCommunityEvent({ eventId: id, discordUserId: interaction.user.id });
  const updated = await getCommunityEvent(id);
  if (updated) await interaction.message.edit({ embeds: [eventEmbed(updated)], components: eventComponents(updated.event) });
  await interaction.reply({ content: "🎉 抽選へ参加しました。", flags: MessageFlags.Ephemeral });
}

export async function dispatchDueCommunityEvents(client: Client) {
  const due = await listDueCommunityEvents();
  let completed = 0;
  for (const event of due) {
    try {
      const data = await getCommunityEvent(event.id);
      if (!data) continue;
      const channel = await client.channels.fetch(event.channelId).catch(() => null);
      const message = channel?.isTextBased() && event.messageId ? await channel.messages.fetch(event.messageId).catch(() => null) : null;
      const winners: string[] = [];
      if (event.kind === "giveaway") {
        const pool = [...data.entries.map((entry) => entry.discordUserId)];
        while (pool.length && winners.length < event.winnerCount) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
      }
      await completeCommunityEvent(event.id);
      const finalData = await getCommunityEvent(event.id);
      if (message && finalData) await message.edit({ embeds: [eventEmbed(finalData)], components: [] });
      if (channel?.isSendable() && event.kind === "giveaway") {
        await channel.send({
          content: winners.length ? `🎉 **${event.title}** の当選者: ${winners.map((id) => `<@${id}>`).join(" ")}` : `**${event.title}** は参加者なしで終了しました。`,
          allowedMentions: { users: winners },
        });
      }
      completed += 1;
    } catch (error) {
      console.error(`[community] event ${event.id} completion failed:`, error);
    }
  }
  return completed;
}
