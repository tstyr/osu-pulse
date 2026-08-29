# osu! pulse

osu!の成長記録、Discordへのリザルト通知、毎日のDM、リマインダー、ポモドーロ、Lavalink音楽再生を一つにまとめたDiscord Bot + 非公開コントロールパネルです。

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
- キーフレーズで保護したWeb UIでRenderer、CPU/GPU、メモリ、ディスク、通信量、処理統計を確認
- Web UIから既定解像度・FPS、圧縮、YouTube公開範囲、R2/osu!資格情報を管理
- 設定チャンネルへ新規リザルトを自動投稿
- 日次成長サマリーをDM送信
- `/remind`、`/pomodoro` とVercel Workflowによる耐久タイマー
- `/music` から再生・キュー・一時停止・スキップ・音量・停止。再生時には常設ボタン付きパネルを表示し、15秒ごとに進捗を更新
- `/stats` でBot利用統計
- `/render` でosu!standard / maniaのResult URL、登録アカウントの直近Replay、または`.osr`をMP4化
- `/render-status` で独立したローカルRendererの状態を確認
- Renderer完了後、判定・pp・精度・曲名を含むタイトルでYouTubeへ公開投稿（OAuth設定時）
- `/server-status setup` でRenderer、CPU/GPU、RAM、ディスク、通信量、動画容量、処理件数を1カテゴリのチャンネル名へ表示
- 状況カテゴリは15秒ごとに再取得。YouTube未設定時のみ完成動画をCloudflare R2（未設定時はVercel Blob）へアップロード
- Webの`/dashboard/render`からNeonのジョブを経由してローカルRendererへ依頼し、完成動画はYouTubeリンクで受け取る
- Rendererは設定に応じて最大2本を並列処理。既定は安定性を優先して1本

## 非公開コントロールパネル

`https://osu-pulse.vercel.app`は公開プロフィールを表示せず、管理キーフレーズのログイン画面だけを公開します。ログイン後は次の画面を利用できます。

- **概要:** Renderer接続、14日間の処理本数、成功率、YouTube投稿数、CPU/GPU/RAM/ディスク/通信量、最近のジョブ
- **レンダー:** Score URLまたは`.osr`からレンダーを依頼し、進捗確認・キャンセル・完成動画を開く
- **設定:** 解像度/FPS、最大並列数、GPUエンコーダ、譜面取得、圧縮、YouTube、osu! API、R2を説明付きの折りたたみ項目で管理
- **データベース:** Neon DB全体容量、テーブル別行数・データ容量・インデックス容量を読み取り専用で確認

キーフレーズはVercelの`CONTROL_PANEL_KEYPHRASE`で指定します。未設定時は既存の`WEB_RENDER_ACCESS_KEY`を使用します。セッション署名とDB内資格情報の暗号化には`CONTROL_PANEL_SESSION_SECRET`を使い、未設定時は`INTERNAL_API_SECRET`へフォールバックします。秘密値は画面へ再表示せず、AES-256-GCMで暗号化して保存します。

保存したRenderer設定は、外向きVercel Bridgeを通じて`renderer/.env`へ同期されます。実行中の処理がある場合は完了を待ち、`renderer/start_renderer.bat`が自動再起動して反映します。`RENDER_BRIDGE_TOKEN`、管理キーフレーズ、`DATABASE_URL`は接続喪失を防ぐためWeb UIから変更できません。

## ローカル起動

Windowsでは、リポジトリ直下の`start_osu_pulse.bat`をダブルクリックすると、Renderer、Lavalink、Discord Botを別ウィンドウでまとめて起動できます。それぞれ個別に停止・再起動できます。起動前チェックだけ行う場合は次を実行します。

```bat
start_osu_pulse.bat --check
```

Botだけ起動する場合は`bot/start_bot.bat`、Rendererだけ起動する場合は`renderer/start_renderer.bat`、音楽ノードだけ起動する場合は`lavalink/start_lavalink.bat`を使います。初回のLavalink起動時は公式Lavalink 4.2.2 JAR（約100 MB）をダウンロードし、SHA-256を検証します。Java 17以上が必要です。初回セットアップやWeb開発サーバーの起動は以下のコマンドを使います。

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

Dockerを利用する場合は、BAT版の代わりに次の構成でもLavalinkを起動できます。

```bash
docker compose -f lavalink/compose.yml up -d
```

## ローカルReplay Renderer（Windows）

RendererはBotとは別プロセスで、`127.0.0.1:8765`だけにBindします。クラウドブリッジもPCからVercelへの外向き通信だけを使い、ポート開放やトンネルは不要です。Botが停止中でも、Rendererさえ起動していればWebの`/render`から利用できます。Discordの`/render`を使う場合だけBotも同じWindows PCで起動します。

1. `powershell -ExecutionPolicy Bypass -File renderer/install_danser.ps1` を実行します。公式`Wieku/danser-go`の最新安定Windows版を`renderer/local/danser`へ配置します。
2. std用Appuとmania用R Skinをosu!の`Skins`へ展開し、`OSU_STANDARD_SKIN`と`OSU_MANIA_SKIN`へフォルダ名を設定します。既定名は`osu-pulse Appu`と`osu-pulse R Skin v3.0 Bars`です。
3. `renderer/.env.example` を `renderer/.env` にコピーします。
4. `FFMPEG_PATH`、`OSU_SONGS_PATH`、`OSU_CLIENT_ID`、`OSU_CLIENT_SECRET`を設定します。既定の`DANSER_PATH`は同梱インストーラーの配置先を使います。
5. Bot側の`.env.local`とRenderer側の`renderer/.env`へ同じ`RENDER_SERVER_TOKEN`を設定します（空でもloopback限定で動作します）。
6. Web連携ではVercel Blobを接続し、`RENDER_CLOUD_URL`、`RENDER_BRIDGE_TOKEN`、`BLOB_READ_WRITE_TOKEN`をRenderer側に設定します。このリポジトリをVercel CLIでリンク済みなら`renderer/.venv/Scripts/python.exe -m renderer.configure_cloud_bridge`で安全に同期できます。
7. `renderer/start_renderer.bat`をダブルクリックします。初回はstd側のPython環境に加え、Python 3.12+のmania専用環境と固定revisionの[R3D osu!mania renderer](https://github.com/R3dWolfie/osu-mania-renderer)を自動導入します。手動導入は`powershell -ExecutionPolicy Bypass -File renderer/install_mania_renderer.ps1`です。

既定値は1920x1080・60fps・Original speed・Motion Blur OFFです。stdはdanser + Appu、maniaは専用ModernGL renderer + R Skinへ自動分岐します。起動時に両Renderer、両Skin、FFmpeg、Songs、osu! API、NVIDIA NVENC、AMD AMFを検査し、SongsのBeatmap ID/MD5インデックスを作成します。必要なBeatmapがSongsにない場合は、osu! APIでBeatmapsetを特定し、Hinamizawa mirrorから動画なしの`.osz`を自動取得・安全に展開してインデックスを更新します（`AUTO_DOWNLOAD_BEATMAPS=false`で無効化）。利用可能なGPUエンコーダを自動選択し、失敗時はlibx264へフォールバックします。maniaでは現在Custom speedとMotion Blurは利用できません。

Discordコマンドを追加・変更した後は一度登録し直します。

### YouTube公開への自動投稿

YouTube Data API v3を有効にしたGoogle Cloudプロジェクトで、OAuthクライアントを「デスクトップアプリ」として作成し、JSONをダウンロードします。次のコマンドを1回実行するとブラウザでYouTubeチャンネルを選択でき、更新トークンはGit管理外の`renderer/.env`だけへ保存されます。

```powershell
renderer\.venv\Scripts\python.exe -m renderer.configure_youtube C:\path\to\client_secret.json
```

認証後に`renderer/start_renderer.bat`を再起動します。以後、レンダー本体の完了後に`判定 | pp | 精度 | Artist - 曲名 [難易度]`形式のタイトルで公開投稿し、登録者への新着通知は送りません。`YOUTUBE_DELETE_AFTER_UPLOAD=true`では、YouTubeが投稿成功を返した後に同じJob IDのローカルMP4とR2オブジェクトを削除します。成功記録はGit管理外の`renderer/youtube-uploads.json`へ先に保存されます。

`YOUTUBE_PRIVACY_STATUS=public`を要求しますが、2020年7月28日以降に作成された未監査のYouTube APIプロジェクトはGoogle側で非公開に制限される場合があります。公開を保証するにはGoogleのAPIコンプライアンス監査が必要です。RendererとDiscordはAPIが実際に返した公開状態を表示します。

```bash
npm run bot:register
npm run bot:start
```

使用例：

```text
/render url:https://osu.ppy.sh/scores/osu/1234567890
/render url:https://osu.ppy.sh/scores/mania/1234567890
/render account:<pp・判定・STD/MANIA・曲名から選択>
/render replay:<myplay.osr> resolution:1920x1080 fps:60
/render-status
/server-status setup
/server-status refresh
/server-status remove
```

Rendererを止めるときは起動したBATウィンドウを閉じます。再起動後はBotを再起動せずに利用できます。出力は`renderer/output`に保存され、既定で24時間後に削除されます。Jobの一時ファイルは成功・失敗・キャンセル後に削除されます（`KEEP_FAILED_TEMP=true`を除く）。

Discordのアップロード上限を超える動画は外部ストレージへ送ります。提示されたR2バケットURLは次のコマンドでエンドポイントとバケット名に分離して設定できます。その後、Cloudflare R2で対象バケットだけにObject Read & Write権限を持つS3 API tokenを作成し、`R2_ACCESS_KEY_ID`と`R2_SECRET_ACCESS_KEY`を`.env.local`と`renderer/.env`へ保存してください。公開URLを設定しない場合は7日間有効な署名付きダウンロードURLを発行します。資格情報がない間は既存のVercel Blobを自動利用します。

```bash
renderer/.venv/Scripts/python.exe -m renderer.configure_r2 "https://ACCOUNT_ID.r2.cloudflarestorage.com/BUCKET"
```

Webでは`https://osu-pulse.vercel.app`へ管理キーフレーズでログインし、`/dashboard/render`を開きます。ログインセッションはHttpOnly Cookieで管理し、レンダージョブのIDと一時トークンだけをバージョン付き`sessionStorage`へ保存します。`.osr`はVercel Functionsのペイロード制限を考慮して3 MBまでです。YouTube投稿を無効にした場合、完成MP4はR2（未設定時はVercel Blob）へアップロードします。

## 必須環境変数

`.env.example` を参照してください。最低限、以下が必要です。

- `DATABASE_URL`
- `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
- `INTERNAL_API_SECRET`, `CRON_SECRET`
- `WEB_APP_URL`
- 音楽利用時は `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`
- ローカルRenderer利用時は `RENDER_SERVER_URL`, `RENDER_SERVER_TOKEN`
- Web管理画面では `CONTROL_PANEL_KEYPHRASE`, `CONTROL_PANEL_SESSION_SECRET`（どちらも既存変数へのフォールバックあり）
- Web Renderer利用時は `RENDER_BRIDGE_TOKEN`, `RENDER_CLOUD_URL` と、R2または `BLOB_READ_WRITE_TOKEN`

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

Vercel Functions内ではGateway workerやdanserを起動しません。WebのレンダージョブはNeonへ保存され、起動中のローカルRendererがポーリングして処理します。Gateway worker（Discord Bot）とRendererは独立して起動・停止できます。
