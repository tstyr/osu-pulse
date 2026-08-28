import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const modeChoices = [
  { name: "osu!", value: "osu" },
  { name: "taiko", value: "taiko" },
  { name: "catch", value: "fruits" },
  { name: "mania", value: "mania" },
] as const;

export const commands = [
  new SlashCommandBuilder()
    .setName("osu")
    .setDescription("osu!アカウントと統計を管理")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("link")
        .setDescription("自分のDiscordにosu!アカウントを登録・変更")
        .addStringOption((option) => option.setName("username").setDescription("osu! username または user ID").setRequired(true))
        .addStringOption((option) => option.setName("mode").setDescription("メインモード").addChoices(...modeChoices)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("profile")
        .setDescription("登録済みプロフィールを表示")
        .addUserOption((option) => option.setName("user").setDescription("Discordユーザー"))
        .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("recent")
        .setDescription("最新リザルトを表示")
        .addUserOption((option) => option.setName("user").setDescription("Discordユーザー"))
        .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("growth")
        .setDescription("成長グラフを表示")
        .addUserOption((option) => option.setName("user").setDescription("Discordユーザー"))
        .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("daily")
        .setDescription("毎日の成長DMを設定")
        .addBooleanOption((option) => option.setName("enabled").setDescription("DMを有効にする").setRequired(true)),
    )
    .addSubcommand((subcommand) => subcommand.setName("unlink").setDescription("自分のDiscordとの登録を解除")),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("サーバーのリザルト通知を設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("results_channel")
        .setDescription("リアルタイムリザルトを送るチャンネル")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addNumberOption((option) => option.setName("minimum_pp").setDescription("通知する最小pp（0で全件）").setMinValue(0).setMaxValue(2000)),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("自分とBot全体の統計を表示")
    .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),

  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("リマインダーを管理")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("新しいリマインダー")
        .addIntegerOption((option) => option.setName("after").setDescription("何分・時間・日後").setRequired(true).setMinValue(1).setMaxValue(365))
        .addStringOption((option) => option.setName("unit").setDescription("単位").setRequired(true).addChoices({ name: "分", value: "minutes" }, { name: "時間", value: "hours" }, { name: "日", value: "days" }))
        .addStringOption((option) => option.setName("message").setDescription("通知内容").setRequired(true).setMaxLength(500))
        .addBooleanOption((option) => option.setName("dm").setDescription("チャンネルではなくDMへ送る")),
    )
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("予定中のリマインダー一覧"))
    .addSubcommand((subcommand) => subcommand.setName("cancel").setDescription("リマインダーをキャンセル").addStringOption((option) => option.setName("id").setDescription("一覧に表示されたID").setRequired(true))),

  new SlashCommandBuilder()
    .setName("pomodoro")
    .setDescription("集中セッションを管理")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("ポモドーロを開始")
        .addIntegerOption((option) => option.setName("focus").setDescription("集中時間（分）").setMinValue(1).setMaxValue(180))
        .addIntegerOption((option) => option.setName("break").setDescription("休憩時間（分）").setMinValue(1).setMaxValue(60))
        .addIntegerOption((option) => option.setName("rounds").setDescription("セット数").setMinValue(1).setMaxValue(12)),
    )
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("進行状況を表示"))
    .addSubcommand((subcommand) => subcommand.setName("stop").setDescription("現在のセッションを停止")),

  new SlashCommandBuilder()
    .setName("music")
    .setDescription("Lavalink音楽プレイヤー")
    .addSubcommand((subcommand) => subcommand.setName("play").setDescription("曲を再生・キューへ追加").addStringOption((option) => option.setName("query").setDescription("曲名またはURL").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("skip").setDescription("現在の曲をスキップ"))
    .addSubcommand((subcommand) => subcommand.setName("pause").setDescription("一時停止"))
    .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("再開"))
    .addSubcommand((subcommand) => subcommand.setName("queue").setDescription("再生キューを表示"))
    .addSubcommand((subcommand) => subcommand.setName("volume").setDescription("音量を変更").addIntegerOption((option) => option.setName("percent").setDescription("0〜150").setRequired(true).setMinValue(0).setMaxValue(150)))
    .addSubcommand((subcommand) => subcommand.setName("stop").setDescription("停止して退出")),

  new SlashCommandBuilder()
    .setName("render")
    .setDescription("osu!standard ReplayをローカルPCで動画化")
    .addStringOption((option) => option
      .setName("account")
      .setDescription("/osu link済みアカウントの直近プレイ")
      .setAutocomplete(true))
    .addStringOption((option) => option.setName("url").setDescription("osu! Result URL"))
    .addAttachmentOption((option) => option.setName("replay").setDescription(".osr Replayファイル"))
    .addStringOption((option) => option.setName("resolution").setDescription("動画解像度（既定: 1920x1080）").addChoices(
      { name: "1920x1080 (16:9 / default)", value: "1920x1080" },
      { name: "2560x1440 (16:9)", value: "2560x1440" },
      { name: "2560x1600 (16:10)", value: "2560x1600" },
      { name: "3840x2160 (4K)", value: "3840x2160" },
    ))
    .addIntegerOption((option) => option.setName("fps").setDescription("動画FPS（既定: 60）").addChoices(
      { name: "60 fps", value: 60 },
      { name: "120 fps", value: 120 },
      { name: "240 fps", value: 240 },
    ))
    .addStringOption((option) => option.setName("speed").setDescription("再生速度（既定: Original）").addChoices(
      { name: "Original", value: "original" },
      { name: "1.0x", value: "1.0" },
      { name: "0.5x", value: "0.5" },
      { name: "0.75x", value: "0.75" },
      { name: "1.25x", value: "1.25" },
      { name: "1.5x", value: "1.5" },
      { name: "2.0x", value: "2.0" },
    ))
    .addBooleanOption((option) => option.setName("motion_blur").setDescription("Motion Blur（既定: OFF）")),

  new SlashCommandBuilder()
    .setName("render-status")
    .setDescription("ローカルRendererの状態を確認"),

  new SlashCommandBuilder()
    .setName("server-status")
    .setDescription("PC・Renderer状況チャンネルを管理")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("同一カテゴリに状況チャンネルを自動作成"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("refresh")
        .setDescription("すべての状況チャンネルを今すぐ更新"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("自動作成した状況カテゴリとチャンネルを削除"),
    ),
].map((command) => command.toJSON());
