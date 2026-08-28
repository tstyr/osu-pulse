import {
  ChannelType,
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
} from "@/db/repository";
import type { ServerStatusChannelIds } from "@/db/schema";

import { RendererClient, type RendererHealth } from "./renderer-client";

const CATEGORY_NAME = "📊・OSU PULSE STATUS";
const MIN_CHANNEL_NAME_INTERVAL_MS = 15_000;
const DEFAULT_CHANNEL_NAME_INTERVAL_MS = 15_000;
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

function channelNameUpdateInterval() {
  const configured = Number.parseInt(
    process.env.STATUS_CHANNEL_NAME_INTERVAL_MS
      ?? process.env.STATUS_UPDATE_INTERVAL_MS
      ?? "",
    10,
  );
  return Number.isFinite(configured)
    ? Math.max(MIN_CHANNEL_NAME_INTERVAL_MS, configured)
    : DEFAULT_CHANNEL_NAME_INTERVAL_MS;
}

function channelNameUpdateIntervalLabel() {
  const milliseconds = channelNameUpdateInterval();
  return milliseconds < 60_000
    ? `${Math.round(milliseconds / 1_000)}秒`
    : `${Math.round(milliseconds / 60_000)}分`;
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
  return ids;
}

async function removeLegacyLiveChannel(
  guild: Guild,
  channelIds: ServerStatusChannelIds | null | undefined,
) {
  if (!channelIds) return {} as ServerStatusChannelIds;
  await guild.channels.fetch();
  const legacy = channelIds.live ? guild.channels.cache.get(channelIds.live) : null;
  if (
    legacy?.type === ChannelType.GuildText
    && legacy.name === LIVE_CHANNEL_NAME
  ) {
    await legacy.delete("osu! Pulse now reports status through channel names only").catch(() => undefined);
  }
  const voiceIds = { ...channelIds };
  delete voiceIds.live;
  return voiceIds;
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
  const storedIds = await removeLegacyLiveChannel(guild, existing?.statusChannelIds);
  const channelIds = await createStatusChannels(guild, category, storedIds);
  const health = await fetchHealth();
  await refreshGuildStatus(guild, channelIds, health);
  await configureServerStatus({ guildId: guild.id, categoryId: category.id, channelIds, liveMessageId: null });
  await interaction.editReply(
    `✅ <#${category.id}> に9個の状況チャンネルを作成しました。チャンネル名を${channelNameUpdateIntervalLabel()}ごとに更新します。`,
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
  const category = await statusCategory(guild, settings.statusCategoryId);
  const storedIds = await removeLegacyLiveChannel(guild, settings.statusChannelIds);
  const channelIds = await createStatusChannels(guild, category, storedIds);
  const updated = await refreshGuildStatus(guild, channelIds, health);
  if (
    settings.statusCategoryId !== category.id
    || settings.statusChannelIds.live
    || settings.statusLiveMessageId
    || JSON.stringify(channelIds) !== JSON.stringify(settings.statusChannelIds)
  ) {
    await configureServerStatus({
      guildId: guild.id,
      categoryId: category.id,
      channelIds,
      liveMessageId: null,
    });
  }
  await interaction.editReply(`✅ ${updated}個の状況チャンネル名を更新しました。`);
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
  let namesRunning = false;
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
        const category = await statusCategory(guild, item.statusCategoryId);
        const storedIds = await removeLegacyLiveChannel(guild, item.statusChannelIds);
        const channelIds = await createStatusChannels(guild, category, storedIds);
        await refreshGuildStatus(guild, channelIds, health);
        const changed = item.statusCategoryId !== category.id
          || item.statusLiveMessageId !== null
          || JSON.stringify(channelIds) !== JSON.stringify(item.statusChannelIds);
        if (changed) {
          await configureServerStatus({
            guildId: guild.id,
            categoryId: category.id,
            channelIds,
            liveMessageId: null,
          });
        }
      }
    } catch (error) {
      console.error("[status] channel-name update failed:", error);
    } finally {
      namesRunning = false;
    }
  };

  void runNames();
  const namesTimer = setInterval(() => void runNames(), channelNameUpdateInterval());
  namesTimer.unref();
  return () => clearInterval(namesTimer);
}
