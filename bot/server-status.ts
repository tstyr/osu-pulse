import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
} from "discord.js";

import {
  configureServerStatus,
  disableServerStatus,
  getGuildSettings,
  listServerStatusSettings,
  setServerStatusLiveMessage,
} from "@/db/repository";
import type { ServerStatusChannelIds } from "@/db/schema";

import { RendererClient, type RendererHealth } from "./renderer-client";

const CATEGORY_NAME = "📊・OSU PULSE STATUS";
const MIN_UPDATE_INTERVAL_MS = 15_000;
const DEFAULT_UPDATE_INTERVAL_MS = 15_000;
const MIN_CHANNEL_NAME_INTERVAL_MS = 300_000;
const DEFAULT_CHANNEL_NAME_INTERVAL_MS = 300_000;
const LIVE_CHANNEL_NAME = "📡・live-status";

const STATUS_KEYS = [
  "renderer",
  "cpu",
  "gpu",
  "memory",
  "disk",
  "network",
  "render",
  "videos",
  "jobs",
] as const;

type StatusKey = (typeof STATUS_KEYS)[number];

const PLACEHOLDER_NAMES: Record<StatusKey, string> = {
  renderer: "⚪・renderer-checking",
  cpu: "🧠・cpu-checking",
  gpu: "🎮・gpu-checking",
  memory: "💾・ram-checking",
  disk: "💿・disk-checking",
  network: "🌐・net-checking",
  render: "🎬・render-checking",
  videos: "📦・videos-checking",
  jobs: "✅・jobs-checking",
};

function updateInterval() {
  const configured = Number.parseInt(process.env.STATUS_UPDATE_INTERVAL_MS ?? "", 10);
  return Number.isFinite(configured)
    ? Math.max(MIN_UPDATE_INTERVAL_MS, configured)
    : DEFAULT_UPDATE_INTERVAL_MS;
}

function updateIntervalLabel() {
  const milliseconds = updateInterval();
  return milliseconds < 60_000
    ? `${Math.round(milliseconds / 1_000)}秒`
    : `${Math.round(milliseconds / 60_000)}分`;
}

function channelNameUpdateInterval() {
  const configured = Number.parseInt(process.env.STATUS_CHANNEL_NAME_INTERVAL_MS ?? "", 10);
  return Number.isFinite(configured)
    ? Math.max(MIN_CHANNEL_NAME_INTERVAL_MS, configured)
    : DEFAULT_CHANNEL_NAME_INTERVAL_MS;
}

function formatBytes(bytes: number | undefined) {
  if (!Number.isFinite(bytes) || (bytes ?? 0) <= 0) return "0b";
  const units = ["b", "kb", "mb", "gb", "tb"];
  let value = bytes ?? 0;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)}${units[index]}`;
}

function safePercent(value: number | null | undefined) {
  return Number.isFinite(value) ? `${Math.round(value ?? 0)}%` : "n-a";
}

function channelNames(health: RendererHealth | null): Record<StatusKey, string> {
  const system = health?.system;
  const stats = health?.render_stats;
  if (!health || !system || !stats) {
    return {
      renderer: "🔴・renderer-offline",
      cpu: "🧠・cpu-offline",
      gpu: "🎮・gpu-offline",
      memory: "💾・ram-offline",
      disk: "💿・disk-offline",
      network: "🌐・net-offline",
      render: "🎬・render-offline",
      videos: "📦・videos-offline",
      jobs: "✅・jobs-offline",
    };
  }

  const encoder = health.nvenc ? "nvenc" : health.amf ? "amf" : "cpu-enc";
  const renderState = stats.active_count > 0
    ? `${stats.active_status}-${Math.round(stats.active_progress)}%-q${stats.queue_size}`
    : `idle-q${stats.queue_size}`;
  const rendererIcon = health.status === "online" ? "🟢" : "🟡";
  return {
    renderer: `${rendererIcon}・renderer-${health.status}`,
    cpu: `🧠・cpu-${safePercent(system.cpu_percent)}`,
    gpu: `🎮・gpu-${encoder}-${safePercent(system.gpu_percent)}`,
    memory: `💾・ram-${formatBytes(system.memory_used_bytes)}-${formatBytes(system.memory_total_bytes)}`,
    disk: `💿・disk-${formatBytes(system.disk_used_bytes)}-${formatBytes(system.disk_total_bytes)}`,
    network: `🌐・net-rx${formatBytes(system.network_received_bytes)}-tx${formatBytes(system.network_sent_bytes)}`,
    render: `🎬・render-${renderState}`,
    videos: `📦・videos-${stats.video_count}-${formatBytes(stats.video_bytes)}`,
    jobs: `✅・jobs-${stats.processed_total}-ok${stats.completed_total}-ng${stats.failed_total}`,
  };
}

function liveStatusEmbed(health: RendererHealth | null) {
  const embed = new EmbedBuilder()
    .setTitle("osu! Pulse Live Server Status")
    .setFooter({ text: `${updateIntervalLabel()}ごとに自動更新 · チャンネル名は5分ごと` })
    .setTimestamp();
  const system = health?.system;
  const stats = health?.render_stats;
  if (!health || !system || !stats) {
    return embed
      .setColor(0xff5577)
      .setDescription("🔴 Renderer Offline")
      .addFields({ name: "接続", value: "ローカルRendererへ接続できません。" });
  }
  const encoder = health.nvenc ? "NVENC" : health.amf ? "AMD AMF" : "CPU (libx264)";
  const renderState = stats.active_count > 0
    ? `${stats.active_status} ${Math.round(stats.active_progress)}% · Queue ${stats.queue_size}`
    : `Idle · Queue ${stats.queue_size}`;
  return embed
    .setColor(health.status === "online" ? 0x55dd99 : 0xffaa55)
    .setDescription(`${health.status === "online" ? "🟢" : "🟡"} **Renderer ${health.status.toUpperCase()}**`)
    .addFields(
      { name: "🧠 CPU", value: safePercent(system.cpu_percent), inline: true },
      { name: "🎮 GPU", value: `${safePercent(system.gpu_percent)} · ${encoder}`, inline: true },
      { name: "💾 RAM", value: `${formatBytes(system.memory_used_bytes)} / ${formatBytes(system.memory_total_bytes)} (${safePercent(system.memory_percent)})`, inline: true },
      { name: "💿 Disk", value: `${formatBytes(system.disk_used_bytes)} / ${formatBytes(system.disk_total_bytes)} (${safePercent(system.disk_percent)})`, inline: true },
      { name: "🌐 Network", value: `RX ${formatBytes(system.network_received_bytes)} · TX ${formatBytes(system.network_sent_bytes)}`, inline: true },
      { name: "🎬 Render", value: renderState, inline: true },
      { name: "📦 Videos", value: `${stats.video_count}本 · ${formatBytes(stats.video_bytes)}`, inline: true },
      { name: "✅ Jobs", value: `Total ${stats.processed_total} · OK ${stats.completed_total} · NG ${stats.failed_total} · Cancel ${stats.cancelled_total}`, inline: true },
      { name: "🗺️ Songs", value: `${health.songs_index_count.toLocaleString()} beatmaps`, inline: true },
    );
}

async function fetchHealth() {
  try {
    return await new RendererClient().health();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[status] renderer health unavailable: ${message}`);
    return null;
  }
}

async function statusCategory(guild: Guild, categoryId?: string | null) {
  await guild.channels.fetch();
  const stored = categoryId ? guild.channels.cache.get(categoryId) : null;
  if (stored?.type === ChannelType.GuildCategory) return stored;
  const retryCandidate = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME,
  );
  if (retryCandidate?.type === ChannelType.GuildCategory) return retryCandidate;
  return guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: "osu! Pulse server status setup",
  });
}

function statusVoiceChannel(guild: Guild, id: string | undefined) {
  const channel = id ? guild.channels.cache.get(id) : null;
  return channel?.type === ChannelType.GuildVoice ? channel : null;
}

function statusLiveChannel(guild: Guild, id: string | undefined) {
  const channel = id ? guild.channels.cache.get(id) : null;
  return channel?.type === ChannelType.GuildText ? channel : null;
}

async function createStatusChannels(
  guild: Guild,
  category: CategoryChannel,
  storedIds: ServerStatusChannelIds | null | undefined,
) {
  const ids: ServerStatusChannelIds = {};
  for (const key of STATUS_KEYS) {
    let channel = statusVoiceChannel(guild, storedIds?.[key]);
    if (!channel) {
      const candidate = guild.channels.cache.find(
        (item) =>
          item.type === ChannelType.GuildVoice &&
          item.parentId === category.id &&
          (item.name === PLACEHOLDER_NAMES[key] || item.name.includes(`・${key === "memory" ? "ram" : key === "network" ? "net" : key}-`)),
      );
      channel = candidate?.type === ChannelType.GuildVoice ? candidate : null;
    }
    if (!channel) {
      channel = await guild.channels.create({
        name: PLACEHOLDER_NAMES[key],
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect],
          },
        ],
        reason: "osu! Pulse server status setup",
      });
    } else if (channel.parentId !== category.id) {
      await channel.setParent(category.id, { lockPermissions: false });
    }
    ids[key] = channel.id;
  }
  let liveChannel = statusLiveChannel(guild, storedIds?.live);
  if (!liveChannel) {
    const candidate = guild.channels.cache.find(
      (item) => item.type === ChannelType.GuildText && item.parentId === category.id && item.name === LIVE_CHANNEL_NAME,
    );
    liveChannel = candidate?.type === ChannelType.GuildText ? candidate : null;
  }
  if (!liveChannel) {
    const botMember = guild.members.me ?? await guild.members.fetchMe();
    liveChannel = await guild.channels.create({
      name: LIVE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: botMember.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
      reason: "osu! Pulse 15-second live status",
    });
  }
  ids.live = liveChannel.id;
  return ids;
}

async function refreshLiveStatus(
  guild: Guild,
  channelIds: ServerStatusChannelIds,
  messageId: string | null | undefined,
  health: RendererHealth | null,
) {
  await guild.channels.fetch();
  const channel = statusLiveChannel(guild, channelIds.live);
  if (!channel) return null;
  const existing = messageId
    ? await channel.messages.fetch(messageId).catch(() => null)
    : null;
  if (existing) {
    await existing.edit({ embeds: [liveStatusEmbed(health)] });
    return existing.id;
  }
  const message = await channel.send({ embeds: [liveStatusEmbed(health)] });
  return message.id;
}

export async function refreshGuildStatus(
  guild: Guild,
  channelIds: ServerStatusChannelIds,
  health?: RendererHealth | null,
) {
  await guild.channels.fetch();
  const names = channelNames(health === undefined ? await fetchHealth() : health);
  let updated = 0;
  for (const key of STATUS_KEYS) {
    const channel = statusVoiceChannel(guild, channelIds[key]);
    if (!channel || channel.name === names[key]) continue;
    try {
      await channel.setName(names[key], "osu! Pulse periodic server status update");
      updated += 1;
    } catch (error) {
      console.error(`[status] failed to rename ${key} in guild ${guild.id}:`, error);
    }
  }
  return updated;
}

async function setup(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.editReply("Botに「チャンネルの管理」権限を付与してください。");
    return;
  }
  const existing = await getGuildSettings(guild.id);
  const category = await statusCategory(guild, existing?.statusCategoryId);
  const channelIds = await createStatusChannels(guild, category, existing?.statusChannelIds);
  const health = await fetchHealth();
  await refreshGuildStatus(guild, channelIds, health);
  const liveMessageId = await refreshLiveStatus(guild, channelIds, existing?.statusLiveMessageId, health);
  await configureServerStatus({ guildId: guild.id, categoryId: category.id, channelIds, liveMessageId });
  await interaction.editReply(
    `✅ <#${category.id}> に9個の状況チャンネルと <#${channelIds.live}> を作成しました。ライブ表示は${updateIntervalLabel()}ごと、チャンネル名は5分ごとに更新します。`,
  );
}

async function refresh(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await getGuildSettings(guild.id);
  if (!settings?.statusEnabled || !settings.statusChannelIds) {
    await interaction.editReply("先に `/server-status setup` を実行してください。");
    return;
  }
  const health = await fetchHealth();
  const updated = await refreshGuildStatus(guild, settings.statusChannelIds, health);
  const liveMessageId = await refreshLiveStatus(guild, settings.statusChannelIds, settings.statusLiveMessageId, health);
  if (liveMessageId && liveMessageId !== settings.statusLiveMessageId) {
    await setServerStatusLiveMessage(guild.id, liveMessageId);
  }
  await interaction.editReply(`✅ ライブ表示を更新し、${updated}個のチャンネル名を更新しました。`);
}

async function remove(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await getGuildSettings(guild.id);
  if (!settings?.statusCategoryId && !settings?.statusChannelIds) {
    await interaction.editReply("自動作成済みの状況カテゴリはありません。");
    return;
  }
  await guild.channels.fetch();
  for (const id of Object.values(settings.statusChannelIds ?? {})) {
    const channel = guild.channels.cache.get(id);
    if (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildText) {
      await channel.delete("osu! Pulse server status removed").catch(() => undefined);
    }
  }
  const category = settings.statusCategoryId
    ? guild.channels.cache.get(settings.statusCategoryId)
    : null;
  if (category?.type === ChannelType.GuildCategory) {
    await category.delete("osu! Pulse server status removed").catch(() => undefined);
  }
  await disableServerStatus(guild.id);
  await interaction.editReply("状況カテゴリと自動作成したチャンネルを削除しました。");
}

export async function handleServerStatusCommand(
  interaction: ChatInputCommandInteraction,
) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "サーバー内で実行してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "setup") await setup(interaction, guild);
  else if (subcommand === "refresh") await refresh(interaction, guild);
  else if (subcommand === "remove") await remove(interaction, guild);
}

export function startServerStatusUpdater(client: Client) {
  let liveRunning = false;
  let namesRunning = false;
  const runLive = async () => {
    if (liveRunning) return;
    liveRunning = true;
    try {
      const settings = await listServerStatusSettings();
      if (settings.length === 0) return;
      const health = await fetchHealth();
      for (const item of settings) {
        const guild = client.guilds.cache.get(item.guildId);
        if (!guild || !item.statusChannelIds) continue;
        let channelIds = item.statusChannelIds;
        if (!channelIds.live) {
          const category = await statusCategory(guild, item.statusCategoryId);
          channelIds = await createStatusChannels(guild, category, channelIds);
        }
        const liveMessageId = await refreshLiveStatus(
          guild,
          channelIds,
          item.statusLiveMessageId,
          health,
        );
        if (!item.statusChannelIds.live || (liveMessageId && liveMessageId !== item.statusLiveMessageId)) {
          await configureServerStatus({
            guildId: guild.id,
            categoryId: categoryIdFor(item.statusCategoryId, channelIds, guild),
            channelIds,
            liveMessageId,
          });
        }
      }
    } catch (error) {
      console.error("[status] live update failed:", error);
    } finally {
      liveRunning = false;
    }
  };

  const runNames = async () => {
    if (namesRunning) return;
    namesRunning = true;
    try {
      const settings = await listServerStatusSettings();
      if (settings.length === 0) return;
      const health = await fetchHealth();
      for (const item of settings) {
        const guild = client.guilds.cache.get(item.guildId);
        if (!guild || !item.statusChannelIds) continue;
        await refreshGuildStatus(guild, item.statusChannelIds, health);
      }
    } catch (error) {
      console.error("[status] channel-name update failed:", error);
    } finally {
      namesRunning = false;
    }
  };

  void runLive();
  const liveTimer = setInterval(() => void runLive(), updateInterval());
  const namesTimer = setInterval(() => void runNames(), channelNameUpdateInterval());
  liveTimer.unref();
  namesTimer.unref();
  return () => {
    clearInterval(liveTimer);
    clearInterval(namesTimer);
  };
}

function categoryIdFor(
  storedCategoryId: string | null,
  channelIds: ServerStatusChannelIds,
  guild: Guild,
) {
  const liveChannel = statusLiveChannel(guild, channelIds.live);
  return liveChannel?.parentId ?? storedCategoryId ?? "";
}
