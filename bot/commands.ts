import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const modeChoices = [
  { name: "osu!", value: "osu" },
  { name: "taiko", value: "taiko" },
  { name: "catch", value: "fruits" },
  { name: "mania", value: "mania" },
] as const;

// Kept as the single source of truth for the interactive menu's inputs.
export const legacyCommands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Botの応答速度と接続状態を確認"),

  new SlashCommandBuilder().setName("help").setDescription("機能一覧と操作ガイドを表示"),
  new SlashCommandBuilder().setName("health").setDescription("DB・Renderer・Lavalinkの接続状態を一括確認"),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("常設クイック操作パネルを設置")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("このチャンネルへ操作パネルを設置")),

  new SlashCommandBuilder()
    .setName("updates")
    .setDescription("Botアップデート通知を設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("通知チャンネルを設定").addChannelOption((option) => option.setName("channel").setDescription("アップデート通知先").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))),

  new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("要望・不具合を開発者へ送信")
    .addStringOption((option) => option.setName("type").setDescription("種類").setRequired(true).addChoices(
      { name: "機能要望", value: "request" },
      { name: "不具合", value: "bug" },
      { name: "その他", value: "other" },
    )),

  new SlashCommandBuilder()
    .setName("goal")
    .setDescription("PP・世界順位の目標を管理")
    .addSubcommand((subcommand) => subcommand.setName("set").setDescription("目標を設定").addStringOption((option) => option.setName("mode").setDescription("モード").setRequired(true).addChoices(...modeChoices)).addNumberOption((option) => option.setName("pp").setDescription("目標PP").setMinValue(1).setMaxValue(100_000)).addIntegerOption((option) => option.setName("rank").setDescription("目標世界順位").setMinValue(1).setMaxValue(100_000_000)))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("目標の進捗を表示").addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)))
    .addSubcommand((subcommand) => subcommand.setName("clear").setDescription("目標を削除").addStringOption((option) => option.setName("mode").setDescription("モード").setRequired(true).addChoices(...modeChoices))),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("サーバー内ランキング")
    .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices))
    .addStringOption((option) => option.setName("period").setDescription("集計期間").addChoices(
      { name: "Pulse Index（頻度別・30日）", value: "pulse" },
      { name: "今月のシーズン", value: "season" },
      { name: "直近7日", value: "weekly" },
    )),

  new SlashCommandBuilder()
    .setName("analysis")
    .setDescription("osu!プレイ傾向を分析")
    .addSubcommand((subcommand) => subcommand.setName("skill").setDescription("スキルレーダーを表示").addUserOption((option) => option.setName("user").setDescription("対象ユーザー")).addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)))
    .addSubcommand((subcommand) => subcommand.setName("bpm").setDescription("得意・苦手BPMを分析").addUserOption((option) => option.setName("user").setDescription("対象ユーザー")).addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)))
    .addSubcommand((subcommand) => subcommand.setName("attributes").setDescription("AR・OD・CSの傾向を分析").addUserOption((option) => option.setName("user").setDescription("対象ユーザー")).addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices))),

  new SlashCommandBuilder()
    .setName("session")
    .setDescription("直近プレイセッションをまとめて分析")
    .addUserOption((option) => option.setName("user").setDescription("対象ユーザー"))
    .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),

  new SlashCommandBuilder()
    .setName("profile-card")
    .setDescription("共有できるosu!プロフィールカードを表示")
    .addUserOption((option) => option.setName("user").setDescription("対象ユーザー"))
    .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),

  new SlashCommandBuilder()
    .setName("export")
    .setDescription("保存済みosu!統計を書き出し")
    .addStringOption((option) => option.setName("format").setDescription("形式").setRequired(true).addChoices({ name: "CSV", value: "csv" }, { name: "JSON", value: "json" }))
    .addStringOption((option) => option.setName("mode").setDescription("モード").addChoices(...modeChoices)),

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
        .setName("pulse")
        .setDescription("総合パフォーマンス指数と成長を表示")
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
    .setName("reports")
    .setDescription("サーバー集計レポートを設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("デイリー・週間レポート先を設定")
      .addChannelOption((option) => option.setName("daily_channel").setDescription("毎日の成長レポート").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addChannelOption((option) => option.setName("weekly_channel").setDescription("週間表彰").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))),

  new SlashCommandBuilder()
    .setName("admin-log")
    .setDescription("管理ログ・コンソール転送先を設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("ログチャンネルを設定")
      .addChannelOption((option) => option.setName("audit_channel").setDescription("管理操作ログ").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((option) => option.setName("console_channel").setDescription("Bot・Renderer・Lavalinkコンソール").addChannelTypes(ChannelType.GuildText).setRequired(true))),

  new SlashCommandBuilder()
    .setName("onboarding")
    .setDescription("新規参加者向けの案内パネルを設置")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option.setName("channel").setDescription("オンボーディングパネルの設置先").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("参加完了時に付与するロール").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("サポートチケットを管理")
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("チケット機能を設定")
      .addChannelOption((option) => option.setName("category").setDescription("チケットを作成するカテゴリ").addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((option) => option.setName("log_channel").setDescription("チケットログ送信先").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption((option) => option.setName("support_role").setDescription("チケットを閲覧する担当ロール")))
    .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("このチャンネルに作成ボタンを設置"))
    .addSubcommand((subcommand) => subcommand.setName("close").setDescription("現在のチケットを閉じる")),

  new SlashCommandBuilder()
    .setName("community")
    .setDescription("投票・アンケート・抽選を開催")
    .addSubcommand((subcommand) => subcommand.setName("poll").setDescription("選択式投票を開始")
      .addStringOption((option) => option.setName("question").setDescription("質問").setRequired(true).setMaxLength(250))
      .addStringOption((option) => option.setName("options").setDescription("選択肢を | で区切る（2～5個）").setRequired(true).setMaxLength(400))
      .addIntegerOption((option) => option.setName("duration_minutes").setDescription("受付時間（分）").setRequired(true).setMinValue(1).setMaxValue(43_200)))
    .addSubcommand((subcommand) => subcommand.setName("giveaway").setDescription("抽選を開始")
      .addStringOption((option) => option.setName("prize").setDescription("景品・抽選内容").setRequired(true).setMaxLength(250))
      .addIntegerOption((option) => option.setName("duration_minutes").setDescription("受付時間（分）").setRequired(true).setMinValue(1).setMaxValue(43_200))
      .addIntegerOption((option) => option.setName("winners").setDescription("当選人数").setMinValue(1).setMaxValue(20)))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("開催中の投票・抽選を表示")),

  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("osu!アカウントとサーバーロールの認証を開始"),

  new SlashCommandBuilder()
    .setName("verify-panel")
    .setDescription("認証開始ボタンをこのチャンネルへ設置")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("track-player")
    .setDescription("Discord連携なしでosu!プレイヤーをDB追跡")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option.setName("username").setDescription("osu! username または user ID").setRequired(true))
    .addStringOption((option) => option.setName("mode").setDescription("検索するモード").addChoices(...modeChoices)),

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
    .addSubcommand((subcommand) => subcommand.setName("upload").setDescription("FLAC / WAV / MP3 / M4Aをローカル音源へ追加").addAttachmentOption((option) => option.setName("file").setDescription("最大256kbpsで保存する音源").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("library").setDescription("PC内のローカル音源一覧"))
    .addSubcommand((subcommand) => subcommand.setName("local-play").setDescription("ローカル音源を再生").addStringOption((option) => option.setName("id").setDescription("/music library に表示されたID").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("local-delete").setDescription("自分が追加したローカル音源を削除").addStringOption((option) => option.setName("id").setDescription("/music library に表示されたID").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("play").setDescription("曲を再生・キューへ追加").addStringOption((option) => option.setName("query").setDescription("曲名またはURL").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("skip").setDescription("現在の曲をスキップ"))
    .addSubcommand((subcommand) => subcommand.setName("pause").setDescription("一時停止"))
    .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("再開"))
    .addSubcommand((subcommand) => subcommand.setName("queue").setDescription("再生キューを表示"))
    .addSubcommand((subcommand) => subcommand.setName("loop").setDescription("ループ再生を切り替え").addStringOption((option) => option.setName("mode").setDescription("ループ範囲").setRequired(true).addChoices(
      { name: "OFF", value: "off" },
      { name: "現在の1曲", value: "track" },
      { name: "キュー全体", value: "queue" },
    )))
    .addSubcommand((subcommand) => subcommand.setName("autoplay").setDescription("キュー終了後の関連曲自動再生を切り替え").addBooleanOption((option) => option.setName("enabled").setDescription("有効/無効").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("volume").setDescription("音量を変更").addIntegerOption((option) => option.setName("percent").setDescription("0〜150").setRequired(true).setMinValue(0).setMaxValue(150)))
    .addSubcommand((subcommand) => subcommand.setName("favorite-add").setDescription("現在の曲をお気に入りへ保存"))
    .addSubcommand((subcommand) => subcommand.setName("favorites").setDescription("自分のお気に入り一覧"))
    .addSubcommand((subcommand) => subcommand.setName("favorite-play").setDescription("お気に入りを再生").addStringOption((option) => option.setName("id").setDescription("一覧に表示されたID").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("favorite-remove").setDescription("お気に入りを削除").addStringOption((option) => option.setName("id").setDescription("一覧に表示されたID").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("playlists").setDescription("Web UIで作成したサーバープレイリスト一覧"))
    .addSubcommand((subcommand) => subcommand.setName("playlist-play").setDescription("サーバープレイリストを再生").addStringOption((option) => option.setName("id").setDescription("一覧に表示されたプレイリストID").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("stop").setDescription("停止して退出")),

  new SlashCommandBuilder()
    .setName("render")
    .setDescription("osu!standard / mania ReplayをローカルPCで動画化")
    .addStringOption((option) => option
      .setName("account")
      .setDescription("/osu link済みアカウントのReplay取得可能な直近プレイ")
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
    .addBooleanOption((option) => option.setName("motion_blur").setDescription("Motion Blur（既定: OFF）"))
    .addBooleanOption((option) => option.setName("highlight").setDescription("終盤30秒のハイライトクリップも自動生成")),

  new SlashCommandBuilder()
    .setName("render-status")
    .setDescription("ローカルRendererの状態を確認"),

  new SlashCommandBuilder()
    .setName("render-batch")
    .setDescription("複数のosu! Score URLを一括でレンダー待機列へ追加")
    .addStringOption((option) => option.setName("urls").setDescription("URLを空白または改行で区切る（最大20件）").setRequired(true).setMaxLength(4_000))
    .addBooleanOption((option) => option.setName("highlight").setDescription("各動画の終盤30秒ハイライトも生成")),

  new SlashCommandBuilder()
    .setName("render-schedule")
    .setDescription("Score URLのレンダーを指定時間後に予約")
    .addStringOption((option) => option.setName("url").setDescription("osu! Score URL").setRequired(true))
    .addIntegerOption((option) => option.setName("after_minutes").setDescription("何分後に開始するか").setRequired(true).setMinValue(1).setMaxValue(44_640)),

  new SlashCommandBuilder()
    .setName("render-compare")
    .setDescription("同じ譜面の昔と現在など、2本を横並び比較動画にする")
    .addStringOption((option) => option.setName("old_url").setDescription("昔のScore URL").setRequired(true))
    .addStringOption((option) => option.setName("new_url").setDescription("現在のScore URL").setRequired(true)),

  new SlashCommandBuilder()
    .setName("render-versus")
    .setDescription("2人のリプレイを横並び比較動画にする")
    .addStringOption((option) => option.setName("player_1_url").setDescription("Player 1のScore URL").setRequired(true))
    .addStringOption((option) => option.setName("player_2_url").setDescription("Player 2のScore URL").setRequired(true)),

  new SlashCommandBuilder()
    .setName("rival")
    .setDescription("Discord連携またはosu!ユーザー名でライバル比較")
    .addSubcommand((subcommand) => subcommand.setName("add").setDescription("ライバルを追加")
      .addUserOption((option) => option.setName("user").setDescription("ライバルにするDiscordメンバー（リンク済みの場合）"))
      .addStringOption((option) => option.setName("your_osu").setDescription("自分側のosu! username / ID（未リンク時に指定）"))
      .addStringOption((option) => option.setName("rival_osu").setDescription("相手側のosu! username / ID（Discord未リンク時に指定）"))
      .addStringOption((option) => option.setName("mode").setDescription("比較モード").addChoices(...modeChoices))
      .addChannelOption((option) => option.setName("channel").setDescription("毎日の比較通知先（未指定はDM）").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((subcommand) => subcommand.setName("compare").setDescription("2人の総合力・スキル・共通譜面を今すぐ比較")
      .addUserOption((option) => option.setName("user").setDescription("比較するDiscordメンバー（リンク済みの場合）"))
      .addStringOption((option) => option.setName("your_osu").setDescription("自分側のosu! username / ID（未リンク時に指定）"))
      .addStringOption((option) => option.setName("rival_osu").setDescription("相手側のosu! username / ID（Discord未リンク時に指定）"))
      .addStringOption((option) => option.setName("mode").setDescription("比較モード").addChoices(...modeChoices)))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("登録中のライバル一覧"))
    .addSubcommand((subcommand) => subcommand.setName("remove").setDescription("ライバルを解除").addStringOption((option) => option.setName("id").setDescription("一覧に表示されたID").setRequired(true))),

  new SlashCommandBuilder()
    .setName("overlay")
    .setDescription("OBS用リアルタイムリザルトオーバーレイ")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("OBS Browser Source URLを発行・再発行"))
    .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("現在のオーバーレイURLを無効化")),

  new SlashCommandBuilder()
    .setName("montage")
    .setDescription("サーバーの月間ベストプレイ動画")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("毎月の自動作成を設定")
      .addChannelOption((option) => option.setName("channel").setDescription("完成通知先").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((option) => option.setName("mode").setDescription("対象モード").setRequired(true).addChoices(...modeChoices))
      .addBooleanOption((option) => option.setName("enabled").setDescription("自動作成を有効化").setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("create").setDescription("指定月のベストプレイを今すぐキュー追加")
      .addStringOption((option) => option.setName("month").setDescription("YYYY-MM（未指定は先月）"))
      .addStringOption((option) => option.setName("mode").setDescription("対象モード").addChoices(...modeChoices))),

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

  new ContextMenuCommandBuilder()
    .setName("osu!リザルトをレンダリング")
    .setType(ApplicationCommandType.Message),
].map((command) => command.toJSON());

export const commands = [
  new SlashCommandBuilder().setName("pulse").setDescription("osu! Pulse の全機能・管理メニューを開く").toJSON(),
  ...legacyCommands.filter((command) => command.type === ApplicationCommandType.Message),
];
