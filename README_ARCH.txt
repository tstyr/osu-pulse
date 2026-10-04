osu! Pulse - Arch USB 起動ガイド

初回はUSBのフォルダをファイルマネージャーで開き、
「ここで端末を開く」から次を実行してください。

  bash ./START_OSU_PULSE_ARCH.sh

初回セットアップにはsudoのパスワード入力、ネット接続、
Vercelへのログインが必要です。パスワード入力中は文字が出ません。
エラーが出ても端末を閉じず、最後のエラーとログを確認してください。

USBの START_OSU_PULSE_ARCH.desktop は端末を開くショートカットです。
デスクトップ環境によっては右クリックから「起動を許可 / 信頼する」が必要です。
.shがテキストとして開かれる場合やUSBの実行制限がある場合は、
上記のbashコマンドを使ってください。実行属性の変更は不要です。

設定完了後はアプリメニューの「osu! Pulse」で全部起動できます。
USBのランチャーも設定済みなら再インストールせずに起動します。
更新・再設定は「osu! Pulse Setup / Update」か次のコマンドです。

  bash ./START_OSU_PULSE_ARCH.sh --setup

Linux実行環境: ~/.local/share/osu-pulse
共有メディア・DBバックアップ: osu-pulse-shared
セットアップ完了後、USBを接続した状態ならOS起動時にsystemdで自動起動します。
USBを外したまま起動した場合は、接続後に起動用ランチャーを実行してください。

ランチャーログ:
  ~/.local/state/osu-pulse/arch-launcher.log
セットアップログ:
  osu-pulse-shared/platform/arch-install.log
Web UI:
  http://localhost:3000

状態確認:
  systemctl --user status 'osu-pulse-*'
Botログ:
  journalctl --user -u osu-pulse-bot -n 100 --no-pager
停止（DBも保存）:
  systemctl --user stop osu-pulse.target
再開:
  systemctl --user start osu-pulse.target

home-pc-monitor-arch は別アプリです。このランチャーでは変更しません。
