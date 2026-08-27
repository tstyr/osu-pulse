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
- `/render` でosu!standardのResult URLまたは`.osr`をローカルdanserでMP4化
- `/render-status` で独立したローカルRendererの状態を確認

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

## ローカルReplay Renderer（Windows）

RendererはBotとは別プロセスで、`127.0.0.1:8765`だけにBindします。Botから自動起動せず、停止中でも既存コマンドには影響しません。利用するPCではBotも同じWindows PC上で起動してください。

1. [danser-goの公式Releases](https://github.com/Wieku/danser-go/releases)からWindows版を展開します。
2. `renderer/.env.example` を `renderer/.env` にコピーします。
3. `DANSER_PATH`、`FFMPEG_PATH`、`OSU_SONGS_PATH`、`OSU_CLIENT_ID`、`OSU_CLIENT_SECRET`を設定します。
4. Bot側の`.env.local`とRenderer側の`renderer/.env`へ同じ`RENDER_SERVER_TOKEN`を設定します（空でもloopback限定で動作します）。
5. `renderer/start_renderer.bat`をダブルクリックします。初回だけPython仮想環境と小さなAPI依存を自動セットアップします。

既定値は2560x1600・60fps・Original speed・Motion Blur OFFです。起動時にdanser、FFmpeg、Songs、osu! API、NVENCを検査し、SongsのBeatmap ID/MD5インデックスを作成します。danserは内部でFFmpegを利用し、NVENCの実エンコード確認に失敗した場合はlibx264へフォールバックします。

Discordコマンドを追加・変更した後は一度登録し直します。

```bash
npm run bot:register
npm run bot:start
```

使用例：

```text
/render url:https://osu.ppy.sh/scores/osu/1234567890
/render replay:<myplay.osr> resolution:2560x1600 fps:60
/render-status
```

Rendererを止めるときは起動したBATウィンドウを閉じます。再起動後はBotを再起動せずに利用できます。出力は`renderer/output`に保存され、既定で24時間後に削除されます。Jobの一時ファイルは成功・失敗・キャンセル後に削除されます（`KEEP_FAILED_TEMP=true`を除く）。

## 必須環境変数

`.env.example` を参照してください。最低限、以下が必要です。

- `DATABASE_URL`
- `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
- `INTERNAL_API_SECRET`, `CRON_SECRET`
- `WEB_APP_URL`
- 音楽利用時は `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`
- ローカルRenderer利用時は `RENDER_SERVER_URL`, `RENDER_SERVER_TOKEN`

秘密値はGitへコミットせず、Vercel環境変数とworker側のSecret Storeへ登録してください。

## 検証

```bash
npm run lint
npm run typecheck
npm test
renderer\.venv\Scripts\python.exe -m unittest discover -s renderer\tests
npm run build
```

## デプロイ

Webはリンク済みVercelプロジェクトへデプロイします。

```bash
vercel deploy --prod
```

Vercel Functions内ではGateway workerやRendererを起動しません。ローカルReplay Rendererを使う構成ではGateway workerをRendererと同じWindows PCで起動します。
