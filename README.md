# osu! pulse

osu!の成長記録、Discordへのリザルト通知、毎日のDM、リマインダー、ポモドーロ、Lavalink音楽再生を一つにまとめたDiscord Bot + 非公開コントロールパネルです。

- Local Web: http://127.0.0.1:3000 （外部アクセス用URLは `work/public-web-url.txt`）
- Repository: https://github.com/tstyr/osu-pulse

## 安定性・負荷対策

- 通知は永続Outboxと定期再照合で取りこぼしを復旧し、Discord nonceで短時間の再送重複を防ぎます。PB／異常値条件はスコア分析後にも評価します。
- 自動レンダーの許可時間待ちはワーカーを占有しません。手動レンダーは許可時間外も実行でき、優先順位変更時の二重実行を防止します。
- YouTube投稿成功をサムネイル等の後処理より先に記録し、キャンセル／タイムアウトでは関連プロセスを終了します。未投稿動画と処理中ファイルは期限削除から保護します。
- Web UIのポーリング重複を抑え、キュー操作中の自動更新による巻き戻りを防止します。個人グラフの集計を再利用し、概要統計はDB側でまとめて計算します。
- Windows／ArchのUSB共有とDB世代管理は[SHARED_STORAGE.md](SHARED_STORAGE.md)を参照してください。環境変数・DBバックアップ・音源・動画はGit管理しません。
- 手動レンダーの受付上限は自動レンダーの先行予約数（4本）と分離し、全体の待機列は最大100件です。実際の同時処理数は設定した1〜2本のままです。
- USB保存先が切断された場合は新規処理を保留し、未投稿動画の再試行情報を保持します。再接続を5秒ごとに確認し、Songsのインデックスを再構築して復旧します。
- Discordの進捗監視が時間切れ、通信断、メッセージ削除になっても、Rendererの処理を勝手にキャンセルしません。完成動画はWeb UIで確認できます。

検証は`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`python -m unittest discover -s renderer/tests -t .`で実行できます。GitHub ActionsでもNode/WebとRendererを自動検証します。

## 構成

- **Web / API:** Next.js 16、ローカル起動 + Cloudflare Tunnel（Vercel構成も対応）
- **Database:** ローカルPostgreSQL + Drizzle ORM（既存Neonへの接続にも対応）
- **Discord:** discord.js の常駐Gateway worker
- **osu!:** OAuth Client Credentials + API v2
- **Music:** Lavalink v4 + YouTube source plugin + yt-dlp fallback（検索・YouTube URL・プレイリスト対応）

現在の運用ではWeb・DB・Bot・RendererをPC上で動かします。Botが統計収集・定期通知を担当し、Vercelの公開URLはCloudflare Tunnel経由でPC上のWeb UIへ中継します。DBポートやDB資格情報は外部公開しません。Discord Gatewayと音声接続は別の常駐Node.js workerとして実行します。

## 主な機能

- `/osu link` で初回アカウント登録、4モード別のスナップショット保存
- `/verify`または管理者が設置する`/verify-panel`から、osu!登録（未所持も可）→モード複数選択→言語1つ選択の段階式認証
- `/track-player`またはWeb UIのデータベース画面から、Discord未連携のosu!プレイヤーを手動追加して継続集計
- キーフレーズで保護したWeb UIでRenderer、CPU/GPU、メモリ、ディスク、通信量、処理統計を確認
- Web UIから既定解像度・FPS、圧縮、YouTube公開範囲、R2/osu!資格情報を管理
- 設定チャンネルへ新規リザルトを自動投稿
- 日次成長サマリーをDM送信
- `/remind`、`/pomodoro` とVercel Workflowによる耐久タイマー
- `/music` から再生・キュー・一時停止・スキップ・音量・停止。再生時には常設ボタン付きパネルを表示し、15秒ごとに進捗を更新
- `/stats` でBot利用統計
- `/help`、`/health`、`/panel setup`でヘルプ・稼働診断・再起動後も使える常設クイックパネル
- `/help`はカテゴリ選択式。Webの「コマンドガイド」では用途・コマンド名・引数を検索し、必須引数と選択肢を確認できます。
- `/goal`でPP/世界順位の目標と達成DM、`/leaderboard`でサーバー週間PPランキング
- `/session`で直近45分単位のプレイセッション分析、`/profile-card`で共有用プロフィールカード
- `/analysis`でスキルレーダー、BPM、AR/OD/CS傾向をDB全件から分析し、`/export`でCSV/JSON保存
- `/feedback`の要望・不具合受付、エラーID発行、Web運用センターからの原因確認と対応済み管理
- `/music favorite-add`等のお気に入りと、Bot再起動後のボイス・キュー復元
- `/render` でosu!standard / maniaのResult URL、登録アカウントの直近Replay、または`.osr`をMP4化
- Discordメッセージの右クリックからScore URLをレンダーし、待ち時間表示・優先化・キャンセル・任意の30秒ハイライトを利用可能
- `/render-status` で独立したローカルRendererの状態を確認
- `/render-batch`またはWeb UIで最大20件をまとめて追加し、待機列をドラッグ／モバイルの上下ボタンで並べ替え
- Renderer完了後、判定・pp・精度・曲名を含むタイトルと自動サムネイルでYouTubeへ公開投稿し、判定/PP帯の再生リストへ分類（OAuth・再生リスト設定時）
- YouTubeタイトル・説明・タグのテンプレート、動画透かし、R2/ローカル共有動画の保持期間をWeb UIから設定
- `/reports setup`で毎日のサーバー成長レポートと週間表彰、`/admin-log setup`で監査ログとマスク済み全コンソールログをDiscordへ転送
- 条件付き通知ルール（プレイヤー、モード、判定、PP、精度、MOD、PB、異常値）をWeb運用センターで作成
- 公開プロフィール`/players/{osu! user ID}`でモード別のPP・順位・精度・セッション・クリック可能なスコア履歴を共有
- `/server-status setup` でRenderer、CPU/GPU、RAM、ディスク、通信量、動画容量、処理件数を1カテゴリのチャンネル名へ表示
- 状況カテゴリは15秒ごとに再取得。YouTube未設定時のみ完成動画をCloudflare R2（未設定時はVercel Blob）へアップロード
- Webの`/dashboard/render`からNeonのジョブを経由してローカルRendererへ依頼し、完成動画はYouTubeリンクで受け取る
- Rendererは設定に応じて最大2本を並列処理。既定は安定性を優先して1本

## 非公開コントロールパネル

`https://osu-pulse.vercel.app`は公開プロフィールを表示せず、管理キーフレーズのログイン画面だけを公開します。ログイン後は次の画面を利用できます。

- **概要:** Renderer接続、14日間の処理本数、成功率、YouTube投稿数、CPU/GPU/RAM/ディスク/通信量、最近のジョブ
- **レンダー:** Score URLまたは`.osr`からレンダーを依頼し、一括追加、待機列の優先順変更、進捗確認・キャンセル・完成動画を開く
- **設定:** 解像度/FPS、最大並列数、GPUエンコーダ、譜面取得、圧縮、YouTube、osu! API、R2を説明付きの折りたたみ項目で管理
- **データベース:** Neon DB全体容量、テーブル別行数・データ容量・インデックス容量、追跡プレイヤーを確認し、Discord未連携プレイヤーを手動追加
- **統計:** モード別の全リザルト、PP散布図、判定別マーカー、1対1・全員比較、件数上限なしの履歴表示
- **運用センター:** Discord告知、条件付き通知、定期レポート、監査／コンソール転送、osu!/YouTube/R2使用量、エラーID、Discordから届いた要望を一括管理

キーフレーズはVercelの`CONTROL_PANEL_KEYPHRASE`で指定します。未設定時は既存の`WEB_RENDER_ACCESS_KEY`を使用します。セッション署名とDB内資格情報の暗号化には`CONTROL_PANEL_SESSION_SECRET`を使い、未設定時は`INTERNAL_API_SECRET`へフォールバックします。秘密値は画面へ再表示せず、AES-256-GCMで暗号化して保存します。

保存したRenderer設定は、外向きVercel Bridgeを通じて`renderer/.env`へ同期されます。実行中の処理がある場合は完了を待ち、`renderer/start_renderer.bat`が自動再起動して反映します。`RENDER_BRIDGE_TOKEN`、管理キーフレーズ、`DATABASE_URL`は接続喪失を防ぐためWeb UIから変更できません。

## ローカル起動

Windowsでは、リポジトリ直下の`start_osu_pulse.bat`をダブルクリックすると、Local PostgreSQL、Web UI、Renderer、Lavalink、Discord Bot、Cloudflare Tunnel、監視プロセスをまとめて起動できます。起動済みサービスは再利用され、停止中のものだけを依存順に非表示で開始します。起動前チェックと現在の状態確認には次を使います。

```bat
start_osu_pulse.bat --check
start_osu_pulse.bat --status
```

コマンドプロンプトから起動して完了後すぐプロンプトへ戻す場合は`start_osu_pulse.bat --no-pause`を使います。起動結果と公開URLは最後に一覧表示され、詳細ログは`work/launcher.log`へ保存されます。Web UIのソースが前回の本番ビルドより新しい場合は、起動前に自動で再ビルドします。

Cloudflare Quick TunnelのURLが変わると、`scripts/sync-vercel-web-proxy.ps1`がVercelの`LOCAL_WEB_ORIGIN`を更新して本番へ自動デプロイします。これによりブラウザでは常に`https://osu-pulse.vercel.app`を使いながら、Web処理とPostgreSQLはPC内に保持できます。PC、Web UI、またはTunnelが停止している間はVercel側からもアクセスできません。同期状況は`work/vercel-proxy-sync.log`で確認できます。

Botだけ起動する場合は`bot/start_bot.bat`、Rendererだけ起動する場合は`renderer/start_renderer.bat`、音楽ノードだけ起動する場合は`lavalink/start_lavalink.bat`を使います。初回のLavalink起動時は公式Lavalink 4.2.2 JAR（約100 MB）をダウンロードし、SHA-256を検証します。Java 17以上が必要です。初回セットアップやWeb開発サーバーの起動は以下のコマンドを使います。

Windowsへのサインイン時に各サービスを非表示で自動起動する場合は、`install_autostart.bat`を一度実行します。監視プロセスがLocal PostgreSQL・Renderer・Lavalink・Botを30秒ごとに確認し、3回連続で停止を検出すると5分の再起動クールダウン付きで自動復旧します。記録は`work/watchdog.log`へ保存され、解除は`install_autostart.bat -Remove`です。

```bash
npm install
copy .env.example .env.local
npm run db:generate
npm run db:migrate
npm run dev
```

ローカルPostgreSQLへ切り替える場合は、PostgreSQL 17を導入後に`npm run db:configure-local`と`npm run db:migrate`を実行します。元のNeon URLは`.env.local`の`NEON_DATABASE_URL`へ退避されます。Neonの転送量制限が解除された後は`npm run db:import-neon-delta`で、ローカルに存在しない行だけを追加回収できます。

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

概要／レンダー画面に「YouTubeの再認証が必要です」と表示され、最新エラーが`invalid_grant`の場合は、同じ設定コマンドでGoogleの認証をやり直してください。管理画面へのログインとは別の認証です。新しい認証をRendererへ反映すると、古い認証エラーの待ち時間を待たずに未投稿動画を再試行します。USBの動画保存先が使えない間は再試行を保留し、動画の再生成や重複投稿は行いません。

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
/render-batch urls:<Score URLを空白または改行区切り>
/session mode:mania
/profile-card mode:osu!
/reports setup daily_channel:#daily weekly_channel:#awards
/admin-log setup audit_channel:#audit console_channel:#console
/verify
/verify-panel
/track-player username:hakaka_aa mode:osu!
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
- `WEB_APP_URL`（公開URL。現在は `https://osu-pulse.vercel.app`）
- 音楽利用時は `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`。YouTubeの代替経路にはPATH上の`yt-dlp`を使います。必要なら`YT_DLP_PATH`を指定し、ローカル中継用に長いランダム値の`YT_DLP_PROXY_TOKEN`を設定します。
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

現在のローカル運用では `npm run build` 後にWeb UIを再起動して反映します。Cloudflare Tunnelは同じローカルWeb UIへ接続します。Botのコード変更はBot再起動、スラッシュコマンド定義の変更は `npm run bot:register` で反映します。

Vercelを別途利用する場合のみ、リンク済みプロジェクトへデプロイします。

```bash
vercel deploy --prod
```

Vercel Functions内ではGateway workerやdanserを起動しません。レンダージョブは設定されたPostgreSQLへ保存され、起動中のローカルRendererがポーリングして処理します。Gateway worker（Discord Bot）とRendererは独立して起動・停止できます。VercelからPCのlocalhostへ直接DB接続することはできないため、現在のローカルDB構成ではローカルWeb UIを利用してください。
