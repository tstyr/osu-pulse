import type { ChatInputCommandInteraction, Client, GuildMember } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { LavalinkManager } from "lavalink-client";

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
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
    const member = interaction.member as GuildMember;
    const voiceChannelId = member.voice.channelId;
    if (!voiceChannelId) {
      await interaction.reply({ content: "先にボイスチャンネルへ参加してください。", flags: MessageFlags.Ephemeral });
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

    const wasPlaying = player.playing;
    player.queue.add(track);
    if (!wasPlaying) await player.play();
    const embed = new EmbedBuilder()
      .setColor(0xff66aa)
      .setAuthor({ name: wasPlaying ? "Queueに追加" : "Now playing" })
      .setTitle(track.info.title)
      .setDescription(
        `${track.info.author ?? "Unknown artist"} · ${durationLabel(track.info.duration ?? 0)}`,
      )
      .setFooter({ text: `requested by ${interaction.user.username}` });

    if (track.info.uri) embed.setURL(track.info.uri);
    if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!existing) {
    await interaction.reply({ content: "現在のプレイヤーはありません。/music play で開始してください。", flags: MessageFlags.Ephemeral });
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
}
