import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  Message,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { LavalinkManager, type Player } from "lavalink-client";

const PANEL_UPDATE_INTERVAL_MS = 15_000;
const MUSIC_BUTTON_PREFIX = "music-panel";

type MusicPanel = {
  message: Message;
  timer: ReturnType<typeof setInterval>;
};

const panels = new Map<string, MusicPanel>();

export function createLavalinkManager(client: Client) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const host = process.env.LAVALINK_HOST;
  const authorization = process.env.LAVALINK_PASSWORD;

  if (!clientId || !host || !authorization) return null;

  const manager = new LavalinkManager({
    nodes: [
      {
        id: "osu-pulse-main",
        host,
        port: Number(process.env.LAVALINK_PORT ?? 2333),
        authorization,
        secure: process.env.LAVALINK_SECURE === "true",
        retryAmount: 10,
        retryDelay: 5_000,
      },
    ],
    client: { id: clientId, username: "osu pulse" },
    sendToShard: (guildId, payload) => {
      client.guilds.cache.get(guildId)?.shard.send(payload);
    },
    autoSkip: true,
    playerOptions: {
      defaultSearchPlatform: "ytmsearch",
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: 60_000 },
    },
  });

  client.on("raw", (payload) => manager.sendRawData(payload));
  manager.nodeManager.on("connect", (node) => console.log(`[lavalink] connected: ${node.id}`));
  manager.nodeManager.on("error", (node, error) => {
    const cause = error instanceof AggregateError ? error.errors.find((item) => item instanceof Error) : error;
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[lavalink] ${node.id}: ${message}`);
  });
  return manager;
}

function durationLabel(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "LIVE";
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function progressBar(position: number, duration: number) {
  if (!duration || duration <= 0) return "━━━━━━━━━━━━━━━━━━━━";
  const slots = 20;
  const filled = Math.max(0, Math.min(slots - 1, Math.floor((position / duration) * slots)));
  return `${"━".repeat(filled)}●${"─".repeat(slots - filled - 1)}`;
}

function buttonId(guildId: string, action: string) {
  return `${MUSIC_BUTTON_PREFIX}:${guildId}:${action}`;
}

function buildMusicPanel(guildId: string, player: Player | null) {
  const current = player?.queue.current ?? null;
  const duration = current?.info.duration ?? 0;
  const position = player?.position ?? 0;
  const embed = new EmbedBuilder().setColor(player?.paused ? 0xffaa55 : 0xff66aa);

  if (current) {
    embed
      .setAuthor({ name: player?.paused ? "Paused" : "Now playing" })
      .setTitle(current.info.title)
      .setDescription(
        `${current.info.author ?? "Unknown artist"}\n\n${progressBar(position, duration)}\n` +
          `\`${durationLabel(position)} / ${durationLabel(duration)}\``,
      )
      .addFields(
        { name: "音量", value: `${player?.volume ?? 0}%`, inline: true },
        { name: "Queue", value: `${player?.queue.tracks.length ?? 0}曲`, inline: true },
        { name: "接続", value: player?.connected ? "Connected" : "Reconnecting", inline: true },
      )
      .setFooter({ text: "15秒ごとに自動更新 · ボタンは時間制限なし" })
      .setTimestamp();
    if (current.info.uri) embed.setURL(current.info.uri);
    if (current.info.artworkUrl) embed.setThumbnail(current.info.artworkUrl);
  } else {
    embed
      .setTitle("Music player")
      .setDescription("現在再生中の曲はありません。`/music play` で曲を追加できます。")
      .setFooter({ text: "このパネルは次の再生時に再利用されます" })
      .setTimestamp();
  }

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "toggle"))
      .setLabel(player?.paused ? "再開" : "一時停止")
      .setEmoji(player?.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "skip"))
      .setLabel("スキップ")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "stop"))
      .setLabel("停止")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!player),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "volume-down"))
      .setLabel("-10")
      .setEmoji("🔉")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "volume-up"))
      .setLabel("+10")
      .setEmoji("🔊")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player),
  );

  return { embeds: [embed], components: [controls] };
}

async function updatePanel(guildId: string, manager: LavalinkManager | null, message?: Message) {
  const target = message ?? panels.get(guildId)?.message;
  if (!target) return;
  const player = manager?.getPlayer(guildId) ?? null;
  await target.edit(buildMusicPanel(guildId, player));
  if (!player) forgetPanel(guildId);
}

function forgetPanel(guildId: string) {
  const panel = panels.get(guildId);
  if (panel) clearInterval(panel.timer);
  panels.delete(guildId);
}

function rememberPanel(guildId: string, message: Message, manager: LavalinkManager | null) {
  const previous = panels.get(guildId);
  if (previous) clearInterval(previous.timer);
  const timer = setInterval(() => {
    void updatePanel(guildId, manager).catch((error) => {
      console.error(`[music] panel update failed in guild ${guildId}:`, error);
      forgetPanel(guildId);
    });
  }, PANEL_UPDATE_INTERVAL_MS);
  timer.unref();
  panels.set(guildId, { message, timer });
}

function memberVoiceChannelId(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  return (interaction.member as GuildMember | null)?.voice.channelId ?? null;
}

function sharesPlayerChannel(interaction: ChatInputCommandInteraction | ButtonInteraction, player: Player) {
  const voiceChannelId = memberVoiceChannelId(interaction);
  return Boolean(voiceChannelId && voiceChannelId === player.voiceChannelId);
}

export function isMusicButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith(`${MUSIC_BUTTON_PREFIX}:`);
}

export async function handleMusicButton(interaction: ButtonInteraction, manager: LavalinkManager | null) {
  const [, guildId, action] = interaction.customId.split(":");
  if (!guildId || !action || interaction.guildId !== guildId) return;
  if (!manager) {
    await interaction.reply({ content: "Lavalinkノードが未設定です。", flags: MessageFlags.Ephemeral });
    return;
  }

  const player = manager.getPlayer(guildId);
  if (!player) {
    await interaction.reply({ content: "現在のプレイヤーはありません。`/music play` で開始してください。", flags: MessageFlags.Ephemeral });
    await updatePanel(guildId, manager, interaction.message);
    return;
  }
  if (!sharesPlayerChannel(interaction, player)) {
    await interaction.reply({ content: "Botと同じボイスチャンネルに参加して操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  if (action === "toggle") {
    if (player.paused) await player.resume();
    else await player.pause();
  } else if (action === "skip") {
    await player.skip();
  } else if (action === "stop") {
    await manager.destroyPlayer(guildId, `stopped by ${interaction.user.id}`);
  } else if (action === "volume-down") {
    await player.setVolume(Math.max(0, player.volume - 10));
  } else if (action === "volume-up") {
    await player.setVolume(Math.min(150, player.volume + 10));
  }

  rememberPanel(guildId, interaction.message, manager);
  await updatePanel(guildId, manager, interaction.message);
}

export function destroyMusicPanels() {
  for (const guildId of panels.keys()) forgetPanel(guildId);
}

export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
  manager: LavalinkManager | null,
) {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: "音楽コマンドはサーバー内で使ってください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!manager) {
    await interaction.reply({ content: "Lavalinkノードが未設定です。LAVALINK_HOST と LAVALINK_PASSWORD を確認してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const existing = manager.getPlayer(interaction.guildId);

  if (subcommand === "play") {
    const voiceChannelId = memberVoiceChannelId(interaction);
    if (!voiceChannelId) {
      await interaction.reply({ content: "先にボイスチャンネルへ参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.voiceChannelId && existing.voiceChannelId !== voiceChannelId) {
      await interaction.reply({ content: "Botがいるボイスチャンネルに参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const player = existing ?? manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 80,
    });
    if (!player.connected) await player.connect();

    const query = interaction.options.getString("query", true);
    const result = await player.search({ query, source: "ytmsearch" }, interaction.user);
    const track = result.tracks[0];
    if (!track) {
      await interaction.editReply("曲が見つかりませんでした。");
      return;
    }

    const wasPlaying = player.playing || Boolean(player.queue.current);
    player.queue.add(track);
    if (!wasPlaying) await player.play();
    const message = await interaction.editReply(buildMusicPanel(interaction.guildId, player));
    rememberPanel(interaction.guildId, message, manager);
    return;
  }

  if (!existing) {
    await interaction.reply({ content: "現在のプレイヤーはありません。`/music play` で開始してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!sharesPlayerChannel(interaction, existing)) {
    await interaction.reply({ content: "Botと同じボイスチャンネルに参加して操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "skip") {
    await existing.skip();
    await interaction.reply("⏭️ スキップしました。");
  } else if (subcommand === "pause") {
    await existing.pause();
    await interaction.reply("⏸️ 一時停止しました。");
  } else if (subcommand === "resume") {
    await existing.resume();
    await interaction.reply("▶️ 再開しました。");
  } else if (subcommand === "volume") {
    const volume = interaction.options.getInteger("percent", true);
    await existing.setVolume(volume);
    await interaction.reply(`🔊 音量を ${volume}% に変更しました。`);
  } else if (subcommand === "queue") {
    const current = existing.queue.current;
    const upcoming = existing.queue.tracks.slice(0, 10);
    const lines = [
      current ? `**再生中** ${current.info.title} — ${current.info.author}` : "再生中の曲はありません。",
      ...upcoming.map((track, index) => `${index + 1}. ${track.info.title} — ${track.info.author}`),
    ];
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8c7cff).setTitle("Music queue").setDescription(lines.join("\n"))] });
  } else if (subcommand === "stop") {
    await manager.destroyPlayer(interaction.guildId, `stopped by ${interaction.user.id}`);
    await interaction.reply("⏹️ 再生を停止して退出しました。");
  }

  await updatePanel(interaction.guildId, manager).catch(() => undefined);
}
