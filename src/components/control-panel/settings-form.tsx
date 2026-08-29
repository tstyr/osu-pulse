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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">基本解像度 <EnvTag>DEFAULT_RENDER_RESOLUTION</EnvTag><select name="resolution" defaultValue={values.renderDefaults.resolution} className="cp-select"><option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">迷ったら1920x1080。4Kは時間と容量が大きく増えます。</span></label>
            <label className="cp-label">基本FPS <EnvTag>DEFAULT_RENDER_FPS</EnvTag><select name="fps" defaultValue={String(values.renderDefaults.fps)} className="cp-select"><option value="60">60 FPS</option><option value="120">120 FPS</option><option value="240">240 FPS</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">60が標準。高FPSほど滑らかですが負荷が増えます。</span></label>
            <label className="cp-label">基本速度 <EnvTag>DEFAULT_RENDER_SPEED</EnvTag><select name="speed" defaultValue={values.renderDefaults.speed} className="cp-select"><option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option></select></label>
            <label className="flex items-center gap-2 self-end rounded-md border border-[#e1e5ea] bg-[#fafbfc] px-3 py-3 text-xs font-medium"><input name="motionBlur" type="checkbox" defaultChecked={values.renderDefaults.motionBlur} className="size-4 accent-[#f48120]" /> Motion blurを初期ON</label>
          </div>
        </Disclosure>

        <Disclosure title="Rendererエンジン" description="ローカルPCの処理数、エンコーダー、タイムアウトを変更します。保存後にRendererが安全に再起動します。">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="cp-label">同時レンダー数 <EnvTag>MAX_CONCURRENT_RENDERS</EnvTag><select name="maxConcurrentRenders" defaultValue={String(values.renderer.maxConcurrentRenders)} className="cp-select"><option value="1">1本（推奨）</option><option value="2">2本</option></select><span className="mt-1.5 block text-[10px] font-normal leading-4 text-[#828b98]">2本はAMF/GPU、RAM、ディスクI/Oを同時に使います。重い場合は1へ戻してください。</span></label>
            <label className="cp-label">タイムアウト（秒） <EnvTag>RENDER_TIMEOUT_SECONDS</EnvTag><input name="renderTimeoutSeconds" type="number" min="300" max="14400" defaultValue={values.renderer.renderTimeoutSeconds} className="cp-input" /></label>
            <label className="cp-label">ローカル保持（時間） <EnvTag>OUTPUT_RETENTION_HOURS</EnvTag><input name="outputRetentionHours" type="number" min="1" max="168" defaultValue={values.renderer.outputRetentionHours} className="cp-input" /></label>
            <label className="cp-label">動画エンコーダー <EnvTag>VIDEO_ENCODER</EnvTag><select name="videoEncoder" defaultValue={values.renderer.videoEncoder} className="cp-select"><option value="auto">Auto</option><option value="h264_amf">AMD AMF</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="libx264">CPU libx264</option></select></label>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Toggle name="autoDownloadBeatmaps" defaultChecked={values.renderer.autoDownloadBeatmaps} label="不足譜面を自動取得" env="AUTO_DOWNLOAD_BEATMAPS" description="Songsフォルダに譜面がなければ、安全なミラーから自動取得します。" />
            <Toggle name="beatmapDownloadNoVideo" defaultChecked={values.renderer.beatmapDownloadNoVideo} label="譜面動画を除外" env="BEATMAP_DOWNLOAD_NO_VIDEO" description="背景動画を除外してダウンロード量とディスク使用量を抑えます。" />
          </div>
        </Disclosure>

        <Disclosure title="圧縮設定" description="YouTube/R2へ送る前の動画サイズと画質のバランスです。通常は変更不要です。">
          <div className="grid gap-4 sm:grid-cols-3">
            <Toggle name="videoCompress" defaultChecked={values.renderer.videoCompress} label="再圧縮を有効化" env="VIDEO_COMPRESS" description="外部ストレージへ送る前にH.264で容量を抑えます。" />
            <label className="cp-label">品質（CRF） <EnvTag>VIDEO_COMPRESS_QUALITY</EnvTag><input name="videoCompressQuality" type="number" min="18" max="32" defaultValue={values.renderer.videoCompressQuality} className="cp-input" /><span className="mt-1.5 block text-[10px] font-normal text-[#828b98]">小さいほど高画質・大容量。24が標準です。</span></label>
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
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <SecretField name="YOUTUBE_CLIENT_ID" label="OAuth Client ID" configured={initial.secretConfigured.YOUTUBE_CLIENT_ID} description="Google Cloudのデスクトップアプリ用Client IDです。" />
            <SecretField name="YOUTUBE_CLIENT_SECRET" label="OAuth Client Secret" configured={initial.secretConfigured.YOUTUBE_CLIENT_SECRET} description="Desktop OAuthのClient Secretです。" />
            <div className="sm:col-span-2"><SecretField name="YOUTUBE_REFRESH_TOKEN" label="OAuth Refresh Token" configured={initial.secretConfigured.YOUTUBE_REFRESH_TOKEN} description="YouTube投稿権限の長期トークンです。既存トークンを変えない場合は空欄にします。" /></div>
          </div>
        </Disclosure>

        <Disclosure title="osu! API・R2接続" description="譜面・リプレイ取得とCloudflare R2の接続情報です。秘密値は暗号化してDBへ保存します。">
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField name="OSU_CLIENT_ID" label="osu! Client ID" configured={initial.secretConfigured.OSU_CLIENT_ID} description="osu! OAuth applicationの数値IDです。" />
            <SecretField name="OSU_CLIENT_SECRET" label="osu! Client Secret" configured={initial.secretConfigured.OSU_CLIENT_SECRET} description="osu! API v2用の秘密値です。" />
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
