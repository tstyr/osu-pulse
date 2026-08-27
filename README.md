# osu! pulse

osu!の成長記録、Discordへのリザルト通知、毎日のDM、リマインダー、ポモドーロ、Lavalink音楽再生を一つにまとめたDiscord Bot + Webダッシュボードです。

- Web: https://osu-pulse.vercel.app
- Repository: https://github.com/tstyr/osu-pulse

## 構成

- **Web / API / Cron / Workflow:** Next.js 16 on Vercel
- **Database:** Neon Postgres + Drizzle ORM
- **Discord:** discord.js の常駐Gateway worker
- **osu!:** OAuth Client Credentials + API v2
- **Music:** Lavalink v4 + official YouTube source plugin

VercelはWeb・API・毎日21:00 JSTの集計・耐久ワークフローを担当します。Discord Gatewayと音声接続は常時接続が必要なため、別の常駐Node.js workerとして実行します。

## 主な機能

- `/osu link` で初回アカウント登録、4モード別のスナップショット保存
- WebでPP・順位・精度・プレイ回数の推移と最近のリザルトを表示
- 設定チャンネルへ新規リザルトを自動投稿
- 日次成長サマリーをDM送信
- `/remind`、`/pomodoro` とVercel Workflowによる耐久タイマー
- `/music` から再生・キュー・一時停止・スキップ・音量・停止
- `/stats` でBot利用統計

## ローカル起動

```bash
npm install
copy .env.example .env.local
npm run db:generate
npm run db:migrate
npm run dev
```

BotコマンドをDiscordへ登録してGateway workerを起動します。

```bash
npm run bot:register
npm run bot:dev
```

音楽機能を使う場合はLavalinkも起動します。

```bash
docker compose -f lavalink/compose.yml up -d
```

## 必須環境変数

`.env.example` を参照してください。最低限、以下が必要です。

- `DATABASE_URL`
- `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
- `INTERNAL_API_SECRET`, `CRON_SECRET`
- `WEB_APP_URL`
- 音楽利用時は `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`

秘密値はGitへコミットせず、Vercel環境変数とworker側のSecret Storeへ登録してください。

## 検証

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## デプロイ

Webはリンク済みVercelプロジェクトへデプロイします。

```bash
vercel deploy --prod
```

常駐Gateway workerとLavalinkはRailway、Fly.io、VPSなど常時稼働できる環境に配置してください。Vercel Functions内ではGateway workerを起動しません。
