"use client";

import { AlertCircle, CheckCircle2, ChevronDown, KeyRound, LoaderCircle, Save, Settings2 } from "lucide-react";
import { useActionState } from "react";
import type { ReactNode } from "react";

import { saveSettings } from "@/app/dashboard/settings/actions";
import type { ControlPanelSecretName, ControlPanelSettingsValue } from "@/db/schema";

type InitialSettings = {
  values: ControlPanelSettingsValue;
  version: number;
  updatedAt: string;
  secretConfigured: Record<ControlPanelSecretName, boolean>;
};

function EnvTag({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[#eef1f5] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#586375]">{children}</code>;
}

function Disclosure({ title, description, children, open = false }: { title: string; description: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="cp-disclosure cp-panel overflow-hidden" open={open}>
      <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 hover:bg-[#fafbfc]">
        <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-[11px] leading-5 text-[#778294]">{description}</p></div>
        <ChevronDown className="size-4 shrink-0 text-[#788291]" />
      </summary>
      <div className="border-t border-[#e1e5ea] p-5 sm:p-6">{children}</div>
    </details>
  );
}

function Toggle({ name, defaultChecked, label, description, env }: { name: string; defaultChecked: boolean; label: string; description: string; env: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-[#e1e5ea] bg-[#fbfcfd] p-4">
      <span><span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#313a49]">{label} <EnvTag>{env}</EnvTag></span><span className="mt-1.5 block text-[11px] leading-5 text-[#778294]">{description}</span></span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="mt-1 size-4 shrink-0 accent-[#f48120]" />
    </label>
  );
}

function SecretField({ name, label, configured, description }: { name: ControlPanelSecretName; label: string; configured: boolean; description: string }) {
  return (
    <label className="cp-label">{label} <EnvTag>{name}</EnvTag>
      <input name={name} type="password" autoComplete="off" placeholder={configured ? "設定済み — 変更するときだけ入力" : "未設定"} className="cp-input font-mono" />
      <span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">{description} 保存後も値そのものは再表示しません。</span>
    </label>
  );
}

export function SettingsForm({ initial }: { initial: InitialSettings }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const values = initial.values;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Configuration</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">環境・レンダー設定</h1><p className="mt-1 text-sm text-[#6f7a8c]">分からない項目は閉じたままで大丈夫です。説明を開いてから変更できます。</p></div>
        <div className="rounded-md border border-[#dce1e7] bg-white px-3 py-2 font-mono text-[10px] text-[#687386]">Config v{initial.version}</div>
      </div>

      <form action={action} className="mt-6 space-y-4">
        <Disclosure title="基本レンダー設定" description="Web UIから新しいレンダーを作るときの初期値です。ジョブごとに変更もできます。" open>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="cp-label">基本解像度 <EnvTag>DEFAULT_RENDER_RESOLUTION</EnvTag><select name="resolution" defaultValue={values.renderDefaults.resolution} className="cp-select"><option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">迷ったら1920x1080。4Kは時間と容量が大きく増えます。</span></label>
            <label className="cp-label">基本FPS <EnvTag>DEFAULT_RENDER_FPS</EnvTag><select name="fps" defaultValue={String(values.renderDefaults.fps)} className="cp-select"><option value="60">60 FPS</option><option value="120">120 FPS</option><option value="240">240 FPS</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">60が標準。高FPSほど滑らかですが負荷が増えます。</span></label>
            <label className="cp-label">基本速度 <EnvTag>DEFAULT_RENDER_SPEED</EnvTag><select name="speed" defaultValue={values.renderDefaults.speed} className="cp-select"><option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option></select></label>
            <label className="flex items-center gap-2 self-end rounded-md border border-[#e1e5ea] bg-[#fafbfc] px-3 py-3 text-xs font-medium"><input name="motionBlur" type="checkbox" defaultChecked={values.renderDefaults.motionBlur} className="size-4 accent-[#f48120]" /> Motion blurを初期ON</label>
          </div>
        </Disclosure>

        <Disclosure title="リザルト自動レンダー" description="指定したDiscord/osu!ユーザーの保存済み・新規リザルトを条件判定し、未処理分だけ自動でキューへ追加します。" open>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-800">現在の初期条件は Discord ID <span className="font-mono font-semibold">974264083853492234</span> と osu! User ID <span className="font-mono font-semibold">40389660</span>・判定A・osu!standard/maniaです。DBにある過去の一致分も古い順に処理し、同じScoreや投稿済み動画は重複レンダーしません。</div>
          <div className="mt-4">
            <Toggle name="autoRenderEnabled" defaultChecked={values.autoRender.enabled} label="条件一致リザルトを自動レンダー" env="AUTO_RENDER_ENABLED" description="OFFにすると新しい自動投入を停止します。すでにキューへ入ったJobはキャンセルされません。" />
          </div>
          <label className="mt-3 flex items-start gap-3 rounded-md border border-[#e1e5ea] bg-[#fafbfc] px-4 py-3 text-xs font-medium"><input name="autoRenderPersonalBestOnly" type="checkbox" defaultChecked={values.autoRender.personalBestOnly} className="mt-0.5 size-4 accent-[#f48120]" /><span>自己ベスト更新だけ自動レンダー<span className="mt-1 block text-[10px] font-normal text-[#7d8795]">同一モード内でDBがPB更新と判定したスコアだけを対象にします。</span></span></label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label sm:col-span-2">対象Discord User ID <EnvTag>AUTO_RENDER_DISCORD_USER_IDS</EnvTag><textarea name="autoRenderDiscordUserIds" rows={3} defaultValue={values.autoRender.discordUserIds.join("\n")} placeholder="1行に1つ" className="cp-input min-h-24 resize-y font-mono" /><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">紐づいたosu!アカウントを対象にします。複数指定は改行またはカンマ区切りです。</span></label>
            <label className="cp-label sm:col-span-2">対象osu! User ID / URL <EnvTag>AUTO_RENDER_OSU_USER_IDS</EnvTag><textarea name="autoRenderOsuUserIds" rows={3} defaultValue={values.autoRender.osuUserIds.join("\n")} placeholder="40389660 または https://osu.ppy.sh/users/40389660" className="cp-input min-h-24 resize-y font-mono" /><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">Discord連携に関係なく対象にできます。プロフィールURLの貼り付けにも対応します。</span></label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">最低PP <EnvTag>AUTO_RENDER_MIN_PP</EnvTag><input name="autoRenderMinimumPp" type="number" min="0" max="2000" step="0.1" defaultValue={values.autoRender.minimumPp} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">0ならPP条件なしです。</span></label>
            <label className="cp-label">最低精度（%） <EnvTag>AUTO_RENDER_MIN_ACCURACY</EnvTag><input name="autoRenderMinimumAccuracy" type="number" min="0" max="100" step="0.01" defaultValue={values.autoRender.minimumAccuracy} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">0なら精度条件なしです。</span></label>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <fieldset>
              <legend className="text-xs font-semibold text-[#313a49]">対象判定 <EnvTag>AUTO_RENDER_RANKS</EnvTag></legend>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {(["XH", "X", "SH", "S", "A", "B", "C", "D", "F"] as const).map((rank) => <label key={rank} className="flex items-center gap-2 rounded-md border border-[#e1e5ea] bg-[#fbfcfd] px-3 py-2 text-xs font-semibold"><input name="autoRenderRanks" type="checkbox" value={rank} defaultChecked={values.autoRender.ranks.includes(rank)} className="size-4 accent-[#f48120]" />{rank}</label>)}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-semibold text-[#313a49]">対象モード <EnvTag>AUTO_RENDER_MODES</EnvTag></legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border border-[#e1e5ea] bg-[#fbfcfd] px-3 py-2 text-xs font-semibold"><input name="autoRenderModes" type="checkbox" value="osu" defaultChecked={values.autoRender.modes.includes("osu")} className="size-4 accent-[#f48120]" />osu!standard</label>
                <label className="flex items-center gap-2 rounded-md border border-[#e1e5ea] bg-[#fbfcfd] px-3 py-2 text-xs font-semibold"><input name="autoRenderModes" type="checkbox" value="mania" defaultChecked={values.autoRender.modes.includes("mania")} className="size-4 accent-[#f48120]" />osu!mania</label>
              </div>
            </fieldset>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">解像度 <EnvTag>AUTO_RENDER_RESOLUTION</EnvTag><select name="autoRenderResolution" defaultValue={values.autoRender.resolution} className="cp-select"><option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option></select></label>
            <label className="cp-label">FPS <EnvTag>AUTO_RENDER_FPS</EnvTag><select name="autoRenderFps" defaultValue={String(values.autoRender.fps)} className="cp-select"><option value="60">60 FPS</option><option value="120">120 FPS</option><option value="240">240 FPS</option></select></label>
            <label className="cp-label">速度 <EnvTag>AUTO_RENDER_SPEED</EnvTag><select name="autoRenderSpeed" defaultValue={values.autoRender.speed} className="cp-select"><option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option></select></label>
            <label className="flex items-center gap-2 self-end rounded-md border border-[#e1e5ea] bg-[#fafbfc] px-3 py-3 text-xs font-medium"><input name="autoRenderMotionBlur" type="checkbox" defaultChecked={values.autoRender.motionBlur} className="size-4 accent-[#f48120]" /> Motion blur</label>
          </div>
        </Disclosure>

        <Disclosure title="ゲーム内表示・HUD" description="mania 4Kの速度と文字サイズ、standardの背景移動と右下キー入力表示を調整します。">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-800">mania 4Kのスクロール速度は30を基準に固定しています。判定だけ小さくし、スコアとコンボは読みやすい大きさへ拡大しています。</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">mania 4K速度 <EnvTag>MANIA_SCROLL_SPEED</EnvTag><input name="maniaScrollSpeed" type="number" min="1" max="40" defaultValue={values.appearance.maniaScrollSpeed} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">30が現在の固定値です。</span></label>
            <label className="cp-label">判定サイズ <EnvTag>MANIA_JUDGMENT_SCALE</EnvTag><input name="maniaJudgmentScale" type="number" min="0.25" max="1.5" step="0.01" defaultValue={values.appearance.maniaJudgmentScale} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">0.58でPERFECT/GREAT等を約42%小さくします。</span></label>
            <label className="cp-label">スコアサイズ <EnvTag>MANIA_SCORE_SCALE</EnvTag><input name="maniaScoreScale" type="number" min="0.5" max="2.5" step="0.05" defaultValue={values.appearance.maniaScoreScale} className="cp-input" /></label>
            <label className="cp-label">コンボサイズ <EnvTag>MANIA_COMBO_SCALE</EnvTag><input name="maniaComboScale" type="number" min="0.5" max="2.5" step="0.05" defaultValue={values.appearance.maniaComboScale} className="cp-input" /></label>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Toggle name="standardBackgroundParallax" defaultChecked={values.appearance.standardBackgroundParallax} label="std背景の揺れを有効化" env="STD_BACKGROUND_PARALLAX" description="OFFなら背景のパララックス移動を止めます。現在はOFFです。" />
            <Toggle name="standardKeyOverlay" defaultChecked={values.appearance.standardKeyOverlay} label="右下キー入力表示" env="STD_KEY_OVERLAY" description="std動画の右下にクリック入力（Z/X）の状態を表示します。" />
          </div>
          <div className="mt-4 max-w-sm"><label className="cp-label">右下入力表示の倍率 <EnvTag>STD_KEY_OVERLAY_SCALE</EnvTag><input name="standardKeyOverlayScale" type="number" min="0.5" max="2" step="0.1" defaultValue={values.appearance.standardKeyOverlayScale} className="cp-input" /></label></div>
        </Disclosure>

        <Disclosure title="Rendererエンジン" description="ローカルPCの処理数、エンコーダー、タイムアウトを変更します。保存後にRendererが安全に再起動します。">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">同時レンダー数 <EnvTag>MAX_CONCURRENT_RENDERS</EnvTag><select name="maxConcurrentRenders" defaultValue={String(values.renderer.maxConcurrentRenders)} className="cp-select"><option value="1">1本（推奨）</option><option value="2">2本</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">2本はAMF/GPU、RAM、ディスクI/Oを同時に使います。重い場合は1へ戻してください。</span></label>
            <label className="cp-label">タイムアウト（秒） <EnvTag>RENDER_TIMEOUT_SECONDS</EnvTag><input name="renderTimeoutSeconds" type="number" min="300" max="14400" defaultValue={values.renderer.renderTimeoutSeconds} className="cp-input" /></label>
            <label className="cp-label">ローカル保持（時間） <EnvTag>OUTPUT_RETENTION_HOURS</EnvTag><input name="outputRetentionHours" type="number" min="1" max="168" defaultValue={values.renderer.outputRetentionHours} className="cp-input" /></label>
            <label className="cp-label">R2/共有保持（時間） <EnvTag>STORAGE_RETENTION_HOURS</EnvTag><input name="storageRetentionHours" type="number" min="1" max="8760" defaultValue={values.renderer.storageRetentionHours} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">期限後に共有用ファイルを削除します。YouTube動画は削除しません。</span></label>
            <label className="cp-label">動画エンコーダー <EnvTag>VIDEO_ENCODER</EnvTag><select name="videoEncoder" defaultValue={values.renderer.videoEncoder} className="cp-select"><option value="auto">Auto</option><option value="h264_amf">AMD AMF</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="libx264">CPU libx264</option></select></label>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Toggle name="autoDownloadBeatmaps" defaultChecked={values.renderer.autoDownloadBeatmaps} label="不足譜面を自動取得" env="AUTO_DOWNLOAD_BEATMAPS" description="Songsフォルダに譜面がなければ、安全なミラーから自動取得します。" />
            <Toggle name="beatmapDownloadNoVideo" defaultChecked={values.renderer.beatmapDownloadNoVideo} label="譜面動画を除外" env="BEATMAP_DOWNLOAD_NO_VIDEO" description="背景動画を除外してダウンロード量とディスク使用量を抑えます。" />
          </div>
          <div className="mt-5 rounded-md border border-[#e1e5ea] bg-[#fafbfc] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-xs font-semibold text-[#313a49]">自動レンダーのスマート実行時間</h3><p className="mt-1 text-[10px] leading-4 text-[#7d8795]">自動収集から作られたジョブだけに適用します。Web UI・Discord・直接投入した手動レンダーは常時開始できます。進行中の処理やYouTube投稿は途中で止めません。</p></div>
              <label className="flex items-center gap-2 text-xs font-semibold"><input name="renderScheduleEnabled" type="checkbox" defaultChecked={values.renderer.scheduleEnabled} className="size-4 accent-[#f48120]" /> 有効</label>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="cp-label">開始時刻 <EnvTag>RENDER_ALLOWED_START_TIME</EnvTag><input name="renderAllowedStartTime" type="time" required defaultValue={values.renderer.allowedStartTime} className="cp-input" /></label>
              <label className="cp-label">終了時刻 <EnvTag>RENDER_ALLOWED_END_TIME</EnvTag><input name="renderAllowedEndTime" type="time" required defaultValue={values.renderer.allowedEndTime} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">開始より早い時刻なら日をまたぎます。同じ時刻なら24時間許可です。</span></label>
              <label className="cp-label">無操作判定（分） <EnvTag>RENDER_IDLE_MINUTES</EnvTag><input name="renderIdleMinutes" type="number" min="1" max="240" defaultValue={values.renderer.idleMinutes} className="cp-input" /></label>
            </div>
            <label className="mt-3 flex items-start gap-3 rounded-md border border-[#e1e5ea] bg-white px-4 py-3 text-xs font-medium"><input name="renderIdleOnly" type="checkbox" defaultChecked={values.renderer.idleOnly} className="mt-0.5 size-4 accent-[#f48120]" /><span>PCが未使用の時だけ開始<span className="mt-1 block text-[10px] font-normal text-[#7d8795]">Windowsの最後のキーボード・マウス入力を検出します。既定は10分間無操作です。</span></span></label>
          </div>
        </Disclosure>

        <Disclosure title="動画透かし" description="完成動画へプレイヤー名やBot名を重ねます。テンプレートはレンダーごとのメタデータで置換されます。">
          <Toggle name="watermarkEnabled" defaultChecked={values.renderer.watermarkEnabled} label="透かしを有効化" env="VIDEO_WATERMARK_ENABLED" description="YouTube/R2へ送る前にFFmpegで焼き込みます。" />
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="cp-label">表示内容 <EnvTag>VIDEO_WATERMARK_TEXT</EnvTag><input name="watermarkText" defaultValue={values.renderer.watermarkText} maxLength={120} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">使用可能: {"{player}"} {"{mode}"} {"{pp}"} {"{rank}"}</span></label>
            <label className="cp-label">位置 <EnvTag>VIDEO_WATERMARK_POSITION</EnvTag><select name="watermarkPosition" defaultValue={values.renderer.watermarkPosition} className="cp-select"><option value="top-left">左上</option><option value="top-right">右上</option><option value="bottom-left">左下</option><option value="bottom-right">右下</option></select></label>
          </div>
        </Disclosure>

        <Disclosure title="圧縮設定" description="YouTube/R2へ送る前の動画サイズと画質のバランスです。通常は変更不要です。">
          <div className="grid gap-4 sm:grid-cols-3">
            <Toggle name="videoCompress" defaultChecked={values.renderer.videoCompress} label="再圧縮を有効化" env="VIDEO_COMPRESS" description="外部ストレージへ送る前にH.264で容量を抑えます。" />
            <label className="cp-label">品質（CRF） <EnvTag>VIDEO_COMPRESS_QUALITY</EnvTag><input name="videoCompressQuality" type="number" min="18" max="32" defaultValue={values.renderer.videoCompressQuality} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">小さいほど高画質・大容量。省容量の推奨値は26です。</span></label>
            <label className="cp-label">音声kbps <EnvTag>VIDEO_COMPRESS_AUDIO_KBPS</EnvTag><input name="videoCompressAudioKbps" type="number" min="64" max="320" step="16" defaultValue={values.renderer.videoCompressAudioKbps} className="cp-input" /></label>
          </div>
        </Disclosure>

        <Disclosure title="YouTube自動投稿" description="レンダー完了後の公開範囲と、投稿成功後のローカル/R2削除を設定します。">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle name="youtubeAutoUpload" defaultChecked={values.youtube.autoUpload} label="YouTube自動投稿" env="YOUTUBE_AUTO_UPLOAD" description="レンダー完了後にタイトルを自動生成して投稿します。" />
            <Toggle name="youtubeDeleteAfterUpload" defaultChecked={values.youtube.deleteAfterUpload} label="投稿成功後に削除" env="YOUTUBE_DELETE_AFTER_UPLOAD" description="YouTube側の成功確認と台帳保存後、ローカルとR2から削除します。" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="cp-label">公開範囲 <EnvTag>YOUTUBE_PRIVACY_STATUS</EnvTag><select name="youtubePrivacyStatus" defaultValue={values.youtube.privacyStatus} className="cp-select"><option value="public">公開</option><option value="unlisted">限定公開</option><option value="private">非公開</option></select></label>
            <label className="cp-label">カテゴリID <EnvTag>YOUTUBE_CATEGORY_ID</EnvTag><input name="youtubeCategoryId" inputMode="numeric" defaultValue={values.youtube.categoryId} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">20はGamingです。</span></label>
          </div>
          <details className="mt-5 rounded-md border border-[#e1e5ea] bg-[#fafbfc] p-4">
            <summary className="cursor-pointer text-xs font-semibold">投稿タイトル・説明・タグのテンプレート</summary>
            <p className="mt-2 text-[10px] leading-4 text-[#7d8795]">使用可能: {"{rank}"} {"{pp}"} {"{accuracy}"} {"{artist}"} {"{title}"} {"{difficulty}"} {"{player}"} {"{mode}"} {"{mods}"} {"{score_url}"}</p>
            <div className="mt-4 space-y-4">
              <label className="cp-label">タイトル<input name="youtubeTitleTemplate" defaultValue={values.youtube.titleTemplate} maxLength={300} className="cp-input" /></label>
              <label className="cp-label">説明<textarea name="youtubeDescriptionTemplate" defaultValue={values.youtube.descriptionTemplate} maxLength={5000} rows={8} className="cp-input min-h-44 resize-y py-3" /></label>
              <label className="cp-label">タグ（カンマまたは改行区切り）<textarea name="youtubeTags" defaultValue={values.youtube.tags.join(", ")} rows={3} className="cp-input min-h-20 resize-y py-3" /></label>
            </div>
          </details>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <SecretField name="YOUTUBE_CLIENT_ID" label="OAuth Client ID" configured={initial.secretConfigured.YOUTUBE_CLIENT_ID} description="Google Cloudのデスクトップアプリ用Client IDです。" />
            <SecretField name="YOUTUBE_CLIENT_SECRET" label="OAuth Client Secret" configured={initial.secretConfigured.YOUTUBE_CLIENT_SECRET} description="Desktop OAuthのClient Secretです。" />
            <div className="sm:col-span-2"><SecretField name="YOUTUBE_REFRESH_TOKEN" label="OAuth Refresh Token" configured={initial.secretConfigured.YOUTUBE_REFRESH_TOKEN} description="YouTube投稿権限の長期トークンです。既存トークンを変えない場合は空欄にします。" /></div>
          </div>
          <details className="mt-5 rounded-md border border-[#e1e5ea] bg-[#fafbfc] p-4">
            <summary className="cursor-pointer text-xs font-semibold">判定・PP帯ごとのYouTube再生リスト</summary>
            <p className="mt-2 text-[10px] leading-4 text-[#7d8795]">再生リストIDを設定すると投稿後に自動追加します。未設定の分類は無視します。OAuthにはYouTube管理権限が必要です。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="cp-label">X / SS<input name="youtubePlaylistX" defaultValue={values.youtube.playlistIds.x} className="cp-input font-mono" /></label>
              <label className="cp-label">S<input name="youtubePlaylistS" defaultValue={values.youtube.playlistIds.s} className="cp-input font-mono" /></label>
              <label className="cp-label">A<input name="youtubePlaylistA" defaultValue={values.youtube.playlistIds.a} className="cp-input font-mono" /></label>
              <label className="cp-label">100–199pp<input name="youtubePlaylistPp100" defaultValue={values.youtube.playlistIds.pp100} className="cp-input font-mono" /></label>
              <label className="cp-label">200–299pp<input name="youtubePlaylistPp200" defaultValue={values.youtube.playlistIds.pp200} className="cp-input font-mono" /></label>
              <label className="cp-label">300–399pp<input name="youtubePlaylistPp300" defaultValue={values.youtube.playlistIds.pp300} className="cp-input font-mono" /></label>
              <label className="cp-label">400pp以上<input name="youtubePlaylistPp400" defaultValue={values.youtube.playlistIds.pp400} className="cp-input font-mono" /></label>
            </div>
          </details>
        </Disclosure>

        <Disclosure title="使用量アラート" description="osu! API・YouTube API・R2容量が設定値の80%を超えたら、1日1回Discordへ警告します。">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle name="monitoringAlertsEnabled" defaultChecked={values.monitoring.alertsEnabled} label="使用量警告を有効化" env="DB_MONITORING" description="Botの定期ポーリング中に使用量を確認します。" />
            <label className="cp-label">警告チャンネルID<input name="monitoringAlertChannelId" inputMode="numeric" pattern="[0-9]{17,20}" defaultValue={values.monitoring.alertChannelId} placeholder="123456789012345678" className="cp-input font-mono" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">空欄なら警告を送信しません。</span></label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="cp-label">osu! API / 日<input name="monitoringOsuDailyRequestLimit" type="number" min="100" max="1000000" defaultValue={values.monitoring.osuDailyRequestLimit} className="cp-input" /></label>
            <label className="cp-label">YouTube quota / 日<input name="monitoringYoutubeDailyQuota" type="number" min="1600" max="10000000" defaultValue={values.monitoring.youtubeDailyQuota} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">動画1投稿を約1,600 unitsとして推定します。</span></label>
            <label className="cp-label">R2保存上限（GiB）<input name="monitoringR2StorageLimitGb" type="number" min="0.1" max="100000" step="0.1" defaultValue={values.monitoring.r2StorageLimitGb} className="cp-input" /></label>
          </div>
        </Disclosure>

        <Disclosure title="osu! API・R2接続" description="譜面・リプレイ取得とCloudflare R2の接続情報です。秘密値は暗号化してDBへ保存します。">
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField name="OSU_CLIENT_ID" label="osu! Client ID" configured={initial.secretConfigured.OSU_CLIENT_ID} description="osu! OAuth applicationの数値IDです。" />
            <SecretField name="OSU_CLIENT_SECRET" label="osu! Client Secret" configured={initial.secretConfigured.OSU_CLIENT_SECRET} description="osu! API v2用の秘密値です。" />
            <SecretField name="SPOTIFY_CLIENT_ID" label="Spotify Client ID" configured={initial.secretConfigured.SPOTIFY_CLIENT_ID} description="Spotify Developer DashboardのアプリClient ID。プレイリストの曲名取込に使います。" />
            <SecretField name="SPOTIFY_CLIENT_SECRET" label="Spotify Client Secret" configured={initial.secretConfigured.SPOTIFY_CLIENT_SECRET} description="SpotifyアプリのClient Secret。暗号化してDBへ保存します。" />
            <label className="cp-label">R2 Endpoint <EnvTag>R2_ENDPOINT</EnvTag><input name="r2Endpoint" type="url" defaultValue={values.storage.r2Endpoint} placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com" className="cp-input font-mono" /></label>
            <label className="cp-label">R2 Bucket <EnvTag>R2_BUCKET</EnvTag><input name="r2Bucket" defaultValue={values.storage.r2Bucket} className="cp-input font-mono" /></label>
            <SecretField name="R2_ACCESS_KEY_ID" label="R2 Access Key ID" configured={initial.secretConfigured.R2_ACCESS_KEY_ID} description="R2 S3 API TokenのアクセスキーIDです。" />
            <SecretField name="R2_SECRET_ACCESS_KEY" label="R2 Secret Access Key" configured={initial.secretConfigured.R2_SECRET_ACCESS_KEY} description="R2 S3 API Tokenのシークレットです。" />
          </div>
          <div className="mt-5 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><KeyRound className="mt-0.5 size-4 shrink-0" /> RENDER_BRIDGE_TOKEN、管理キーフレーズ、DATABASE_URLは管理画面から変更できません。誤変更で接続不能になるのを防ぐためです。</div>
        </Disclosure>

        {state ? <div role="status" className={`flex items-start gap-2 rounded-md border px-4 py-3 text-xs leading-5 ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}{state.message}</div> : null}

        <div className="sticky bottom-3 flex items-center justify-between gap-4 rounded-lg border border-[#d5dae2] bg-white/95 p-3 shadow-[0_8px_28px_rgba(15,23,42,.12)] backdrop-blur-md">
          <div className="hidden items-center gap-2 text-[11px] text-[#6d7889] sm:flex"><Settings2 className="size-4" /> 保存後、アイドル時に自動反映</div>
          <button type="submit" disabled={pending} className="cp-button-primary ml-auto min-w-40">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{pending ? "保存中…" : "設定を保存"}</button>
        </div>
      </form>
    </div>
  );
}
